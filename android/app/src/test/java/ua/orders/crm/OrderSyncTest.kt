package ua.orders.crm

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Test

class OrderSyncTest {
    @Test fun incremental_merge_preserves_old_orders_and_replaces_changed_rows() {
        val current = listOf(
            Order("old", customer = "Before", updatedAt = "2026-09-08T10:00:00Z"),
            Order("keep", customer = "Keep", updatedAt = "2026-09-08T10:01:00Z"),
        )
        val changed = listOf(
            Order("old", customer = "After", updatedAt = "2026-09-08T10:02:00Z"),
            Order("new", customer = "New", updatedAt = "2026-09-08T10:03:00Z"),
        )

        val merged = mergeOrders(current, changed)

        assertEquals(setOf("old", "keep", "new"), merged.map { it.id }.toSet())
        assertEquals("After", merged.single { it.id == "old" }.customer)
        assertEquals("Keep", merged.single { it.id == "keep" }.customer)
    }

    @Test fun sync_cursor_uses_latest_non_blank_updated_at() {
        assertEquals(
            "2026-09-08T10:03:00Z",
            latestOrderUpdatedAt(
                listOf(
                    Order("a", updatedAt = "2026-09-08T10:01:00Z"),
                    Order("b", updatedAt = ""),
                    Order("c", updatedAt = "2026-09-08T10:03:00Z"),
                ),
            ),
        )
        assertNull(latestOrderUpdatedAt(listOf(Order("a"))))
    }

    @Test fun manual_refresh_recovers_order_older_than_cached_updated_at_cursor() {
        assertEquals(30, MANUAL_REFRESH_RECENT_COUNT)
        val cached = listOf(
            Order("newest", customer = "Already cached", updatedAt = "2026-09-30T09:00:00Z"),
            Order("historical", customer = "Keep history", updatedAt = "2026-09-20T09:00:00Z"),
        )
        val missed = Order("missed", customer = "Recovered", updatedAt = "2026-09-30T07:00:00Z")
        val incremental = emptyList<Order>()

        assertTrue(missed.updatedAt!! < latestOrderUpdatedAt(cached)!!)
        assertFalse(mergeOrders(cached, incremental).any { it.id == missed.id })

        val manualResult = mergeOrders(cached, incremental + listOf(missed))

        assertEquals(setOf("newest", "historical", "missed"), manualResult.map { it.id }.toSet())
        assertEquals("Recovered", manualResult.single { it.id == "missed" }.customer)
    }

    @Test fun manual_refresh_uses_recent_server_snapshot_without_losing_cached_history() {
        val cached = listOf(
            Order("old", customer = "Retained", updatedAt = "2026-09-10T08:00:00Z"),
            Order("recent", customer = "Stale", updatedAt = "2026-09-30T08:00:00Z"),
        )
        val incremental = listOf(
            Order("recent", customer = "Incremental", updatedAt = "2026-09-30T08:00:00Z"),
        )
        val recent = listOf(
            Order("recent", customer = "Latest server value", updatedAt = "2026-09-30T08:00:00Z"),
            Order("missing", customer = "Recovered", updatedAt = "2026-09-30T07:00:00Z"),
        )

        val merged = mergeOrders(cached, incremental + recent)

        assertEquals(setOf("old", "recent", "missing"), merged.map { it.id }.toSet())
        assertEquals("Retained", merged.single { it.id == "old" }.customer)
        assertEquals("Latest server value", merged.single { it.id == "recent" }.customer)
    }

    @Test fun notification_rule_is_exactly_the_visual_new_order_rule() {
        val order = Order("1", platform = "Пром", status = "Принято")
        assertTrue(shouldNotifyNewOrder(order))
        assertFalse(
            shouldNotifyNewOrder(
                order.copy(delivery = buildJsonObject { put("ttn", "20450000000000") }),
            ),
        )
        assertFalse(shouldNotifyNewOrder(order.copy(status = "Скасовано")))
        assertFalse(shouldNotifyNewOrder(order.copy(platform = "Сайт")))
    }

    @Test fun customer_phone_is_normalized_for_dialer_and_messengers() {
        assertEquals("+380630107031", normalizeCustomerPhone("380630107031"))
        assertEquals("+380630107031", normalizeCustomerPhone("0630107031"))
        assertEquals("+380630107031", normalizeCustomerPhone("+380630107031"))
        assertEquals("+380630107031", normalizeCustomerPhone("+38 063 010 70 31"))
        assertEquals("+380675551122", normalizeCustomerPhone("067 555 11 22"))
        assertEquals("+380675551122", normalizeCustomerPhone("380675551122"))
        assertEquals("+380675551122", normalizeCustomerPhone("+38 (067) 555-11-22"))
        assertEquals("+4915112345678", normalizeCustomerPhone("+49 151 12345678"))
        assertNull(normalizeCustomerPhone("123"))
        assertNull(normalizeCustomerPhone(null))
    }

    @Test fun ukrainian_phone_display_is_full_international_format() {
        assertEquals("+38 067 555 11 22", formatCustomerPhoneForDisplay("380675551122"))
        assertEquals("+38 067 555 11 22", formatCustomerPhoneForDisplay("0675551122"))
        assertEquals("+38 067 555 11 22", formatCustomerPhoneForDisplay("+38 (067) 555-11-22"))
        assertEquals("+4915112345678", formatCustomerPhoneForDisplay("49 151 12345678"))
        assertEquals("—", formatCustomerPhoneForDisplay(null))
    }

    @Test fun prom_buyer_and_recipient_phones_are_independent_for_calls() {
        val order = Order(
            "prom",
            customer = "Покупатель",
            phone = "0631234567",
            platform = "Пром",
            delivery = buildJsonObject {
                put("recipient", "Получатель")
                put("recipientPhone", "0501112233")
            },
        )
        assertEquals("+38 063 123 45 67", order.buyerPhone())
        assertEquals("+38 050 111 22 33", order.recipientPhone())
        assertEquals("—", order.copy(phone = null).buyerPhone())
        assertEquals("—", order.copy(delivery = buildJsonObject { put("recipient", "Другой") }).recipientPhone())
        assertEquals("+38 063 123 45 67", order.copy(platform = "Каста", delivery = null).recipientPhone())
    }

    @Test fun connection_status_does_not_mistake_rest_success_for_offline() {
        assertEquals("Онлайн", connectionStatusLabel(true, false))
        assertEquals(
            "CRM доступна · live-подключение восстанавливается",
            connectionStatusLabel(false, true),
        )
        assertEquals("Офлайн · сохранённые данные", connectionStatusLabel(false, false))
    }

    @Test fun preferred_recipient_uses_delivery_recipient_with_customer_fallback() {
        val deliveryRecipient = Order(
            "recipient",
            customer = "Покупатель",
            phone = "0501112233",
            delivery = buildJsonObject {
                put("recipient", "Получатель")
                put("recipientPhone", "0675551122")
            },
        )
        assertEquals("Получатель", deliveryRecipient.recipientName())
        assertEquals("+38 067 555 11 22", deliveryRecipient.recipientPhone())
        assertEquals("Покупатель", Order("fallback", customer = "Покупатель").recipientName())
    }

    @Test fun local_search_matches_name_phone_order_ttn_and_product() {
        val order = Order(
            id = "42",
            orderLabel = "PRM-123456",
            customer = "Иван Петренко",
            phone = "+38 (067) 555-11-22",
            platform = "Пром",
            delivery = buildJsonObject {
                put("recipient", "Олег Иванов")
                put("recipientPhone", "050 777 88 99")
                put("ttn", "20 4515 2096 5986")
                put("city", "Харьков")
            },
            items = listOf(OrderItem(productName = "PROCERA X-DUOMAX", size = "10")),
        )
        assertTrue(order.matchesOrderSearch("иванов"))
        assertTrue(order.matchesOrderSearch("067555"))
        assertTrue(order.matchesOrderSearch("123456"))
        assertTrue(order.matchesOrderSearch("45152096"))
        assertTrue(order.matchesOrderSearch("duomax 10"))
        assertFalse(order.matchesOrderSearch("киев"))
    }

    @Test fun main_list_hides_pre_shipment_cancellation_but_keeps_return_after_movement() {
        val cancelled = Order(
            "cancelled",
            status = "Скасовано",
            delivery = buildJsonObject { put("trackingNormalizedStatus", "cancelled") },
        )
        val returning = Order(
            "returning",
            status = "Скасовано",
            delivery = buildJsonObject {
                put("trackingNormalizedStatus", "returning")
                put("printedAt", "2026-09-10T07:00:00Z")
            },
        )
        assertFalse(isOrderVisibleInMainList(cancelled))
        assertTrue(isOrderVisibleInMainList(returning))
    }

}
