package ua.orders.crm

import java.time.Duration
import java.time.LocalDate
import java.time.ZonedDateTime
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

// Android devices with older system tzdata do not recognize the post-2022
// IANA rename Europe/Kyiv, but Europe/Kiev represents the same Kyiv zone.
// Keep the legacy zone key for compatibility; do not use the device timezone.
internal const val PICKUP_KYIV_ZONE = "Europe/Kiev"
fun pickupToday(): LocalDate = LocalDate.now(ZoneId.of(PICKUP_KYIV_ZONE))

// Parcels with no reliable deadline must remain discoverable in the
// reminder filter; otherwise the operator would have to search all orders.

// This runs for every visible order card. Avoid eager static Regex
// initialization: some Android platform regex engines behave differently
// from the desktop JVM used by unit tests.
private fun tokenIn(text: String, word: String): Boolean {
    var from = 0
    while (true) {
        val at = text.indexOf(word, from)
        if (at < 0) return false
        val leftIsLetter = at > 0 && text[at - 1].isLetter()
        val right = at + word.length
        val rightIsLetter = right < text.length && text[right].isLetter()
        if (!leftIsLetter && !rightIsLetter) return true
        from = at + word.length
    }
}

fun Order.isNovaPickupPoint(): Boolean {
    val carrier = normalizedStatus(deliveryValue("carrier"))
    val nova = listOf("nova", "нова", "новой", "нової", "novaposhta", "новапошта")
        .any(carrier::contains) || tokenIn(carrier, "нп")
    if (!nova || deliveryValue("ttn").isBlank()) return false
    return listOf(
        "trackingLocation", "trackingDestinationAddress", "address", "warehouseRecipient",
        "recipientAddress", "trackingPickupLocationDescription",
    ).any { field ->
        val location = normalizedStatus(deliveryValue(field))
        if (listOf("поштомат", "почтомат", "постамат").any(location::contains)) return@any false
        listOf(
            "пункт видач", "пункт выдачи", "пункт приймання-видач",
            "пункт приема-выдачи", "пункт приёма-выдачи",
            "parcel shop", "parcel-shop",
        ).any(location::contains) || tokenIn(location, "пвз")
    }
}


private fun pickupArrivalDate(input: String): LocalDate? {
    val source = input.trim()
    val timeFirst = Regex("""^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s+(\d{2})[.\/-](\d{2})[.\/-](\d{4})$""").matchEntire(source)
    val dateFirst = Regex("""^(\d{2})[.\/-](\d{2})[.\/-](\d{4})(?:\s+(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$""").matchEntire(source)
    val iso = Regex("""^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$""").matchEntire(source)
    val yy = iso?.groupValues?.get(1) ?: timeFirst?.groupValues?.get(3) ?: dateFirst?.groupValues?.get(3)
    val mm = iso?.groupValues?.get(2) ?: timeFirst?.groupValues?.get(2) ?: dateFirst?.groupValues?.get(2)
    val dd = iso?.groupValues?.get(3) ?: timeFirst?.groupValues?.get(1) ?: dateFirst?.groupValues?.get(1)
    return if (yy == null || mm == null || dd == null) null
        else runCatching { LocalDate.of(yy.toInt(), mm.toInt(), dd.toInt()) }.getOrNull()
}

private fun Order.activePickup(): Boolean =
    deliveryValue("ttn").isNotBlank() &&
    normalizedStatus(deliveryValue("trackingNormalizedStatus")) == "ready_for_pickup" &&
    !deliveryFlag("trackingBuyerReceived") && !deliveryFlag("trackingReturnInProgress") &&
    !hasReturnSignal() &&
    !Regex("скас|отмен|cancel|закр|closed|заверш|виконан|completed|finished", RegexOption.IGNORE_CASE)
        .containsMatchIn(status.orEmpty())

// Manual server deadlines take precedence. If tracking saved the arrival but
// the reminder row was missed, use the same Nova five-day rule as the worker.
fun Order.effectivePickupReminder(saved: PickupReminderState?): PickupReminderState? {
    if (!activePickup()) return null
    val ttn = deliveryValue("ttn").trim()
    if (saved != null && saved.ttn.trim() == ttn &&
        runCatching { LocalDate.parse(saved.deadline) }.isSuccess) return saved
    val carrier = normalizedStatus(deliveryValue("carrier"))
    val provider = normalizedStatus(deliveryValue("trackingProvider"))
    if (!listOf("nova", "нова", "novaposhta", "новапошта").any(carrier::contains) &&
        !provider.contains("nova_poshta")) return null
    val arrival = pickupArrivalDate(deliveryValue("trackingPickupArrivedAt")) ?: return null
    return PickupReminderState(id, ttn, arrival.plusDays(5).toString())
}

fun Order.isPickupReminderDue(
    reminder: PickupReminderState?,
    today: LocalDate = pickupToday(),
): Boolean = pendingPickupReminder(reminder, today) != null

fun Order.needsPickupDeadline(reminder: PickupReminderState?): Boolean =
    activePickup() && effectivePickupReminder(reminder) == null

fun Order.pendingPickupReminder(
    reminder: PickupReminderState?,
    today: LocalDate = pickupToday(),
): PickupReminderStage? {
    val effective = effectivePickupReminder(reminder) ?: return null
    val deadline = LocalDate.parse(effective.deadline)
    return when (ChronoUnit.DAYS.between(today, deadline)) {
        0L -> if (effective.lastSentAt == null) PickupReminderStage.LAST else null
        1L -> if (effective.firstSentAt == null) PickupReminderStage.FIRST else null
        else -> null
    }
}

// Prefer shipment recipient; fall back to buyer when marketplaces omit
// recipientPhone (notably Prom). No valid phone means chat buttons stay disabled.
fun Order.pickupContactPhone(): String? =
    normalizeCustomerPhone(recipientPhone()) ?: normalizeCustomerPhone(phone.orEmpty())

fun Order.pickupReminderText(stage: PickupReminderStage, deadline: String, today: LocalDate = pickupToday()): String {
    val date = LocalDate.parse(deadline).format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))
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
    else "До завершення терміну отримання залишилось 2 календарні дні: сьогодні та завтра.\n\nБудь ласка, заберіть ваше замовлення до $date, щоб уникнути його повернення відправнику."
    return "Вітаємо!\n\n$intro\n\nВаше замовлення:\n$products\n\n📦 ТТН: ${deliveryValue("ttn").trim()}\n\n$time\n\nДякуємо!"
}

// Calendar-day midnight drives UI refresh; at most one notification after 08:00 Kyiv time.
internal fun millisUntilNextPickupDay(now: ZonedDateTime = ZonedDateTime.now(ZoneId.of(PICKUP_KYIV_ZONE))): Long {
    val kyiv = now.withZoneSameInstant(ZoneId.of(PICKUP_KYIV_ZONE))
    return Duration.between(kyiv, kyiv.toLocalDate().plusDays(1).atStartOfDay(kyiv.zone))
        .toMillis().coerceAtLeast(1_000L)
}

internal fun millisUntilPickupMorning(now: ZonedDateTime, nextDay: Boolean = false): Long {
    val kyiv = now.withZoneSameInstant(ZoneId.of(PICKUP_KYIV_ZONE))
    val date = if (nextDay || kyiv.hour >= 21) kyiv.toLocalDate().plusDays(1) else kyiv.toLocalDate()
    return Duration.between(kyiv, date.atTime(8, 0).atZone(kyiv.zone))
        .toMillis().coerceAtLeast(0L)
}
