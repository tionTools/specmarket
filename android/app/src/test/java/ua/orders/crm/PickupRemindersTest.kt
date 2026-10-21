package ua.orders.crm

import java.time.LocalDate
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Test

class PickupRemindersTest {
    private val date = LocalDate.of(2026, 10, 17)
    private fun order(ttn: String = "20450000000000", status: String = "В дороге") =
        Order(id = "id", orderNumber = 123L, status = status, delivery = buildJsonObject {
            put("ttn", ttn)
            put("trackingNormalizedStatus", "ready_for_pickup")
        }, items = listOf(OrderItem(productName = "Рукавички", size = "10", quantity = 2.0)))
    private fun state(days: Long, first: String? = null, last: String? = null) =
        PickupReminderState("id", "20450000000000", date.plusDays(days).toString(), firstSentAt = first, lastSentAt = last)

    @Test fun remind_filter_excludes_undated_sent_and_non_due_orders() {
        assertFalse(order().isPickupReminderDue(state(2), date))
        assertTrue(order().isPickupReminderDue(state(1), date))
        assertTrue(order().isPickupReminderDue(state(0), date))
        assertFalse(order().isPickupReminderDue(null, date))
        assertFalse(order().isPickupReminderDue(state(3), date))
        assertFalse(order().isPickupReminderDue(state(1, first = "sent"), date))
        assertFalse(order().isPickupReminderDue(state(0, last = "sent"), date))
        assertFalse(order(status = "Скасовано").isPickupReminderDue(state(1), date))
        assertFalse(order().copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("trackingNormalizedStatus", "in_transit")
        }).isPickupReminderDue(state(2), date))
    }

    @Test fun acknowledged_reminder_no_longer_due_and_final_stage_stays_independent() {
        val sent = state(1).copy(firstSentAt = "2026-10-20T09:00:00Z", firstChannel = "telegram")
        assertNull(order().pendingPickupReminder(sent, date))
        val final = sent.copy(deadline = date.toString())
        assertEquals(PickupReminderStage.LAST, order().pendingPickupReminder(final, date))
        assertNull(order().pendingPickupReminder(final.copy(lastSentAt = "2026-10-20T09:30:00Z"), date))
    }

    @Test fun reminders_due_on_two_days_and_final_day_independently() {
        assertNull(order().pendingPickupReminder(state(2), date))
        assertEquals(PickupReminderStage.FIRST, order().pendingPickupReminder(state(1), date))
        assertEquals(PickupReminderStage.LAST, order().pendingPickupReminder(state(0, first = "done"), date))
        assertNull(order().pendingPickupReminder(state(1, first = "done"), date))
        assertNull(order().pendingPickupReminder(state(0, last = "done"), date))
        assertNull(order().pendingPickupReminder(state(3), date))
        assertNull(order().pendingPickupReminder(state(-1), date))
    }

    @Test fun stale_ttn_and_returned_orders_never_trigger() {
        assertNull(order("new").pendingPickupReminder(state(2), date))
        assertNull(order(status = "Скасовано").pendingPickupReminder(state(2), date))
        assertNull(order(status = "Виконано").pendingPickupReminder(state(2), date))
        assertNull(order().copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("trackingNormalizedStatus", "in_transit")
        }).pendingPickupReminder(state(2), date))
        assertNull(order().pendingPickupReminder(state(2).copy(deadline = "bad"), date))
    }

    @Test fun nova_pickup_point_is_highlighted_only_when_explicitly_named() {
        fun shipment(carrier: String, destination: String, ttn: String = "20450000000000") =
            order().copy(delivery = buildJsonObject {
                put("carrier", carrier)
                put("ttn", ttn)
                put("trackingLocation", destination)
            })

        assertTrue(shipment("Нова пошта", "Пункт приймання-видачі №5").isNovaPickupPoint())
        assertFalse(shipment("Нова пошта", "Супервізор ПВЗx").isNovaPickupPoint())
        assertTrue(shipment("Nova Poshta", "Пункт видачі №12").isNovaPickupPoint())
        assertTrue(shipment("Новая Почта", "Пункт приема-выдачи №2").isNovaPickupPoint())
        assertTrue(shipment("novaposhta", "Parcel Shop №43").isNovaPickupPoint())
        assertTrue(shipment("Нова пошта", "ПВЗ №9").isNovaPickupPoint())
        assertFalse(shipment("Нова пошта", "Відділення №2").isNovaPickupPoint())
        assertFalse(shipment("Нова пошта", "Поштомат №2").isNovaPickupPoint())
        assertFalse(shipment("Нова пошта", "вул. Центральна, 3").isNovaPickupPoint())
        assertFalse(shipment("Укрпошта", "Пункт видачі №12").isNovaPickupPoint())
        assertFalse(shipment("Нова пошта", "Пункт видачі №12", "").isNovaPickupPoint())
    }

    @Test fun nova_pickup_point_can_be_identified_from_existing_destination_address() {
        val parcel = order().copy(delivery = buildJsonObject {
            put("carrier", "Нова пошта")
            put("ttn", "20450000000000")
            put("trackingDestinationAddress", "м. Харків, Пункт видачі №77")
        })
        assertTrue(parcel.isNovaPickupPoint())
    }

    @Test fun arrivals_without_confirmed_deadline_are_actionable_in_reminder_filter() {
        assertTrue(order().needsPickupDeadline(null))
        assertFalse(order().needsPickupDeadline(state(2)))
        assertTrue(order().needsPickupDeadline(state(2).copy(ttn = "old-ttn")))
        assertFalse(order(ttn = "").needsPickupDeadline(null))
        assertFalse(order(status = "Скасовано").needsPickupDeadline(null))
        assertFalse(order().copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("trackingNormalizedStatus", "in_transit")
        }).needsPickupDeadline(null))
    }

    @Test fun ukranian_text_contains_products_number_ttn_and_deadline() {
        val message = order().pickupReminderText(PickupReminderStage.FIRST, state(2).deadline, date)
        assertTrue(message.contains("№123"))
        assertTrue(message.contains("Рукавички, розмір 10 — 2 шт."))
        assertTrue(message.contains("20450000000000"))
        assertTrue(message.contains("19.10.2026"))
        assertTrue(message.contains("До завершення терміну отримання залишилось 2 календарні дні: сьогодні та завтра."))
        val oneDay = order().pickupReminderText(PickupReminderStage.FIRST, state(1).deadline, date)
        assertTrue(oneDay.contains("До завершення терміну отримання залишилось 2 календарні дні: сьогодні та завтра."))
        assertFalse(oneDay.contains("залишилося 1 день"))
        assertTrue(order().pickupReminderText(PickupReminderStage.LAST, state(0).deadline, date)
            .contains("сьогодні останній день"))
    }

    @Test fun messaging_uses_buyer_phone_when_prom_recipient_phone_is_missing() {
        val prom = order().copy(platform = "Пром", phone = "+380501112233")
        assertNotNull(prom.pickupContactPhone())
        val recipient = prom.copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("trackingNormalizedStatus", "ready_for_pickup")
            put("recipientPhone", "+380671112233")
        })
        assertEquals(normalizeCustomerPhone("+380671112233"), recipient.pickupContactPhone())
        val invalid = order().copy(platform = "Пром", phone = null)
        assertNull(invalid.pickupContactPhone())
    }
    @Test fun deadline_october_22_shows_october_21_and_22_only() {
        val today = LocalDate.of(2026, 10, 20)
        val reminder = PickupReminderState("id", "20450000000000", "2026-10-22")
        assertNull(order().pendingPickupReminder(reminder, today))
        assertEquals(PickupReminderStage.FIRST, order().pendingPickupReminder(reminder, today.plusDays(1)))
        assertEquals(PickupReminderStage.LAST,
            order().pendingPickupReminder(reminder.copy(firstSentAt = "2026-10-21T09:00:00Z"), today.plusDays(2)))
        assertNull(order().pendingPickupReminder(reminder, today.plusDays(3)))
    }

    @Test fun morning_notification_window_never_starts_before_eight() {
        val zone = java.time.ZoneId.of(PICKUP_KYIV_ZONE)
        val date = LocalDate.of(2026, 10, 21)
        assertEquals(30 * 60 * 1000L, millisUntilPickupMorning(date.atTime(7, 30).atZone(zone)))
        assertEquals(0L, millisUntilPickupMorning(date.atTime(8, 0).atZone(zone)))
        assertEquals(11 * 60 * 60 * 1000L, millisUntilPickupMorning(date.atTime(21, 0).atZone(zone)))
        assertEquals(24 * 60 * 60 * 1000L, millisUntilPickupMorning(date.atTime(8, 0).atZone(zone), nextDay = true))
    }

    @Test fun kyiv_service_date_uses_legacy_android_timezone_id() {
        assertEquals("Europe/Kiev", PICKUP_KYIV_ZONE)
        val zone = java.time.ZoneId.of(PICKUP_KYIV_ZONE)
        assertEquals("Europe/Kiev", zone.id)
        assertEquals(
            LocalDate.of(2026, 10, 18),
            java.time.Instant.parse("2026-10-17T22:00:00Z").atZone(zone).toLocalDate()
        )
    }
}
