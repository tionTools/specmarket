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
}
