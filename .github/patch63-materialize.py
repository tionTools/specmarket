from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert old in s, f"missing block in {path}"
    p.write_text(s.replace(old, new, 1))


replace(
    "android/app/build.gradle.kts",
    'defaultConfig { applicationId = "ua.orders.crm"; minSdk = 26; targetSdk = 36; versionCode = 3; versionName = "0.3" }',
    'defaultConfig { applicationId = "ua.orders.crm"; minSdk = 26; targetSdk = 36; versionCode = 4; versionName = "0.4" }',
)

path = Path("android/app/src/main/java/ua/orders/crm/OrderModels.kt")
s = path.read_text()
anchor = '''fun Order.deliveryFlag(key: String): Boolean =
    ((delivery as? JsonObject)?.get(key) as? JsonPrimitive)?.booleanOrNull == true

'''
addition = '''fun Order.deliveryFlag(key: String): Boolean =
    ((delivery as? JsonObject)?.get(key) as? JsonPrimitive)?.booleanOrNull == true

data class DeliveryStatusInfo(val stage: String = "", val current: String = "")

private fun isGenericReturnTrackingStatus(value: String) =
    Regex("відмова від (?:одержання|отримання)|^(?:отменено|скасовано|cancelled?)$|возвращается отправителю|повертається відправнику|return(?:ing| to sender)", RegexOption.IGNORE_CASE)
        .containsMatchIn(value.trim())

fun Order.deliveryStatusInfo(): DeliveryStatusInfo {
    val raw = deliveryValue("trackingStatus").trim()
    val normalized = deliveryValue("trackingNormalizedStatus").trim().lowercase(Locale.ROOT)
    val deliveryStatus = deliveryValue("status").trim()
    val rawImpliesReturn = Regex("відмова від (?:одержання|отримання)|возвращ|поверта|return", RegexOption.IGNORE_CASE)
        .containsMatchIn(raw)
    val returning = deliveryFlag("trackingReturnInProgress") || normalized == "returning" || rawImpliesReturn
    if (returning) {
        return DeliveryStatusInfo(
            stage = "Возвращается отправителю",
            current = raw.takeUnless { it.isBlank() || isGenericReturnTrackingStatus(it) }.orEmpty(),
        )
    }
    if (raw.isNotBlank()) return DeliveryStatusInfo(stage = raw)
    val stage = when (normalized) {
        "accepted" -> "Принято перевозчиком"
        "in_transit" -> "В пути"
        "ready_for_pickup" -> "Готово к выдаче"
        "delivered" -> "Получено"
        "returned" -> "Возвращено"
        "cancelled" -> "Отменено"
        else -> deliveryStatus
    }
    return DeliveryStatusInfo(stage = stage)
}

fun ordersAfterClosingDetail(current: List<Order>, beforeDetail: List<Order>): List<Order> =
    if (current.isEmpty() && beforeDetail.isNotEmpty()) beforeDetail else current

'''
assert anchor in s
path.write_text(s.replace(anchor, addition, 1))

path = Path("android/app/src/main/java/ua/orders/crm/OrdersViewModel.kt")
s = path.read_text()
s = s.replace(
    "    private var visible = false\n",
    "    private var visible = false\n    private var ordersBeforeDetail: List<Order> = emptyList()\n",
    1,
)
s = s.replace(
    "    private fun clearOrders() {\n        orders = emptyList(); selectedId = null; detail = null\n    }",
    "    private fun clearOrders() {\n        orders = emptyList(); ordersBeforeDetail = emptyList(); selectedId = null; detail = null\n    }",
    1,
)
s = s.replace(
    "    fun open(id: String) {\n        selectedId = id; detail = orders.find { it.id == id }",
    "    fun open(id: String) {\n        ordersBeforeDetail = orders\n        selectedId = id; detail = orders.find { it.id == id }",
    1,
)
s = s.replace(
    "    fun closeDetail() { selectedId = null; detail = null }",
    '''    fun closeDetail() {
        orders = ordersAfterClosingDetail(orders, ordersBeforeDetail)
        ordersBeforeDetail = emptyList()
        selectedId = null
        detail = null
        if (email != null) refresh()
    }''',
    1,
)
path.write_text(s)

path = Path("android/app/src/main/java/ua/orders/crm/MainActivity.kt")
s = path.read_text()
anchor = '''@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OrdersScreen(vm: OrdersViewModel, onSettings: () -> Unit) {'''
addition = '''@Composable
private fun DeliveryStatus(order: Order, compact: Boolean = false) {
    val status = order.deliveryStatusInfo()
    if (status.stage.isBlank()) return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            "Доставка: ${status.stage}",
            style = if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (status.current.isNotBlank()) {
            Text(
                "Текущий статус: ${status.current}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OrdersScreen(vm: OrdersViewModel, onSettings: () -> Unit) {'''
assert anchor in s
s = s.replace(anchor, addition, 1)
s = s.replace(
    '                            StatusLabel(order)\n                            Text(money(order.total()), style = MaterialTheme.typography.titleMedium)',
    '                            StatusLabel(order)\n                            DeliveryStatus(order, compact = true)\n                            Text(money(order.total()), style = MaterialTheme.typography.titleMedium)',
    1,
)
old = '''                for ((key, label) in listOf("carrier" to "Перевозчик", "recipient" to "Получатель",
                    "recipientPhone" to "Телефон получателя", "city" to "Город", "address" to "Адрес",
                    "ttn" to "ТТН", "payer" to "Плательщик", "trackingStatus" to "Статус доставки")) {
                    DetailField(label, order.deliveryField(key))
                }
                DetailField("Расход продавца на доставку", order.shipping?.let { money(BigDecimal.valueOf(it)) } ?: "—")'''
new = '''                for ((key, label) in listOf("carrier" to "Перевозчик", "recipient" to "Получатель",
                    "recipientPhone" to "Телефон получателя", "city" to "Город", "address" to "Адрес",
                    "ttn" to "ТТН", "payer" to "Плательщик")) {
                    DetailField(label, order.deliveryField(key))
                }
                val deliveryStatus = order.deliveryStatusInfo()
                DetailField("Статус доставки", deliveryStatus.stage.display())
                if (deliveryStatus.current.isNotBlank()) DetailField("Текущий статус", deliveryStatus.current)
                DetailField("Расход продавца на доставку", order.shipping?.let { money(BigDecimal.valueOf(it)) } ?: "—")'''
assert old in s
path.write_text(s.replace(old, new, 1))

path = Path("android/app/src/test/java/ua/orders/crm/OrderModelsTest.kt")
s = path.read_text()
anchor = '''    @Test fun notification_candidate_is_only_new_marketplace_order() {'''
tests = '''    @Test fun delivery_status_exposes_return_stage_and_live_carrier_checkpoint() {
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

    @Test fun closing_detail_restores_cached_list_only_if_current_list_was_lost() {
        val cached = listOf(Order("a"), Order("b"))
        assertEquals(cached, ordersAfterClosingDetail(emptyList(), cached))
        val current = listOf(Order("c"))
        assertEquals(current, ordersAfterClosingDetail(current, cached))
        assertTrue(ordersAfterClosingDetail(emptyList(), emptyList()).isEmpty())
    }

    @Test fun notification_candidate_is_only_new_marketplace_order() {'''
assert anchor in s
path.write_text(s.replace(anchor, tests, 1))
