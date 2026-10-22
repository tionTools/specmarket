package ua.orders.crm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.*
import androidx.compose.material3.Text
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
        val queue = listOf(
            PickupQueueRow(order.id, 950123L, "20450000000000", carrier = "Нова Пошта",
                deadline = now.plusDays(1).toString(), daysLeft = 1,
                category = "urgent", stage = "first"),
            PickupQueueRow(last.id, 950124L, "20450000000000", carrier = "Нова Пошта",
                deadline = now.toString(), daysLeft = 0, category = "urgent", stage = "last",
                firstSentAt = "2026-10-20T07:17:00Z"),
            PickupQueueRow(missing.id, 950125L, "20450000000000",
                carrier = "Нова Пошта", category = "informational"),
            PickupQueueRow(sent.id, 950126L, "20450000000000",
                carrier = "Нова Пошта", deadline = now.plusDays(1).toString(),
                daysLeft = 1, category = "informational", firstSentAt = "2026-10-20T07:17:00Z"),
        )
        setContent {
            MaterialTheme(colorScheme = ordersColors(false), typography = ordersTypography(false)) {
                var selected by remember { mutableStateOf(OrderListFilter.REMIND) }
                val all = listOf(order, last, missing, sent)
                Column {
                    OrderFilters(all, queue, true, selected, { selected = it })
                    if (selected == OrderListFilter.REMIND) {
                        PickupReminderContent(
                            orders = all,
                            queue = queue,
                            manualHistory = emptyMap(),
                            loading = false,
                            busy = false,
                            error = null,
                            onRefresh = {},
                            onSaveDeadline = { _, _ -> },
                            onConfirmSent = { _, _, _ -> },
                            onConfirmManualSent = { _, _ -> },
                        )
                    } else {
                        Text("Пример обычного списка заказов")
                    }
                }
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
