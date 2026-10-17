package ua.orders.crm

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.logging.LogLevel
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order as SortOrder
import io.github.jan.supabase.realtime.*
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class AcceptResponse(
    val ok: Boolean = false,
    val accepted: Int = 0,
    val changedOrderIds: List<String> = emptyList(),
    val alreadyAccepted: List<String> = emptyList(),
    val skipped: String? = null,
    val message: String? = null,
)

fun acceptResultMessage(result: AcceptResponse): String = when {
    !result.ok -> result.message ?: "Заказ не принят. Обновите данные и проверьте статус."
    !result.skipped.isNullOrBlank() -> "Площадка на паузе. Заказ не принят."
    result.alreadyAccepted.isNotEmpty() -> "Заказ уже принят."
    else -> "Заказ принят."
}
@Serializable
data class PushDeviceResponse(val ok: Boolean = false, val message: String? = null)
@Serializable
data class OrderChange(val order_id: String, val operation: String = "")

class OrdersRepository {
    private val json = Json { ignoreUnknownKeys = true }
    private val client = createSupabaseClient(
        "https://rtkhgldaswsclkorlyxx.supabase.co",
        "sb_publishable_PE0btLoBDCEIXlcf5nJZ2g_9PvMhbyb",
    ) {
        httpEngine = OkHttp.create()
        defaultLogLevel = LogLevel.NONE
        install(Auth)
        install(Postgrest)
        install(Realtime)
        install(Functions)
    }
    val sessionStatus = client.auth.sessionStatus
    suspend fun signIn(email: String, password: String) {
        require(!email.trim().equals("guest@gmail.com", true)) { "Используйте личный аккаунт CRM." }
        client.auth.signInWith(Email) { this.email = email.trim(); this.password = password }
    }
    suspend fun signOut() = client.auth.signOut()
    private val columns = Columns.raw("id,external_id,order_number,order_label,order_date,order_time,customer,phone,platform,status,shipping,delivery,updated_at,crm_order_items(position,product_name,size,quantity,price,image_url,royalty_percent,royalty_amount)")

    suspend fun setPushDevice(deviceId: String, token: String?, enabled: Boolean) {
        check(client.auth.sessionStatus.first { it !is SessionStatus.Initializing } is SessionStatus.Authenticated)
        val response = json.decodeFromString<PushDeviceResponse>(client.functions.invoke("manage-push-device", buildJsonObject {
            put("deviceId", deviceId)
            put("enabled", enabled)
            token?.takeIf { it.isNotBlank() }?.let { put("token", it) }
        }).bodyAsText())
        check(response.ok) { response.message ?: "Не удалось зарегистрировать push-устройство." }
    }

    suspend fun orders(): List<Order> {
        val result = mutableListOf<Order>()
        var offset = 0L
        do {
            val batch = client.from("crm_orders").select(columns) {
                order("created_at", SortOrder.DESCENDING)
                order("id", SortOrder.DESCENDING)
                range(offset..offset + 199)
            }.decodeList<Order>()
            result += batch
            offset += batch.size
        } while (batch.size == 200)
        return result
    }

    suspend fun recentOrders(): List<Order> = client.from("crm_orders").select(columns) {
        order("created_at", SortOrder.DESCENDING)
        order("id", SortOrder.DESCENDING)
        range(0L..(MANUAL_REFRESH_RECENT_COUNT.toLong() - 1L))
    }.decodeList<Order>()

    suspend fun ordersChangedSince(updatedAt: String): List<Order> {
        val result = mutableListOf<Order>()
        var offset = 0L
        do {
            val batch = client.from("crm_orders").select(columns) {
                filter { gte("updated_at", updatedAt) }
                order("updated_at", SortOrder.ASCENDING)
                order("id", SortOrder.ASCENDING)
                range(offset..offset + 199)
            }.decodeList<Order>()
            result += batch
            offset += batch.size
        } while (batch.size == 200)
        return result
    }

    suspend fun order(id: String): Order? = client.from("crm_orders").select(columns) {
        filter { eq("id", id) }
        limit(1)
    }.decodeList<Order>().firstOrNull()


    suspend fun pickupReminders(): List<PickupReminderState> =
        client.from("crm_pickup_reminders")
            .select(Columns.raw("order_id,ttn,deadline,first_sent_at,first_channel,last_sent_at,last_channel"))
            .decodeList<PickupReminderState>()

    suspend fun setPickupDeadline(orderId: String, ttn: String, deadline: String) {
        check(client.auth.currentSessionOrNull() != null)
        client.postgrest.rpc("crm_set_pickup_reminder_deadline", buildJsonObject {
            put("p_order_id", orderId)
            put("p_ttn", ttn)
            put("p_deadline", deadline)
        })
    }

    suspend fun confirmPickupReminder(
        orderId: String, ttn: String, deadline: String, stage: PickupReminderStage, channel: String
    ) {
        check(client.auth.currentSessionOrNull() != null)
        client.postgrest.rpc("crm_confirm_pickup_reminder", buildJsonObject {
            put("p_order_id", orderId)
            put("p_ttn", ttn)
            put("p_deadline", deadline)
            put("p_stage", stage.databaseValue)
            put("p_channel", channel)
        })
    }

    suspend fun accept(route: AcceptRoute, externalId: String): AcceptResponse {
        check(client.auth.currentSessionOrNull() != null)
        return json.decodeFromString(client.functions.invoke(route.function, buildJsonObject {
            put("acceptExternalIds", buildJsonArray { add(externalId) })
        }).bodyAsText())
    }

    suspend fun watch(onConnection: (Boolean) -> Unit, onChange: suspend (OrderChange) -> Unit): Unit = coroutineScope {
        val channel = client.channel("crm:orders") { isPrivate = true }
        val events = channel.broadcastFlow<OrderChange>("order_changed")
        val disconnected = CompletableDeferred<Unit>()
        var wasSubscribed = false
        val statusJob = launch {
            channel.status.collect { status ->
                val connected = status == RealtimeChannel.Status.SUBSCRIBED
                onConnection(connected)
                if (connected) wasSubscribed = true
                else if (wasSubscribed) disconnected.complete(Unit)
            }
        }
        val eventsJob = launch {
            try {
                events.collect { onChange(it) }
            } catch (cancel: CancellationException) {
                if (cancel is TimeoutCancellationException) disconnected.complete(Unit)
                else throw cancel
            } catch (_: Exception) {
                disconnected.complete(Unit)
            }
        }
        try {
            withTimeout(25_000) { channel.subscribe(blockUntilSubscribed = true) }
            disconnected.await()
        } finally {
            statusJob.cancel()
            eventsJob.cancel()
            onConnection(false)
            withContext(NonCancellable) {
                withTimeoutOrNull(5_000) { client.realtime.removeChannel(channel) }
            }
        }
    }
}
