from pathlib import Path

def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, got {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")

replace_once(
    "android/app/build.gradle.kts",
    '        versionCode = 7\n        versionName = "0.7"',
    '        versionCode = 8\n        versionName = "0.8"',
)
replace_once(
    "android/app/build.gradle.kts",
    '    implementation("androidx.compose.material3:material3")\n',
    '    implementation("androidx.compose.material3:material3")\n'
    '    implementation("androidx.compose.material:material-icons-core")\n',
)
replace_once(
    "android/app/src/main/java/ua/orders/crm/Appearance.kt",
    '        background = Color(0xFFF8FAFC),',
    '        background = Color(0xFFEEF0F3),',
)

models = Path("android/app/src/main/java/ua/orders/crm/OrderModels.kt")
text = models.read_text(encoding="utf-8")
anchor = 'fun Order.shipments(): List<JsonObject> = (((delivery as? JsonObject)?.get("shipmentHistory")) as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()\n'
if text.count(anchor) != 1:
    raise SystemExit("OrderModels shipment anchor missing or duplicated")
helpers = r'''

fun Order.recipientName(): String =
    deliveryValue("recipient").trim().ifBlank { customer.orEmpty().trim() }.display()

fun Order.recipientPhone(): String =
    deliveryValue("recipientPhone").trim().ifBlank { phone.orEmpty().trim() }.display()

private val returnSignalRegex = Regex(
    "скас|отмен|cancel|повер|возврат|return|refund|відмов.*отрим",
    RegexOption.IGNORE_CASE,
)

fun Order.hasPhysicalShipmentMovement(): Boolean {
    if (deliveryValue("printedAt").trim().isNotEmpty()) return true
    return deliveryValue("trackingNormalizedStatus").trim().lowercase(Locale.ROOT) in setOf(
        "accepted", "in_transit", "ready_for_pickup", "delivered", "returning", "returned",
    )
}

fun Order.hasReturnSignal(): Boolean {
    val normalizedTracking = deliveryValue("trackingNormalizedStatus").trim().lowercase(Locale.ROOT)
    return normalizedTracking in setOf("returning", "returned") ||
        returnSignalRegex.containsMatchIn(displayOrderStatus(status)) ||
        returnSignalRegex.containsMatchIn(deliveryValue("trackingStatus")) ||
        returnSignalRegex.containsMatchIn(deliveryValue("status"))
}

/** Mirrors Web CRM: cancellation before physical shipment is hidden; returns stay in the main list. */
fun isOrderVisibleInMainList(order: Order): Boolean =
    !order.hasReturnSignal() || order.hasPhysicalShipmentMovement()

private fun searchCompact(value: String): String =
    value.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() }

fun Order.matchesOrderSearch(query: String): Boolean {
    val terms = query.trim().lowercase(Locale.ROOT).split(Regex("\\s+")).filter(String::isNotBlank)
    if (terms.isEmpty()) return true
    val searchable = buildList {
        add(id)
        add(externalId.orEmpty())
        add(number())
        add(orderDate.orEmpty())
        add(orderTime.orEmpty())
        add(platform.orEmpty())
        add(displayOrderStatus(status))
        add(customer.orEmpty())
        add(phone.orEmpty())
        add(recipientName())
        add(recipientPhone())
        add(delivery?.toString().orEmpty())
        items.forEach { item ->
            add(item.productName.orEmpty())
            add(item.size.orEmpty())
            add(item.quantity?.toString().orEmpty())
        }
    }
    val plain = searchable.joinToString(" ").lowercase(Locale.ROOT)
    val compact = searchCompact(searchable.joinToString(" "))
    return terms.all { term ->
        plain.contains(term) ||
            searchCompact(term).takeIf { it.length >= 2 }?.let(compact::contains) == true
    }
}
'''
models.write_text(text.replace(anchor, anchor + helpers, 1), encoding="utf-8")

Path("android/app/src/main/java/ua/orders/crm/OrdersCache.kt").write_text(r'''package ua.orders.crm

import android.content.Context
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class OrdersCacheSnapshot(
    val account: String,
    val orders: List<Order> = emptyList(),
    val pendingNotificationIds: Set<String> = emptySet(),
)

class OrdersCache(context: Context) {
    private val file = File(context.filesDir, "orders-cache.json")
    private val backup = File(context.filesDir, "orders-cache.backup.json")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun readSnapshot(source: File): OrdersCacheSnapshot? {
        if (!source.isFile) return null
        return runCatching {
            json.decodeFromString<OrdersCacheSnapshot>(source.readText(Charsets.UTF_8))
        }.getOrNull()
    }

    suspend fun load(account: String): OrdersCacheSnapshot? = withContext(Dispatchers.IO) {
        val matching = sequenceOf(file, backup)
            .mapNotNull(::readSnapshot)
            .filter { it.account.equals(account, ignoreCase = true) }
            .toList()
        matching.firstOrNull { it.orders.isNotEmpty() } ?: matching.firstOrNull()
    }

    suspend fun save(account: String, orders: List<Order>, pendingNotificationIds: Set<String>) =
        withContext(Dispatchers.IO) {
            file.parentFile?.mkdirs()
            if (readSnapshot(file) != null) {
                runCatching {
                    Files.copy(file.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING)
                }
            }
            val temporary = File(file.parentFile, "${file.name}.tmp")
            temporary.writeText(
                json.encodeToString(
                    OrdersCacheSnapshot(
                        account = account,
                        orders = orders,
                        pendingNotificationIds = pendingNotificationIds,
                    ),
                ),
                Charsets.UTF_8,
            )
            try {
                Files.move(
                    temporary.toPath(),
                    file.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
            if (!backup.isFile) {
                runCatching {
                    Files.copy(file.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING)
                }
            }
        }
}
''', encoding="utf-8")

replace_once(
    "android/app/src/main/java/ua/orders/crm/OrdersViewModel.kt",
    '''    fun refresh() {
        if (email == null || loading) return
        val account = email
        loading = true
        viewModelScope.launch {
            try {
                requests.withLock {
                    val baselineComplete = initialLoadComplete
''',
    '''    fun refresh() {
        if (email == null || loading) return
        val account = email ?: return
        loading = true
        viewModelScope.launch {
            try {
                requests.withLock {
                    if (orders.isEmpty()) {
                        cache.load(account)?.let { cached ->
                            if (cached.orders.isNotEmpty()) {
                                orders = sortOrdersForDisplay(cached.orders)
                                pendingNotificationIds.clear()
                                pendingNotificationIds.addAll(cached.pendingNotificationIds)
                                initialLoadComplete = true
                            }
                        }
                    }
                    val baselineComplete = initialLoadComplete
''',
)

main = Path("android/app/src/main/java/ua/orders/crm/MainActivity.kt")
text = main.read_text(encoding="utf-8")
text = text.replace(
    'import androidx.compose.foundation.text.KeyboardOptions\n',
    'import androidx.compose.foundation.text.KeyboardOptions\n'
    'import androidx.compose.material.icons.Icons\n'
    'import androidx.compose.material.icons.filled.Close\n'
    'import androidx.compose.material.icons.filled.Search\n',
    1,
)
old_section = '''        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
'''
new_section = '''        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
'''
if text.count(old_section) != 1:
    raise SystemExit(f"SectionCard anchor count {text.count(old_section)}")
text = text.replace(old_section, new_section, 1)
marker = '@Composable\nprivate fun StatusLabel(order: Order) {'
pos = text.find(marker)
if pos < 0:
    raise SystemExit("MainActivity StatusLabel marker missing")
tail = r'''@Composable
private fun StatusLabel(order: Order, compact: Boolean = false) {
    if (isNewOrderVisual(order)) {
        Surface(
            shape = RoundedCornerShape(999.dp),
            color = Color(0xFFE879F9),
            contentColor = Color(0xFF4A044E),
            border = BorderStroke(1.dp, Color(0xFFC026D3)),
        ) {
            Text(
                if (compact) "НОВЫЙ" else "НОВЫЙ ЗАКАЗ",
                modifier = Modifier.padding(horizontal = if (compact) 8.dp else 11.dp, vertical = 4.dp),
                style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
        return
    }
    val colors = when (orderStatusTone(order)) {
        StatusTone.BLUE -> StatusColors(Color(0xFFBFDBFE), Color(0xFF1E3A8A))
        StatusTone.GREEN -> StatusColors(Color(0xFFBBF7D0), Color(0xFF14532D))
        StatusTone.ORANGE -> StatusColors(Color(0xFFFED7AA), Color(0xFF7C2D12))
        StatusTone.RED -> StatusColors(Color(0xFFFECACA), Color(0xFF7F1D1D))
    }
    Surface(shape = RoundedCornerShape(999.dp), color = colors.background, contentColor = colors.foreground) {
        Text(
            displayOrderStatus(order.status).display(),
            modifier = Modifier.padding(horizontal = if (compact) 8.dp else 10.dp, vertical = 4.dp),
            color = colors.foreground,
            style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun compactDeliveryLine(order: Order): String {
    val status = order.deliveryStatusInfo()
    return listOf(
        order.deliveryValue("carrier").trim(),
        status.stage.trim(),
        status.current.trim(),
    ).filter(String::isNotBlank).distinct().joinToString(" · ")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OrdersScreen(vm: OrdersViewModel, onSettings: () -> Unit) {
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    val visibleOrders = remember(vm.orders, searchQuery) {
        vm.orders
            .filter(::isOrderVisibleInMainList)
            .filter { it.matchesOrderSearch(searchQuery) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (searchOpen) {
                        TextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            placeholder = { Text("Поиск") },
                        )
                    } else {
                        Column {
                            Text("Заказы", fontWeight = FontWeight.Bold)
                            Text(
                                if (vm.realtimeConnected) "Онлайн" else "Офлайн · сохранённые данные",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (vm.realtimeConnected)
                                    MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = {
                        if (searchOpen) {
                            searchQuery = ""
                            searchOpen = false
                        } else searchOpen = true
                    }) {
                        Icon(
                            if (searchOpen) Icons.Filled.Close else Icons.Filled.Search,
                            contentDescription = if (searchOpen) "Закрыть поиск" else "Поиск",
                        )
                    }
                    TextButton(onSettings) { Text("Настройки") }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = vm.loading,
            onRefresh = { vm.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(top = 10.dp, bottom = 24.dp),
            ) {
                if (visibleOrders.isEmpty()) {
                    item {
                        Text(
                            when {
                                searchQuery.isNotBlank() -> "Ничего не найдено."
                                vm.orders.isEmpty() && (vm.loading || !vm.initialLoadComplete) -> "Загрузка…"
                                vm.orders.isEmpty() -> "Сохранённых заказов пока нет."
                                else -> "Активных заказов нет."
                            },
                            Modifier.padding(24.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(visibleOrders, key = { it.id }) { order ->
                    OrderCard(order) { vm.open(order.id) }
                }
            }
        }
    }
}

@Composable
private fun OrderCard(order: Order, onClick: () -> Unit) {
    val newOrder = isNewOrderVisual(order)
    val recipient = order.recipientName()
    val recipientPhone = order.recipientPhone()
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = if (newOrder) 2.dp else 1.dp),
        border = if (newOrder) BorderStroke(1.dp, Color(0xFFD946EF)) else null,
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    PlatformLogo(order.platform)
                    Spacer(Modifier.width(8.dp))
                    StatusLabel(order, compact = true)
                }
                Text(money(order.total()), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }

            Text(
                recipient,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (recipientPhone != "—") {
                Text(
                    recipientPhone,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            Text(
                order.items.sortedBy { it.position }.joinToString("\n") {
                    "${it.productName.display()} · ${it.size.display()} × ${amount(it.quantity)}"
                }.ifBlank { "—" },
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )

            val deliveryLine = compactDeliveryLine(order)
            if (deliveryLine.isNotBlank()) {
                Text(
                    deliveryLine,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    "${order.orderDate.display()} · ${order.orderTime.display()}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "№${order.number()}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun DetailField(label: String, value: String) {
    Column(Modifier.padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer {
            Text(value, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun DetailsHeader(order: Order) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            PlatformLogo(order.platform)
            Spacer(Modifier.width(10.dp))
            StatusLabel(order, compact = true)
        }
        Text(
            "№${order.number()} · ${order.orderDate.display()} · ${order.orderTime.display()}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Details(vm: OrdersViewModel, onAccept: (Order) -> Unit) {
    val order = vm.detail
    val context = LocalContext.current
    var extraExpanded by rememberSaveable(order?.id) { mutableStateOf(false) }
    var historyExpanded by rememberSaveable(order?.id) { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Заказ", fontWeight = FontWeight.SemiBold) },
                navigationIcon = { TextButton({ vm.closeDetail() }) { Text("Назад") } },
                actions = {
                    order?.let {
                        Text(
                            money(it.total()),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(end = 12.dp),
                        )
                    }
                },
            )
        },
        bottomBar = {
            if (order != null && canAccept(order, vm.email)) {
                Surface(shadowElevation = 8.dp) {
                    Button(
                        onClick = { onAccept(order) },
                        modifier = Modifier.fillMaxWidth().padding(12.dp).height(50.dp),
                        enabled = vm.acceptingId == null,
                    ) {
                        Text(
                            if (vm.acceptingId == order.id) "Принятие…" else "Принять заказ",
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (order == null) {
            Text("Заказ недоступен или удалён.", Modifier.padding(padding).padding(24.dp))
            return@Scaffold
        }

        val recipient = order.recipientName()
        val recipientPhone = order.recipientPhone()
        val rawPhone = recipientPhone.takeUnless { it == "—" }.orEmpty()
        val originalCustomer = order.customer.display()
        val originalPhone = order.phone.display()
        val shipments = order.shipments()

        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item { DetailsHeader(order) }

            item {
                SectionCard("Получатель") {
                    Text(
                        recipient,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (recipientPhone != "—") {
                        SelectionContainer {
                            Text(
                                recipientPhone,
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                    if (normalizeCustomerPhone(rawPhone) != null) {
                        FilledTonalButton(
                            onClick = { openDialer(context, rawPhone) },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) {
                            Text("Позвонить $recipientPhone", fontWeight = FontWeight.SemiBold)
                        }
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Button(
                                onClick = { openViber(context, rawPhone) },
                                modifier = Modifier.weight(1f).height(46.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF7360F2),
                                    contentColor = Color.White,
                                ),
                            ) { Text("Viber", fontWeight = FontWeight.SemiBold) }
                            Button(
                                onClick = { openTelegram(context, rawPhone) },
                                modifier = Modifier.weight(1f).height(46.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF229ED9),
                                    contentColor = Color.White,
                                ),
                            ) { Text("Telegram", fontWeight = FontWeight.SemiBold) }
                        }
                    }
                }
            }

            item {
                Text("Товары", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            items(order.items.sortedBy { it.position }) { product ->
                Card(
                    Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(
                            product.productName.display(),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Размер ${product.size.display()}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                "${amount(product.quantity)} × ${product.price?.let { money(BigDecimal.valueOf(it)) } ?: "—"}",
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                }
            }

            item {
                SectionCard("Доставка") {
                    val carrier = order.deliveryField("carrier")
                    val city = order.deliveryField("city")
                    val address = order.deliveryField("address")
                    val ttn = order.deliveryField("ttn")
                    val deliveryStatus = order.deliveryStatusInfo()
                    DetailField("Перевозчик", carrier)
                    val destination = listOf(city, address).filter { it != "—" }.joinToString(" · ")
                    if (destination.isNotBlank()) DetailField("Куда", destination)
                    if (ttn != "—") DetailField("ТТН", ttn)
                    if (deliveryStatus.stage.isNotBlank()) DetailField("Статус", deliveryStatus.stage)
                    if (deliveryStatus.current.isNotBlank()) DetailField("Сейчас", deliveryStatus.current)
                }
            }

            item {
                SectionCard("Оплата") {
                    DetailField("Способ", order.deliveryField("paymentMethod"))
                    DetailField("Статус", order.deliveryField("paymentStatus"))
                    DetailField("Сумма", order.deliveryField("paymentAmount"))
                }
            }

            item {
                OutlinedButton(
                    onClick = { extraExpanded = !extraExpanded },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (extraExpanded) "Скрыть дополнительную информацию" else "Дополнительная информация")
                }
            }
            if (extraExpanded) {
                item {
                    SectionCard("Дополнительно") {
                        if (originalCustomer != recipient || originalPhone != recipientPhone) {
                            DetailField(
                                "Клиент",
                                listOf(originalCustomer, originalPhone)
                                    .filter { it != "—" }
                                    .joinToString(" · ")
                                    .ifBlank { "—" },
                            )
                        }
                        DetailField("Плательщик доставки", order.deliveryField("payer"))
                        DetailField("Расход продавца", order.shipping?.let { money(BigDecimal.valueOf(it)) } ?: "—")
                    }
                }
            }

            if (shipments.size > 1) {
                item {
                    OutlinedButton(
                        onClick = { historyExpanded = !historyExpanded },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("История отправлений · ${shipments.size}")
                    }
                }
                if (historyExpanded) {
                    items(shipments) { shipment ->
                        Card(
                            Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                DetailField("ТТН", shipment.field("ttn"))
                                DetailField("Перевозчик", shipment.field("carrier"))
                                val destination = listOf(shipment.field("city"), shipment.field("address"))
                                    .filter { it != "—" }
                                    .joinToString(" · ")
                                if (destination.isNotBlank()) DetailField("Куда", destination)
                            }
                        }
                    }
                }
            }

            if (!canAccept(order, vm.email)) {
                acceptUnavailableReason(order, vm.email)?.let { reason ->
                    item {
                        Text(
                            reason,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
        }
    }
}
'''
main.write_text(text[:pos] + tail, encoding="utf-8")

Path("android/app/src/main/res/drawable/ic_orders.xml").write_text(r'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#050505" android:pathData="M0,0h108v108h-108z" />
    <path
        android:fillColor="@android:color/transparent"
        android:strokeColor="#221B34"
        android:strokeWidth="13"
        android:pathData="M54,12 A42,42 0,1 1 53.9,12" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#5DD9FF" android:strokeWidth="7" android:strokeLineCap="round" android:pathData="M22,30 A42,42 0,0 1 54,12" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#7257FF" android:strokeWidth="7" android:strokeLineCap="round" android:pathData="M54,12 A42,42 0,0 1 88,31" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#D645FF" android:strokeWidth="7" android:strokeLineCap="round" android:pathData="M88,31 A42,42 0,0 1 94,62" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#FF4D62" android:strokeWidth="7" android:strokeLineCap="round" android:pathData="M94,62 A42,42 0,0 1 72,92" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#FF8A35" android:strokeWidth="7" android:strokeLineCap="round" android:pathData="M72,92 A42,42 0,0 1 28,86" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#A548FF" android:strokeWidth="7" android:strokeLineCap="round" android:pathData="M28,86 A42,42 0,0 1 22,30" />
    <path
        android:fillColor="#FF4D55"
        android:pathData="M54,28 C65,40 73,48 73,61 C73,75 64,84 54,89 C44,84 35,75 35,61 C35,51 41,43 49,35 C49,44 54,49 59,53 C61,45 59,36 54,28 Z" />
    <path
        android:fillColor="#FF8A35"
        android:pathData="M54,49 C60,55 66,60 66,67 C66,75 60,80 54,84 C48,80 42,75 42,67 C42,61 46,56 51,51 C51,57 54,61 57,63 C59,58 58,53 54,49 Z" />
    <path
        android:fillColor="#7C38FF"
        android:pathData="M54,38 C59,44 62,48 62,53 C62,59 58,63 54,66 C50,63 46,59 46,53 C46,49 49,45 52,41 C52,46 54,49 57,51 C58,46 57,42 54,38 Z" />
</vector>
''', encoding="utf-8")

replace_once(
    "android/app/src/main/AndroidManifest.xml",
    'android:icon="@drawable/ic_orders" android:label="Заказы"',
    'android:icon="@drawable/ic_orders" android:roundIcon="@drawable/ic_orders" android:label="Заказы"',
)

tests = Path("android/app/src/test/java/ua/orders/crm/OrderSyncTest.kt")
text = tests.read_text(encoding="utf-8")
insert = r'''
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
        assertEquals("0675551122", deliveryRecipient.recipientPhone())
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
'''
end = '\n}\n'
if not text.endswith(end):
    raise SystemExit("OrderSyncTest closing brace not found")
tests.write_text(text[:-len(end)] + "\n" + insert + end, encoding="utf-8")
