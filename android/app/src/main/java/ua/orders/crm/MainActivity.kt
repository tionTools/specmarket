package ua.orders.crm

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import java.math.BigDecimal
import java.math.RoundingMode
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var requestedOrderId by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrderId = intent.getStringExtra(EXTRA_OPEN_ORDER_ID)
        setContent {
            AppearanceHost {
                OrdersApp(
                    openOrderId = requestedOrderId,
                    onOrderOpened = ::clearRequestedOrder,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        requestedOrderId = intent.getStringExtra(EXTRA_OPEN_ORDER_ID)
    }

    private fun clearRequestedOrder() {
        requestedOrderId = null
        intent.removeExtra(EXTRA_OPEN_ORDER_ID)
    }
}

@Composable
private fun AppearanceHost(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val appearance by context.appearance().collectAsState(initial = Appearance.SYSTEM)
    MaterialTheme(ordersColors(appearance.isDark(isSystemInDarkTheme()))) { content() }
}

private fun money(value: BigDecimal) = value.setScale(2, RoundingMode.HALF_UP).toPlainString() + " грн"
private fun amount(value: Double?) = value?.let { BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() } ?: "—"

@Composable
private fun PlatformLogo(platform: String?) {
    val value = platform.orEmpty().trim()
    val key = normalizedStatus(value)
    val resource = when (key) {
        "пром" -> R.drawable.platform_prom
        "эпицентр", "епіцентр" -> R.drawable.platform_epicentr
        "каста", "kasta" -> R.drawable.platform_kasta
        else -> null
    }
    if (resource == null) {
        Text(
            value.display(),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        return
    }
    val epicentr = key == "эпицентр" || key == "епіцентр"
    Image(
        painter = painterResource(resource),
        contentDescription = value,
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .height(if (epicentr) 22.dp else 18.dp)
            .widthIn(max = if (epicentr) 96.dp else 82.dp),
    )
}

private fun openDialer(context: Context, phone: String) {
    val value = normalizeCustomerPhone(phone)
    if (value == null) {
        Toast.makeText(context, "Некорректный номер телефона.", Toast.LENGTH_SHORT).show()
        return
    }
    context.startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", value, null)))
}

private fun launchExternal(context: Context, uri: Uri): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
    true
} catch (_: Exception) {
    false
}

private fun openViber(context: Context, phone: String) {
    val value = normalizeCustomerPhone(phone) ?: return
    val uri = Uri.Builder()
        .scheme("viber")
        .authority("chat")
        .appendQueryParameter("number", value)
        .build()
    if (!launchExternal(context, uri)) {
        Toast.makeText(context, "Viber не установлен или не открыл чат.", Toast.LENGTH_SHORT).show()
    }
}

private fun openTelegram(context: Context, phone: String) {
    val value = normalizeCustomerPhone(phone) ?: return
    val uri = Uri.Builder()
        .scheme("tg")
        .authority("resolve")
        .appendQueryParameter("phone", value)
        .build()
    if (!launchExternal(context, uri) && !launchExternal(context, Uri.parse("https://t.me/$value"))) {
        Toast.makeText(context, "Telegram не установлен или номер недоступен.", Toast.LENGTH_SHORT).show()
    }
}

@Composable
fun OrdersApp(
    vm: OrdersViewModel = viewModel(),
    openOrderId: String? = null,
    onOrderOpened: () -> Unit = {},
) {
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.foreground(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { vm.foreground(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    DisposableEffect(vm, context) {
        val monitor = NetworkRecoveryMonitor(context) {
            scope.launch { vm.networkRestored() }
        }
        onDispose { monitor.close() }
    }
    NotificationPermissionGate(vm)
    var settings by rememberSaveable { mutableStateOf(false) }
    var confirmationId by remember { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) {
        vm.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }
    LaunchedEffect(vm.email) { if (vm.email == null) { settings = false; confirmationId = null } }
    LaunchedEffect(openOrderId, vm.email, vm.initializing) {
        if (openOrderId != null && vm.email != null && !vm.initializing) {
            settings = false
            confirmationId = null
            vm.open(openOrderId)
            onOrderOpened()
        }
    }
    BackHandler(settings || vm.selectedId != null) {
        if (settings) settings = false else vm.closeDetail()
    }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                vm.initializing -> Initializing()
                vm.email == null -> Login(vm)
                settings -> Settings(vm, onBack = { settings = false })
                vm.selectedId != null -> Details(vm, onAccept = { confirmationId = it.id })
                else -> OrdersScreen(vm, onSettings = { settings = true })
            }
        }
    }
    val confirmationOrder = vm.detail?.takeIf { it.id == confirmationId }
        ?: vm.orders.find { it.id == confirmationId }
    if (confirmationOrder != null && canAccept(confirmationOrder, vm.email)) {
        AlertDialog(
            onDismissRequest = { confirmationId = null },
            title = { Text("Принять заказ №${confirmationOrder.number()}?") },
            text = { Text("Статус изменится на площадке ${confirmationOrder.platform.display()} и затем в CRM.") },
            confirmButton = {
                Button(onClick = {
                    confirmationId = null
                    vm.accept(confirmationOrder)
                }, enabled = vm.acceptingId == null) { Text("Принять") }
            },
            dismissButton = { TextButton({ confirmationId = null }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun Initializing() {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text("Восстановление сессии…", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Login(vm: OrdersViewModel) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
        Card(
            modifier = Modifier.fillMaxWidth().widthIn(max = 520.dp),
            shape = RoundedCornerShape(28.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        ) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    shape = RoundedCornerShape(999.dp),
                ) {
                    Text("ЗАКАЗЫ", Modifier.padding(horizontal = 12.dp, vertical = 6.dp), style = MaterialTheme.typography.labelLarge)
                }
                Text("Вход", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text("Один аккаунт CRM на всех устройствах", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Пароль") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                Button(
                    onClick = { vm.login(email, password); password = "" },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    enabled = !vm.authBusy && email.isNotBlank() && password.isNotEmpty(),
                ) { Text(if (vm.authBusy) "Вход…" else "Войти", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

@Composable
private fun NotificationPermissionGate(vm: OrdersViewModel) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val context = LocalContext.current
    val notificationsEnabled by context.newOrderNotifications().collectAsState(initial = true)
    val permissionAsked by context.notificationPermissionAsked().collectAsState(initial = false)
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { vm.notificationsPermissionChanged() }

    LaunchedEffect(vm.email, notificationsEnabled, permissionAsked) {
        if (
            vm.email != null && notificationsEnabled && !permissionAsked &&
            !context.canPostOrderNotifications()
        ) {
            context.saveNotificationPermissionAsked(true)
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Settings(vm: OrdersViewModel, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val appearance by context.appearance().collectAsState(initial = Appearance.SYSTEM)
    val notificationsEnabled by context.newOrderNotifications().collectAsState(initial = true)
    var notificationPermissionGranted by remember { mutableStateOf(context.canPostOrderNotifications()) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        notificationPermissionGranted = granted
        vm.notificationsPermissionChanged()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Настройки", fontWeight = FontWeight.SemiBold) },
                navigationIcon = { TextButton(onBack) { Text("Назад") } },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item {
                SectionCard("Аккаунт") {
                    SelectionContainer { Text(vm.email.display(), style = MaterialTheme.typography.bodyLarge) }
                }
            }
            item {
                SectionCard("Оформление") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Appearance.entries.forEach { mode ->
                            FilterChip(
                                selected = appearance == mode,
                                onClick = { scope.launch { context.saveAppearance(mode) } },
                                label = { Text(mode.label) },
                            )
                        }
                    }
                }
            }
            item {
                SectionCard("Уведомления") {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Новые заказы", style = MaterialTheme.typography.titleMedium)
                            Text(
                                if (notificationsEnabled && !notificationPermissionGranted)
                                    "Разрешение уведомлений отключено в Android."
                                else "Prom, Эпицентр и Kasta.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = notificationsEnabled,
                            onCheckedChange = { enabled ->
                                scope.launch { context.saveNewOrderNotifications(enabled) }
                                vm.notificationsSettingChanged(enabled)
                                if (
                                    enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                    !context.canPostOrderNotifications()
                                ) {
                                    scope.launch { context.saveNotificationPermissionAsked(true) }
                                    permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                }
                            },
                        )
                    }
                    Text(
                        "Фоновое уведомление работает, пока Android не остановил процесс приложения. " +
                            "Для гарантированной доставки после полной остановки нужен серверный push.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            item {
                OutlinedButton(
                    onClick = { vm.logout() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !vm.authBusy && vm.acceptingId == null,
                ) { Text("Выйти из аккаунта") }
            }
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

private data class StatusColors(val background: Color, val foreground: Color)

@Composable
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
                                connectionStatusLabel(vm.realtimeConnected, vm.lastRefreshSucceeded),
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
                    IconButton(onClick = { vm.retryConnection() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Переподключиться и обновить")
                    }
                    TextButton(onSettings) { Text("Настройки") }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = vm.loading,
            onRefresh = { vm.retryConnection() },
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
    val buyerName = order.customer.display()
    val buyerPhone = order.buyerPhone()
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
                buyerName,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (buyerPhone != "—") {
                Text(
                    buyerPhone,
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
        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 7.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Text(
            listOf(order.orderDate.orEmpty(), order.orderTime.orEmpty())
                .filter(String::isNotBlank).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface) {
                Box(Modifier.padding(horizontal = 9.dp, vertical = 7.dp)) {
                    PlatformLogo(order.platform)
                }
            }
            StatusLabel(order, compact = true)
            val rawPayment = normalizedStatus(order.deliveryValue("paymentStatus"))
            if (rawPayment.isNotBlank()) {
                val paid = rawPayment in setOf("paid", "оплачено", "сплачено")
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = if (paid) Color(0xFFDCFCE7) else Color(0xFFFFEDD5),
                    contentColor = if (paid) Color(0xFF166534) else Color(0xFF9A3412),
                ) {
                    Text(
                        if (paid) "Оплачено" else when (rawPayment) {
                            "unpaid", "not_paid" -> "Не оплачено"
                            "pending", "waiting" -> "Ожидает оплаты"
                            else -> order.deliveryValue("paymentStatus")
                        },
                        Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Details(vm: OrdersViewModel, onAccept: (Order) -> Unit) {
    val order = vm.detail
    val context = LocalContext.current
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    var historyExpanded by rememberSaveable(order?.id) { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("№ " + (order?.number() ?: "—"), fontWeight = FontWeight.Bold) },
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
        val buyerName = order.customer.display()
        val buyerPhone = order.buyerPhone()
        val rawBuyerPhone = order.phone.orEmpty().trim()
        val shipments = order.shipments()
        val paymentStatus = order.deliveryValue("paymentStatus").trim()
        val paymentLabel = when (normalizedStatus(paymentStatus)) {
            "paid", "оплачено", "сплачено" -> "Оплачено"
            "unpaid", "not_paid" -> "Не оплачено"
            "pending", "waiting" -> "Ожидает оплаты"
            else -> paymentStatus
        }

        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item { DetailsHeader(order) }

            item {
                SectionCard("Покупатель") {
                    Text(
                        buyerName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (buyerPhone != "—") {
                        SelectionContainer {
                            Text(
                                buyerPhone,
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                    if (normalizeCustomerPhone(rawBuyerPhone) != null) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            FilledTonalButton(
                                onClick = {
                                    haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.TextHandleMove)
                                    openDialer(context, rawBuyerPhone)
                                },
                                modifier = Modifier.weight(1.12f).height(46.dp),
                                shape = RoundedCornerShape(12.dp),
                                contentPadding = PaddingValues(horizontal = 4.dp),
                                colors = ButtonDefaults.filledTonalButtonColors(
                                    containerColor = Color(0xFFEDE9FE), contentColor = Color(0xFF5B21B6),
                                ),
                            ) { Text("Позвонить", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
                            Button(
                                onClick = {
                                    haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.TextHandleMove)
                                    openViber(context, rawBuyerPhone)
                                },
                                modifier = Modifier.weight(1f).height(46.dp),
                                shape = RoundedCornerShape(12.dp),
                                contentPadding = PaddingValues(horizontal = 4.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF7360F2), contentColor = Color.White,
                                ),
                            ) { Text("Viber", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
                            Button(
                                onClick = {
                                    haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.TextHandleMove)
                                    openTelegram(context, rawBuyerPhone)
                                },
                                modifier = Modifier.weight(1.12f).height(46.dp),
                                shape = RoundedCornerShape(12.dp),
                                contentPadding = PaddingValues(horizontal = 4.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF229ED9), contentColor = Color.White,
                                ),
                            ) { Text("Telegram", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
                        }
                    }
                }
            }

            if (recipient != buyerName || (recipientPhone != "—" && recipientPhone != buyerPhone)) {
                item {
                    SectionCard("Получатель") {
                        Text(recipient, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        if (recipientPhone != "—") DetailField("Телефон", recipientPhone)
                    }
                }
            }

            items(order.items.sortedBy { it.position }) { product ->
                Card(
                    Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        ProductThumbnail(product.imageUrl)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(product.productName.display(), style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold, maxLines = 4, overflow = TextOverflow.Ellipsis)
                            if (!product.size.isNullOrBlank()) {
                                Text("Размер: " + product.size, style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(amount(product.quantity) + " × " +
                                    (product.price?.let { money(BigDecimal.valueOf(it)) } ?: "—"),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(
                                    if (product.quantity != null && product.price != null)
                                        money(BigDecimal.valueOf(product.quantity) * BigDecimal.valueOf(product.price))
                                    else "—",
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }

            item {
                SectionCard("Доставка") {
                    val carrier = order.deliveryValue("carrier").trim()
                    val city = order.deliveryValue("city").trim()
                    val address = order.deliveryValue("address").trim()
                    val ttn = order.deliveryValue("ttn").trim()
                    val deliveryStatus = order.deliveryStatusInfo()
                    if (carrier.isNotBlank()) Text(carrier, fontWeight = FontWeight.Bold)
                    val destination = when {
                        address.isBlank() -> city
                        city.isBlank() || address.contains(city, ignoreCase = true) -> address
                        else -> city + " · " + address
                    }
                    if (destination.isNotBlank()) Text(destination, style = MaterialTheme.typography.bodyMedium)
                    if (ttn.isNotBlank()) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { DetailField("ТТН", ttn) }
                            TextButton(onClick = {
                                clipboard.setText(androidx.compose.ui.text.AnnotatedString(ttn))
                                Toast.makeText(context, "ТТН скопирована", Toast.LENGTH_SHORT).show()
                            }) { Text("Копировать") }
                        }
                    }
                    if (deliveryStatus.stage.isNotBlank()) {
                        Text(deliveryStatus.stage, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary)
                    }
                    if (deliveryStatus.current.isNotBlank() && deliveryStatus.current != deliveryStatus.stage) {
                        Text(deliveryStatus.current, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            if (order.deliveryValue("paymentMethod").isNotBlank() || paymentStatus.isNotBlank() ||
                order.deliveryValue("paymentAmount").isNotBlank()) {
                item {
                    SectionCard("Оплата") {
                        val method = order.deliveryValue("paymentMethod").trim()
                        val paidAmount = order.deliveryValue("paymentAmount").trim()
                        if (method.isNotBlank()) DetailField("Способ", method)
                        if (paymentLabel.isNotBlank()) DetailField("Статус", paymentLabel)
                        if (paidAmount.isNotBlank()) DetailField("Сумма", paidAmount)
                    }
                }
            }

            item {
                Card(
                    Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Товары", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(money(order.total()))
                        }
                        if (order.shipping != null) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                                Text(
                                    "Расход продавца на доставку",
                                    modifier = Modifier.weight(1f),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(Modifier.width(12.dp))
                                Text(
                                    money(BigDecimal.valueOf(order.shipping)),
                                    softWrap = false,
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Стоимость товаров", fontWeight = FontWeight.Bold)
                            Text(money(order.total()), style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold)
                        }
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
