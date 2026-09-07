package ua.orders.crm

import java.math.BigDecimal
import java.util.Locale
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class OrderItem(
    val position: Int? = null,
    @SerialName("product_name") val productName: String? = null,
    val size: String? = null,
    val quantity: Double? = null,
    val price: Double? = null,
    @SerialName("image_url") val imageUrl: String? = null,
)

@Serializable
data class Order(
    val id: String,
    @SerialName("external_id") val externalId: String? = null,
    @SerialName("order_number") val orderNumber: Long? = null,
    @SerialName("order_label") val orderLabel: String? = null,
    @SerialName("order_date") val orderDate: String? = null,
    @SerialName("order_time") val orderTime: String? = null,
    val customer: String? = null,
    val phone: String? = null,
    val platform: String? = null,
    val status: String? = null,
    val shipping: Double? = null,
    val delivery: JsonElement? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("crm_order_items") val items: List<OrderItem> = emptyList(),
)

enum class StatusTone { NEW, NEGATIVE, COMPLETE, ACTIVE }
enum class AcceptRoute(val function: String) {
    PROM("sync-prom-orders"),
    EPICENTR("sync-epicentr-orders"),
    KASTA("sync-kasta-orders"),
}
fun normalizedStatus(status: String?) = status.orEmpty().trim().lowercase(Locale.ROOT)
fun isNewStatus(status: String?) = normalizedStatus(status) in setOf("новий", "новый", "new", "pending")
fun statusTone(status: String?): StatusTone {
    val value = normalizedStatus(status)
    return when {
        Regex("скас|отмен|cancel|повер|возврат|return|refund").containsMatchIn(value) -> StatusTone.NEGATIVE
        isNewStatus(value) -> StatusTone.NEW
        Regex("виконан|выполн|completed|delivered|доставлен|отриман|получен").containsMatchIn(value) -> StatusTone.COMPLETE
        else -> StatusTone.ACTIVE
    }
}
fun acceptRoute(order: Order, email: String?): AcceptRoute? {
    if (email.isNullOrBlank() || email.equals("guest@gmail.com", true) || !isNewStatus(order.status)) return null
    val externalId = order.externalId.orEmpty()
    return when (order.platform.orEmpty().trim().lowercase(Locale.ROOT)) {
        "пром" -> AcceptRoute.PROM.takeIf { externalId.matches(Regex("prom:[1-9][0-9]*")) }
        "эпицентр", "епіцентр" -> AcceptRoute.EPICENTR.takeIf { externalId.matches(Regex("[1-9][0-9]*")) }
        // Reserved for the confirmed Kasta write contract. It must stay unavailable until then.
        "каста", "kasta" -> null
        else -> null
    }
}
fun canAccept(order: Order, email: String?) = acceptRoute(order, email) != null

fun acceptUnavailableReason(order: Order, email: String?): String? {
    if (email.isNullOrBlank() || email.equals("guest@gmail.com", true) || !isNewStatus(order.status)) return null
    val platform = order.platform.orEmpty().trim().lowercase(Locale.ROOT)
    val validKastaId = order.externalId?.matches(Regex("kasta:[1-9][0-9]*")) == true
    return if (platform in setOf("каста", "kasta") && validKastaId)
        "Принятие Каста временно недоступно: нужен официальный HUB API contract."
    else null
}

fun Order.total(): BigDecimal = items.fold(BigDecimal.ZERO) { sum, item ->
    sum + BigDecimal.valueOf(item.price ?: 0.0) * BigDecimal.valueOf(item.quantity ?: 0.0)
}
fun String?.display() = this?.takeIf { it.isNotBlank() } ?: "—"
fun Order.number() = orderLabel?.takeIf { it.isNotBlank() } ?: orderNumber?.toString() ?: "—"
fun Order.deliveryField(key: String): String = ((delivery as? JsonObject)?.get(key) as? JsonPrimitive)?.contentOrNull.display()
fun Order.shipments(): List<JsonObject> = (((delivery as? JsonObject)?.get("shipmentHistory")) as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
fun JsonObject.field(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull.display()
