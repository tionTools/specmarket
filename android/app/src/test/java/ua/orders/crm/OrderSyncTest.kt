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

    @Test fun customer_phone_is_normalized_for_viber_and_telegram() {
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
