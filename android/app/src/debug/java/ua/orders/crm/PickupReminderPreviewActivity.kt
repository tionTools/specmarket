package ua.orders.crm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Debug-only authenticated-screen fixture: verifies Compose rendering with orders
// and reminders without connecting to production CRM or using credentials.
class PickupReminderPreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val now = pickupToday()
        val order = reviewPickupOrder("fixture-first", "Нова Пошта")
        val last = reviewPickupOrder("fixture-last", "Нова Пошта")
        val missing = reviewPickupOrder("fixture-missing", "Нова Пошта")
        val sent = reviewPickupOrder("fixture-sent", "Нова Пошта")
        val reminders = listOf(
            PickupReminderState(order.id, "20450000000000", now.plusDays(2).toString()),
            PickupReminderState(last.id, "20450000000000", now.toString(), firstSentAt = "2026-10-16T08:00:00Z"),
            PickupReminderState(sent.id, "20450000000000", now.plusDays(1).toString(), firstSentAt = "2026-10-16T08:00:00Z"),
        ).associateBy { it.orderId }
        setContent {
            MaterialTheme(colorScheme = ordersColors(false), typography = ordersTypography(false)) {
                PickupReminderContent(
                    orders = listOf(order, last, missing, sent),
                    reminders = reminders,
                    loading = false,
                    busy = false,
                    error = null,
                    onBack = {},
                    onRefresh = {},
                    onSaveDeadline = { _, _ -> },
                    onConfirmSent = { _, _, _ -> },
                )
            }
        }
    }
}

private fun reviewPickupOrder(id: String, carrier: String): Order = Order(
    id = id,
    orderNumber = 950123L,
    customer = "Синтетический клиент",
    phone = "+380501112233",
    platform = "Пром",
    status = "Відправлено",
    delivery = buildJsonObject {
        put("ttn", "20450000000000")
        put("carrier", carrier)
        put("trackingNormalizedStatus", "ready_for_pickup")
        put("trackingLocation", "Пункт видачі НП")
    },
)
