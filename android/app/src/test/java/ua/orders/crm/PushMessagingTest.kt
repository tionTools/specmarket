package ua.orders.crm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushMessagingTest {
    @Test
    fun parsesNewOrderDataForNotification() {
        val notification = pushOrderNotification(
            mapOf(
                "type" to "new_order",
                "order_id" to "11111111-2222-3333-4444-555555555555",
                "platform" to "Пром",
                "total" to "123.40 грн",
                "customer" to "Іван",
                "order_number" to "A-42",
            ),
        )

        assertEquals("11111111-2222-3333-4444-555555555555", notification?.orderId)
        assertEquals("Пром", notification?.platform)
        assertEquals("123.40 грн", notification?.total)
        assertEquals("Іван", notification?.customer)
        assertEquals("A-42", notification?.number)
    }

    @Test
    fun ignoresUnknownOrIncompletePushes() {
        assertNull(pushOrderNotification(mapOf("type" to "other", "order_id" to "1")))
        assertNull(pushOrderNotification(mapOf("type" to "new_order")))
    }
}
