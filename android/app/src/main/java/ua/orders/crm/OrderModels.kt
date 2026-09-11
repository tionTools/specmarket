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

enum class StatusTone { BLUE, GREEN, ORANGE, RED }
enum class AcceptRoute(val function: String) {
    PROM("sync-prom-orders"),
    EPICENTR("sync-epicentr-orders"),
    KASTA("sync-kasta-orders"),
}
fun normalizedStatus(status: String?) = status.orEmpty().trim().lowercase(Locale.ROOT)
fun isNewStatus(status: String?) = normalizedStatus(status) in setOf("новий", "новый", "new", "pending")

fun displayOrderStatus(status: String?): String {
    val value = status.orEmpty().trim()
    val names = mapOf(
        "pending" to "Новий",
        "completed" to "Завершено",
        "cancelled" to "Скасовано",
        "received" to "Принято",
        "delivered" to "Виконано",
        "new" to "Новий",
        "confirmed_by_seller" to "Підтверджено продавцем",
        "confirmed_by_merchant" to "Підтверджено продавцем",
        "confirmed" to "Підтверджено",
        "sent" to "Відправлено",
        "ready_for_pickup" to "Готово до видачі",
        "finished" to "Завершено",
        "closed" to "Закрито",
        "canceled" to "Скасовано",
        "returned" to "Повернено",
        "return_request" to "Запит на повернення",
        "canceled_by_seller" to "Скасовано продавцем",
        "canceled_by_merchant" to "Скасовано продавцем",
    )
    return names[value.lowercase(Locale.ROOT)] ?: value
}

fun Order.deliveryValue(key: String): String =
    ((delivery as? JsonObject)?.get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

fun Order.deliveryFlag(key: String): Boolean =
    ((delivery as? JsonObject)?.get(key) as? JsonPrimitive)?.booleanOrNull == true

private fun cancelledOrReturnedForNewBadge(order: Order): Boolean =
    Regex("скас|отмен|cancel|повер|возврат|return|refund").containsMatchIn(
        displayOrderStatus(order.status).lowercase(Locale.ROOT),
    )

/** Matches the Web CRM visual rule: marketplace order stays NEW until a TTN exists. */
fun isNewOrderVisual(order: Order): Boolean =
    normalizedStatus(order.platform) in setOf("пром", "эпицентр", "епіцентр", "каста", "kasta") &&
        order.deliveryValue("ttn").trim().isEmpty() &&
        !cancelledOrReturnedForNewBadge(order)

data class DeliveryStatusInfo(val stage: String = "", val current: String = "")

private fun isGenericReturnTrackingStatus(value: String) =
    Regex("відмова від (?:одержання|отримання)|^(?:отменено|скасовано|cancelled?)$|возвращается отправителю|повертається відправнику|return(?:ing| to sender)", RegexOption.IGNORE_CASE)
        .containsMatchIn(value.trim())

fun Order.deliveryStatusInfo(): DeliveryStatusInfo {
    val raw = deliveryValue("trackingStatus").trim()
    val normalized = deliveryValue("trackingNormalizedStatus").trim().lowercase(Locale.ROOT)
    val deliveryStatus = deliveryValue("status").trim()
    val rawImpliesReturn = Regex("відмова від (?:одержання|отримання)|возвращ|поверта|return", RegexOption.IGNORE_CASE)
        .containsMatchIn(raw)
    val returning = deliveryFlag("trackingReturnInProgress") || normalized == "returning" || rawImpliesReturn
    if (returning) {
        return DeliveryStatusInfo(
            stage = "Возвращается отправителю",
            current = raw.takeUnless { it.isBlank() || isGenericReturnTrackingStatus(it) }.orEmpty(),
        )
    }
    if (raw.isNotBlank()) return DeliveryStatusInfo(stage = raw)
    val stage = when (normalized) {
        "accepted" -> "Принято перевозчиком"
        "in_transit" -> "В пути"
        "ready_for_pickup" -> "Готово к выдаче"
        "delivered" -> "Получено"
        "returned" -> "Возвращено"
        "cancelled" -> "Отменено"
        else -> deliveryStatus
    }
    return DeliveryStatusInfo(stage = stage)
}

fun ordersDuringDetailRefresh(current: List<Order>, fetched: List<Order>, detailOpen: Boolean): List<Order> =
    if (detailOpen && current.isNotEmpty() && fetched.isEmpty()) current else fetched

fun ordersAfterClosingDetail(current: List<Order>, beforeDetail: List<Order>): List<Order> =
    if (current.isEmpty() && beforeDetail.isNotEmpty()) beforeDetail else current

fun orderStatusTone(order: Order): StatusTone {
    val status = displayOrderStatus(order.status).trim().lowercase(Locale.ROOT)
    val trackingNormalized = order.deliveryValue("trackingNormalizedStatus").trim().lowercase(Locale.ROOT)
    val trackingStatus = order.deliveryValue("trackingStatus").trim().lowercase(Locale.ROOT)
    val deliveryStatus = order.deliveryValue("status").trim().lowercase(Locale.ROOT)
    val platform = order.platform.orEmpty().trim()

    if (
        order.deliveryFlag("trackingReturnInProgress") ||
        trackingNormalized in setOf("returning", "returned", "cancelled") ||
        Regex("скас|отмен|cancel|повер|возврат|return|refund").containsMatchIn(status) ||
        Regex("возвращ|повер|return|отмен|скас|cancel|відмов.*одерж").containsMatchIn(trackingStatus) ||
        Regex("возвращ|повер|return|отмен|скас|cancel|відмов.*одерж").containsMatchIn(deliveryStatus)
    ) return StatusTone.RED

    if (
        (platform == "Пром" && Regex("виконан|заверш|delivered|completed").containsMatchIn(status)) ||
        (platform == "Эпицентр" && Regex("заверш|закрит|closed|finished|completed").containsMatchIn(status)) ||
        (platform in setOf("Каста", "Р/С", "Сайт") &&
            Regex("закрыт|закрит|closed|finished|completed").containsMatchIn(status))
    ) return StatusTone.ORANGE

    val carrierConfirmsDelivery =
        trackingNormalized == "delivered" ||
            ((trackingNormalized.isBlank() || trackingNormalized == "unknown") &&
                Regex("получ|отрим|доставлен|доставлено|вруч|delivered|received").containsMatchIn(trackingStatus))

    if (platform != "Пром" && carrierConfirmsDelivery) return StatusTone.ORANGE

    val carrierConfirmsShipment =
        trackingNormalized in setOf("accepted", "in_transit", "ready_for_pickup", "delivered") ||
            (trackingNormalized.isBlank() &&
                Regex("отправ|відправ|в дорог|в дороз|на пути|на шляху|готов.*выдач|готов.*видач|получ|отрим|достав|вруч|принят.*перевоз|прийнят.*перевіз|accepted|in[_ -]?transit|ready[_ -]?for[_ -]?pickup|delivered|received")
                    .containsMatchIn(trackingStatus))

    if (
        carrierConfirmsShipment ||
        (platform in setOf("Каста", "Р/С", "Сайт") && "в дороге" in status)
    ) return StatusTone.GREEN

    return StatusTone.BLUE
}

private fun orderDateTimeKey(order: Order): Long {
    val date = order.orderDate.orEmpty().trim()
    val dateParts = date.split('.', '-', '/').mapNotNull { it.toIntOrNull() }
    val (year, month, day) = when {
        dateParts.size != 3 -> Triple(0, 0, 0)
        dateParts[0] > 1900 -> Triple(dateParts[0], dateParts[1], dateParts[2])
        else -> Triple(dateParts[2], dateParts[1], dateParts[0])
    }
    val timeParts = order.orderTime.orEmpty().trim().split(':').mapNotNull { it.toIntOrNull() }
    val hour = timeParts.getOrElse(0) { 0 }
    val minute = timeParts.getOrElse(1) { 0 }
    return year.toLong() * 100_000_000L +
        month.toLong() * 1_000_000L +
        day.toLong() * 10_000L +
        hour.toLong() * 100L +
        minute.toLong()
}

fun sortOrdersForDisplay(orders: List<Order>): List<Order> =
    orders.sortedWith(
        compareByDescending<Order> { orderDateTimeKey(it) }
            .thenByDescending { it.orderNumber ?: Long.MIN_VALUE }
            .thenByDescending { it.id },
    )

fun isNewOrderNotificationCandidate(order: Order): Boolean {
    if (!isNewStatus(order.status)) return false
    return normalizedStatus(order.platform) in setOf("пром", "эпицентр", "епіцентр", "каста", "kasta")
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
fun Order.deliveryField(key: String): String = deliveryValue(key).display()
fun Order.shipments(): List<JsonObject> = (((delivery as? JsonObject)?.get("shipmentHistory")) as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()


fun Order.recipientName(): String =
    deliveryValue("recipient").trim().ifBlank { customer.orEmpty().trim() }.display()

fun Order.recipientPhone(): String =
    formatCustomerPhoneForDisplay(
        deliveryValue("recipientPhone").trim().ifBlank { phone.orEmpty().trim() },
    )

private val returnSignalRegex = Regex(
    "скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим",
    RegexOption.IGNORE_CASE,
)

fun Order.hasPhysicalShipmentMovement(): Boolean {
    if (deliveryValue("printedAt").trim().isNotEmpty()) return true
    return deliveryValue("trackingNormalizedStatus").trim().lowercase(Locale.ROOT) in setOf(
        "accepted", "in_transit", "ready_for_pickup", "delivered", "returning", "returned",
    )
}

fun Order.hasReturnSignal(): Boolean {
    val normalizedTracking = deliveryValue("trackingNormalizedStatus").trim().lowercase(Locale.ROOT)
    return normalizedTracking in setOf("returning", "returned") ||
        returnSignalRegex.containsMatchIn(displayOrderStatus(status)) ||
        returnSignalRegex.containsMatchIn(deliveryValue("trackingStatus")) ||
        returnSignalRegex.containsMatchIn(deliveryValue("status"))
}

/** Mirrors Web CRM: cancellation before physical shipment is hidden; returns stay in the main list. */
fun isOrderVisibleInMainList(order: Order): Boolean =
    !order.hasReturnSignal() || order.hasPhysicalShipmentMovement()

private fun searchCompact(value: String): String =
    value.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() }

fun Order.matchesOrderSearch(query: String): Boolean {
    val terms = query.trim().lowercase(Locale.ROOT).split(Regex("\\s+")).filter(String::isNotBlank)
    if (terms.isEmpty()) return true
    val searchable = buildList {
        add(id)
        add(externalId.orEmpty())
        add(number())
        add(orderDate.orEmpty())
        add(orderTime.orEmpty())
        add(platform.orEmpty())
        add(displayOrderStatus(status))
        add(customer.orEmpty())
        add(phone.orEmpty())
        add(recipientName())
        add(recipientPhone())
        add(delivery?.toString().orEmpty())
        items.forEach { item ->
            add(item.productName.orEmpty())
            add(item.size.orEmpty())
            add(item.quantity?.toString().orEmpty())
        }
    }
    val plain = searchable.joinToString(" ").lowercase(Locale.ROOT)
    val compact = searchCompact(searchable.joinToString(" "))
    return terms.all { term ->
        plain.contains(term) ||
            searchCompact(term).takeIf { it.length >= 2 }?.let(compact::contains) == true
    }
}
fun JsonObject.field(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull.display()