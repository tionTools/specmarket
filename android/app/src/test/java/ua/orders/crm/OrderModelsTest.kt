package ua.orders.crm

import java.math.BigDecimal
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Test

class OrderModelsTest {
    private val email = "operator@example.com"
    private fun order(status: String, platform: String = "Пром") =
        Order("1", externalId = "prom:123", platform = platform, status = status)

    private fun delivery(vararg values: Pair<String, String>) = buildJsonObject {
        for ((key, value) in values) put(key, value)
    }

    @Test fun new_statuses_are_blue_and_route_only_working_marketplace_acceptance() {
        for (status in listOf("Новий", "Новый", "new", "pending", " PENDING ")) {
            assertTrue(isNewStatus(status))
            assertEquals(StatusTone.BLUE, orderStatusTone(order(status)))
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

    @Test fun visual_new_order_matches_web_crm_ttn_rule() {
        for (platform in listOf("Пром", "Эпицентр", "Каста")) {
            assertTrue(isNewOrderVisual(order("Прийнято", platform)))
            assertFalse(isNewOrderVisual(order("Прийнято", platform).copy(delivery = delivery("ttn" to "20450000000000"))))
        }
        assertFalse(isNewOrderVisual(order("Скасовано", "Пром")))
        assertFalse(isNewOrderVisual(order("Повернено", "Каста")))
        assertFalse(isNewOrderVisual(order("Новый", "Сайт")))
        assertFalse(isNewOrderVisual(order("Новый", "Р/С")))
    }

    @Test fun visual_new_order_is_independent_from_marketplace_acceptance_status() {
        val acceptedWithoutTtn = order("Принято", "Пром")
        assertTrue(isNewOrderVisual(acceptedWithoutTtn))
        assertFalse(isNewStatus(acceptedWithoutTtn.status))
        assertFalse(canAccept(acceptedWithoutTtn, email))
    }

    @Test fun appearance_resolves_system_and_overrides() {
        assertFalse(Appearance.SYSTEM.isDark(false))
        assertTrue(Appearance.SYSTEM.isDark(true))
        assertFalse(Appearance.LIGHT.isDark(true))
        assertTrue(Appearance.DARK.isDark(false))
    }

    @Test fun android_status_tones_match_web_crm_rules() {
        assertEquals(StatusTone.BLUE, orderStatusTone(order("Прийнято")))
        assertEquals(
            StatusTone.RED,
            orderStatusTone(order("Прийнято").copy(delivery = buildJsonObject {
                put("trackingNormalizedStatus", "in_transit")
                put("trackingReturnInProgress", true)
            })),
        )
        assertEquals(
            StatusTone.GREEN,
            orderStatusTone(order("Прийнято").copy(delivery = delivery("trackingNormalizedStatus" to "in_transit"))),
        )
        assertEquals(
            StatusTone.GREEN,
            orderStatusTone(order("Прийнято").copy(delivery = delivery("trackingNormalizedStatus" to "delivered"))),
        )
        assertEquals(StatusTone.ORANGE, orderStatusTone(order("Виконано")))
        assertEquals(
            StatusTone.ORANGE,
            orderStatusTone(order("Підтверджено", "Эпицентр").copy(
                externalId = "123",
                delivery = delivery("trackingNormalizedStatus" to "delivered"),
            )),
        )
        assertEquals(StatusTone.ORANGE, orderStatusTone(order("Закрыт", "Каста")))
        assertEquals(StatusTone.GREEN, orderStatusTone(order("В дороге", "Каста")))
        for (status in listOf("canceled", "cancelled", "скасовано", "returned", "повернено", "возврат")) {
            assertEquals(StatusTone.RED, orderStatusTone(order(status)))
            assertFalse(canAccept(order(status), email))
        }
    }

    @Test fun display_statuses_match_web_crm_labels() {
        assertEquals("Новий", displayOrderStatus("pending"))
        assertEquals("Виконано", displayOrderStatus("delivered"))
        assertEquals("Підтверджено продавцем", displayOrderStatus("confirmed_by_merchant"))
        assertEquals("Скасовано продавцем", displayOrderStatus("canceled_by_seller"))
        assertEquals("Принято", displayOrderStatus("received"))
    }

    @Test fun order_sort_is_by_order_date_and_time_not_updated_at() {
        val oldEditedLast = Order(
            "old",
            orderNumber = 3,
            orderDate = "05.09.2026",
            orderTime = "23:59",
            updatedAt = "2099-01-01T00:00:00Z",
        )
        val newMorning = Order(
            "new-morning",
            orderNumber = 4,
            orderDate = "07.09.2026",
            orderTime = "08:10",
            updatedAt = "2020-01-01T00:00:00Z",
        )
        val newEvening = Order(
            "new-evening",
            orderNumber = 5,
            orderDate = "07.09.2026",
            orderTime = "18:30",
            updatedAt = "2020-01-01T00:00:00Z",
        )
        assertEquals(
            listOf("new-evening", "new-morning", "old"),
            sortOrdersForDisplay(listOf(oldEditedLast, newMorning, newEvening)).map { it.id },
        )
    }

    @Test fun delivery_status_exposes_return_stage_and_live_carrier_checkpoint() {
        val returning = order("Прийнято").copy(delivery = buildJsonObject {
            put("trackingReturnInProgress", true)
            put("trackingNormalizedStatus", "in_transit")
            put("trackingStatus", "Прибула в депо 4")
        }).deliveryStatusInfo()
        assertEquals("Возвращается отправителю", returning.stage)
        assertEquals("Прибула в депо 4", returning.current)

        val staleRefusal = order("Прийнято").copy(delivery = buildJsonObject {
            put("trackingNormalizedStatus", "cancelled")
            put("trackingStatus", "Відмова від отримання")
        }).deliveryStatusInfo()
        assertEquals("Возвращается отправителю", staleRefusal.stage)
        assertEquals("", staleRefusal.current)

        val ordinary = order("Прийнято").copy(delivery = buildJsonObject {
            put("trackingNormalizedStatus", "in_transit")
            put("trackingStatus", "Прибула у відділення")
        }).deliveryStatusInfo()
        assertEquals("Прибула у відділення", ordinary.stage)
        assertEquals("", ordinary.current)
    }

    @Test fun detail_refresh_does_not_replace_a_loaded_list_with_transient_empty_result() {
        val current = listOf(Order("a"), Order("b"))
        assertEquals(current, ordersDuringDetailRefresh(current, emptyList(), true))
        assertTrue(ordersDuringDetailRefresh(current, emptyList(), false).isEmpty())
        val fetched = listOf(Order("c"))
        assertEquals(fetched, ordersDuringDetailRefresh(current, fetched, true))
    }

    @Test fun closing_detail_restores_cached_list_only_if_current_list_was_lost() {
        val cached = listOf(Order("a"), Order("b"))
        assertEquals(cached, ordersAfterClosingDetail(emptyList(), cached))
        val current = listOf(Order("c"))
        assertEquals(current, ordersAfterClosingDetail(current, cached))
        assertTrue(ordersAfterClosingDetail(emptyList(), emptyList()).isEmpty())
    }

    @Test fun notification_candidate_is_only_new_marketplace_order() {
        assertTrue(isNewOrderNotificationCandidate(order("Новий", "Пром")))
        assertTrue(isNewOrderNotificationCandidate(order("Новый", "Каста")))
        assertTrue(isNewOrderNotificationCandidate(order("pending", "Эпицентр")))
        assertFalse(isNewOrderNotificationCandidate(order("Прийнято", "Пром")))
        assertFalse(isNewOrderNotificationCandidate(order("Новый", "Сайт")))
    }

    @Test fun completed_accepted_and_delivery_states_never_allow_accept() {
        for (status in listOf("Принято", "received", "accepted", "completed", "delivered", "виконано", "В дорозі", "Принято перевозчиком")) {
            assertFalse(isNewStatus(status))
            assertFalse(canAccept(order(status), email))
            assertNotEquals(StatusTone.RED, orderStatusTone(order(status)))
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
