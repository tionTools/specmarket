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

    @Test fun reminders_due_on_two_days_and_final_day_independently() {
        assertEquals(PickupReminderStage.FIRST, order().pendingPickupReminder(state(2), date))
        assertEquals(PickupReminderStage.FIRST, order().pendingPickupReminder(state(1), date))
        assertEquals(PickupReminderStage.LAST, order().pendingPickupReminder(state(0, first = "done"), date))
        assertNull(order().pendingPickupReminder(state(2, first = "done"), date))
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
        assertTrue(message.contains("2 дні"))
        assertTrue(order().pickupReminderText(PickupReminderStage.LAST, state(0).deadline, date)
            .contains("сьогодні останній день"))
    }
}
