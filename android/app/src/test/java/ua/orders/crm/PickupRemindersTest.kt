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

    @Test fun missing_server_row_recovers_nova_deadline_from_arrival() {
        val nova = order().copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
            put("trackingPickupArrivedAt", "13:37 17.10.2026")
        })
        val oct20 = LocalDate.of(2026, 10, 20)
        assertEquals("2026-10-22", nova.effectivePickupReminder(null)?.deadline)
        assertNull(nova.pendingPickupReminder(null, oct20))
        assertEquals(PickupReminderStage.FIRST, nova.pendingPickupReminder(null, oct20.plusDays(1)))
        assertEquals(PickupReminderStage.LAST, nova.pendingPickupReminder(null, oct20.plusDays(2)))
        assertFalse(nova.needsPickupDeadline(null))
        val manual = PickupReminderState(nova.id, "20450000000000", "2026-10-24")
        assertEquals(manual, nova.effectivePickupReminder(manual))
    }

    @Test fun no_arrival_appears_as_unknown_not_false_alarm() {
        val noArrival = order().copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
        })
        assertTrue(noArrival.needsPickupDeadline(null))
        assertNull(noArrival.pendingPickupReminder(null, LocalDate.of(2026, 10, 21)))
    }


    @Test fun historic_ready_for_pickup_without_deadline_never_enters_reminder_queue() {
        val today = LocalDate.of(2026, 10, 21)
        val stale = order().copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
        })
        assertTrue(stale.needsPickupDeadline(null))
        assertFalse(stale.isPickupReminderDue(null, today))
        assertNull(stale.pendingPickupReminder(null, today))
    }

    @Test fun old_arrivals_from_october_7_and_10_never_reappear_as_due() {
        val today = LocalDate.of(2026, 10, 21)
        for (arrival in listOf("07.10.2026", "10.10.2026")) {
            val old = order().copy(delivery = buildJsonObject {
                put("ttn", "20450000000000")
                put("carrier", "Нова пошта")
                put("trackingNormalizedStatus", "ready_for_pickup")
                put("trackingPickupArrivedAt", arrival)
            })
            assertNotNull(old.effectivePickupReminder(null))
            assertFalse(old.isPickupReminderDue(null, today))
        }
    }

    @Test fun received_or_returned_shipments_cannot_create_reminders_even_with_stale_ready_flag() {
        val today = LocalDate.of(2026, 10, 21)
        val active = order().copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
            put("trackingPickupArrivedAt", "17.10.2026")
        })
        assertTrue(active.isPickupReminderDue(null, today))
        assertFalse(active.copy(status = "Получено").isPickupReminderDue(null, today))
        assertFalse(active.copy(status = "Отримано").isPickupReminderDue(null, today))
        assertFalse(active.copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
            put("trackingPickupArrivedAt", "17.10.2026")
            put("trackingDeliveredAt", "20.10.2026")
        }).isPickupReminderDue(null, today))
        assertFalse(active.copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
            put("trackingPickupArrivedAt", "17.10.2026")
            put("trackingBuyerReceived", true)
        }).isPickupReminderDue(null, today))
        assertFalse(active.copy(delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
            put("trackingPickupArrivedAt", "17.10.2026")
            put("trackingReturnInProgress", true)
        }).isPickupReminderDue(null, today))
    }

    @Test fun badge_and_reminder_list_use_same_fresh_server_snapshot() {
        val day = LocalDate.of(2026, 10, 21)
        val confirmed = order().copy(id = "due", delivery = buildJsonObject {
            put("ttn", "20450000000000")
            put("carrier", "Нова пошта")
            put("trackingNormalizedStatus", "ready_for_pickup")
            put("trackingPickupArrivedAt", "17.10.2026")
        })
        val stale = confirmed.copy(id = "old", status = "Отримано")
        val recentServer = listOf(confirmed)
        val reminders = emptyMap<String, PickupReminderState>()
        assertEquals(listOf("due"), duePickupOrders(recentServer, reminders, day).map { it.id })
        assertEquals(1, duePickupOrders(recentServer, reminders, day).size)
        // An extra stale order in one phone's local cache must not alter the remote count.
        assertEquals(2, listOf(confirmed, stale).size)
        assertEquals(1, duePickupOrders(recentServer, reminders, day).size)
    }

    @Test fun shared_confirmation_removes_first_stage_but_leaves_last_day_independent() {
        val day = LocalDate.of(2026, 10, 21)
        val source = listOf(order())
        val due = PickupReminderState("id", "20450000000000", day.plusDays(1).toString())
        val sent = due.copy(firstSentAt = "2026-10-21T09:00:00Z")
        assertEquals(1, duePickupOrders(source, mapOf("id" to due), day).size)
        assertTrue(duePickupOrders(source, mapOf("id" to sent), day).isEmpty())
        assertEquals(1, duePickupOrders(source, mapOf("id" to sent), day.plusDays(1)).size)
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
