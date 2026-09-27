package ua.orders.crm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Debug-only screen: renders the production OrderCard with synthetic data, no CRM credentials.
class OrderCardReviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scenario = intent.getStringExtra("scenario") ?: "long"
        setContent {
            MaterialTheme(colorScheme = ordersColors(false)) {
                Column(
                    modifier = Modifier.fillMaxSize()
                        .background(MaterialTheme.colorScheme.background)
                        .verticalScroll(rememberScrollState())
                        .padding(12.dp),
                ) {
                    Text(
                        "UI REVIEW · SYNTHETIC DATA · $scenario",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    OrderCard(reviewOrder(scenario), onClick = {})
                    Spacer(Modifier.height(12.dp))
                    OrderCard(reviewOrder("short"), onClick = {})
                }
            }
        }
    }
}

private fun reviewOrder(scenario: String): Order {
    val long = scenario == "long"
    val many = scenario == "many" || long
    val noTtn = scenario == "no-ttn"
    return Order(
        id = "synthetic-$scenario",
        orderNumber = 429867636,
        orderDate = "25.09.2026",
        orderTime = "18:52",
        platform = if (noTtn) "Эпицентр" else "Пром",
        status = if (noTtn) "Прийнято" else "Виконано",
        customer = if (long) "Анастасия Александровна Лашуня-Демченко" else "Лашуня Анастасия",
        phone = "+38 050 018 40 34",
        items = listOf(
            OrderItem(
                position = 1,
                productName = if (long)
                    "Шкіряні зварювальні нарукавники зі спилку Welder Lux 7777 Trident, захисні для майстерні"
                else "Рукавички білі бавовняні, трикотажні",
                size = "XL",
                quantity = 3.0,
                price = 200.0,
                royaltyAmount = 67.86,
            ),
        ) + if (many) listOf(
            OrderItem(position = 2, productName = "Другий товар", quantity = 1.0, price = 125.0, royaltyAmount = 12.5),
            OrderItem(position = 3, productName = "Третій товар", quantity = 1.0, price = 75.0, royaltyAmount = 7.5),
        ) else emptyList(),
        delivery = buildJsonObject {
            if (!noTtn) put("ttn", "20451545489878")
            put("carrier", "Нова Пошта")
            put(
                "trackingStatus",
                when {
                    noTtn -> "Заплановано"
                    long -> "Відправлення прямує до с. Коболчин. Наступне оновлення після прибуття на сортувальний термінал."
                    else -> "Відправлення отримано"
                },
            )
            if (noTtn) put("status", "planned")
        },
    )
}
