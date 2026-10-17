package ua.orders.crm

import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PickupReminderState(
    @SerialName("order_id") val orderId: String,
    val ttn: String,
    val deadline: String,
    @SerialName("first_sent_at") val firstSentAt: String? = null,
    @SerialName("first_channel") val firstChannel: String? = null,
    @SerialName("last_sent_at") val lastSentAt: String? = null,
    @SerialName("last_channel") val lastChannel: String? = null,
)

enum class PickupReminderStage(val databaseValue: String) {
    FIRST("first"), LAST("last")
}

fun pickupToday(): LocalDate = LocalDate.now(ZoneId.of("Europe/Kyiv"))

fun Order.pendingPickupReminder(
    reminder: PickupReminderState?,
    today: LocalDate = pickupToday(),
): PickupReminderStage? {
    if (reminder == null || reminder.ttn != deliveryValue("ttn").trim() || reminder.ttn.isBlank()) return null
    val deadline = runCatching { LocalDate.parse(reminder.deadline) }.getOrNull() ?: return null
    val tracking = normalizedStatus(deliveryValue("trackingNormalizedStatus"))
    if (tracking in setOf("delivered", "returned", "returning", "cancelled", "deleted")
        || deliveryFlag("trackingBuyerReceived") || deliveryFlag("trackingReturnInProgress")
        || hasReturnSignal()
        || Regex("скас|отмен|cancel|закр|closed|заверш|виконан|completed|finished", RegexOption.IGNORE_CASE)
            .containsMatchIn(status.orEmpty())
    ) return null
    return when (ChronoUnit.DAYS.between(today, deadline)) {
        0L -> if (reminder.lastSentAt == null) PickupReminderStage.LAST else null
        1L, 2L -> if (reminder.firstSentAt == null) PickupReminderStage.FIRST else null
        else -> null
    }
}

fun Order.pickupReminderText(stage: PickupReminderStage, deadline: String, today: LocalDate = pickupToday()): String {
    val date = LocalDate.parse(deadline).format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))
    val days = ChronoUnit.DAYS.between(today, LocalDate.parse(deadline))
    val products = items.sortedBy { it.position ?: Int.MAX_VALUE }.joinToString("\n") { item ->
        val name = item.productName?.trim().orEmpty().ifBlank { "Товар" }
        val size = item.size?.trim().orEmpty().takeIf(String::isNotBlank)?.let { ", розмір $it" }.orEmpty()
        val count = item.quantity?.takeIf { it > 0 }?.let { java.math.BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() }
        "• $name$size" + (count?.let { " — $it шт." } ?: "")
    }.ifBlank { "Товари в замовленні" }
    val intro = if (stage == PickupReminderStage.LAST)
        "Нагадуємо, що сьогодні останній день отримання вашого замовлення №${number()}."
    else "Нагадуємо, що ваше замовлення №${number()} очікує на отримання."
    val time = if (stage == PickupReminderStage.LAST)
        "Будь ласка, заберіть посилку сьогодні, щоб уникнути її повернення відправнику."
    else {
        val remaining = if (days == 1L) "1 день" else "2 дні"
        "До завершення терміну отримання залишилося $remaining.\n\nБудь ласка, заберіть ваше замовлення до $date, щоб уникнути його повернення відправнику."
    }
    return "Вітаємо!\n\n$intro\n\nВаше замовлення:\n$products\n\n📦 ТТН: ${deliveryValue("ttn").trim()}\n\n$time\n\nДякуємо!"
}
