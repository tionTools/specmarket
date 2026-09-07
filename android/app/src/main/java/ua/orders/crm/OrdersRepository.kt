package ua.orders.crm

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.logging.LogLevel
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
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
    val message: String? = null,
)
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
    private val columns = Columns.raw("id,external_id,order_number,order_label,order_date,order_time,customer,phone,platform,status,shipping,delivery,updated_at,crm_order_items(position,product_name,size,quantity,price,image_url)")

    suspend fun orders(offset: Long = 0): List<Order> =
        client.from("crm_orders").select(columns) {
            order("updated_at", SortOrder.DESCENDING)
            order("id", SortOrder.DESCENDING)
            range(offset..offset + 49)
        }.decodeList()

    suspend fun order(id: String): Order? = client.from("crm_orders").select(columns) {
        filter { eq("id", id) }
        limit(1)
    }.decodeList<Order>().firstOrNull()

    suspend fun accept(route: AcceptRoute, externalId: String): AcceptResponse {
        check(client.auth.currentSessionOrNull() != null)
        return json.decodeFromString(client.functions.invoke(route.function, buildJsonObject {
            put("acceptExternalIds", buildJsonArray { add(externalId) })
        }).bodyAsText())
    }

    suspend fun watch(onConnection: (Boolean) -> Unit, onChange: suspend (OrderChange) -> Unit): Nothing = coroutineScope {
        val channel = client.channel("crm:orders") { isPrivate = true }
        val events = channel.broadcastFlow<OrderChange>("order_changed")
        try {
            launch { channel.status.collect { onConnection(it == RealtimeChannel.Status.SUBSCRIBED) } }
            launch { events.collect { onChange(it) } }
            channel.subscribe(blockUntilSubscribed = true)
            awaitCancellation()
        } finally {
            onConnection(false)
            withContext(NonCancellable) { client.realtime.removeChannel(channel) }
        }
    }
}
