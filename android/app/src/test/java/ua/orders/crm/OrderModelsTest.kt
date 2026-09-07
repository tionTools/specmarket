package ua.orders.crm

import java.math.BigDecimal
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class OrderModelsTest {
    private val email = "operator@example.com"
    private fun order(status: String, platform: String = "Пром") =
        Order("1", externalId = "prom:123", platform = platform, status = status)

    @Test fun new_statuses_are_blue_and_route_only_working_marketplace_acceptance() {
        for (status in listOf("Новий", "Новый", "new", "pending", " PENDING ")) {
            assertTrue(isNewStatus(status))
            assertEquals(StatusTone.NEW, statusTone(status))
            assertEquals(AcceptRoute.PROM, acceptRoute(order(status), email))
            assertEquals(
                AcceptRoute.EPICENTR,
                acceptRoute(order(status, "Эпицентр").copy(externalId = "123"), email),
            )
            val kasta = order(status, "Каста").copy(externalId = "kasta:123")
            assertNull(acceptRoute(kasta, email))
            assertNotNull(acceptUnavailableReason(kasta, email))
        }
    }
    @Test fun appearance_resolves_system_and_overrides() {
        assertFalse(Appearance.SYSTEM.isDark(false))
        assertTrue(Appearance.SYSTEM.isDark(true))
        assertFalse(Appearance.LIGHT.isDark(true))
        assertTrue(Appearance.DARK.isDark(false))
    }
    @Test fun cancelled_and_returned_are_red_and_never_acceptable() {
        for (status in listOf("canceled", "cancelled", "скасовано", "returned", "повернено", "возврат")) {
            assertEquals(StatusTone.NEGATIVE, statusTone(status))
            assertFalse(canAccept(order(status), email))
        }
    }
    @Test fun completed_accepted_and_delivery_states_never_allow_accept() {
        for (status in listOf("Принято", "received", "accepted", "completed", "delivered", "виконано", "В дорозі", "Принято перевозчиком")) {
            assertFalse(isNewStatus(status))
            assertFalse(canAccept(order(status), email))
            assertNotEquals(StatusTone.NEGATIVE, statusTone(status))
        }
    }
    @Test fun guest_unauthenticated_and_missing_external_id_are_not_writable() {
        assertFalse(canAccept(order("new"), "GUEST@gmail.com"))
        assertFalse(canAccept(order("new"), null))
        assertFalse(canAccept(order("new").copy(externalId = null), email))
        assertFalse(canAccept(order("new").copy(externalId = "kasta:123"), email))
    }
    @Test fun total_uses_all_items_without_binary_rounding() {
        val value = Order("1", items = listOf(OrderItem(price = 10.25, quantity = 2.0), OrderItem(price = 0.1, quantity = 3.0)))
        assertEquals(0, BigDecimal("20.8").compareTo(value.total()))
        assertEquals(0, BigDecimal.ZERO.compareTo(Order("empty").total()))
    }
    @Test fun nullable_and_unknown_delivery_json_remains_readable() {
        val json = Json { ignoreUnknownKeys = true }
        val parsed = json.decodeFromString<Order>("""{"id":"1","customer":null,"status":null,"delivery":{"ttn":123,"city":null,"unknown":{"future":true}},"future":true,"crm_order_items":[{"product_name":null,"size":null,"price":null,"quantity":null}]}""")
        assertEquals("123", parsed.deliveryField("ttn"))
        assertEquals("—", parsed.deliveryField("city"))
        assertEquals("—", parsed.deliveryField("unknown"))
        assertEquals("—", parsed.number())
        for (delivery in listOf("null", "[]", "42", "\"unknown\"")) {
            assertEquals("—", json.decodeFromString<Order>("""{"id":"1","delivery":$delivery}""").deliveryField("ttn"))
        }
    }
}
