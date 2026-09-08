package ua.orders.crm

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AppearanceHost { OrdersApp() } }
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

private fun openDialer(context: Context, phone: String) {
    val value = phone.trim()
    if (value.isBlank()) return
    context.startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", value, null)))
}

@Composable
fun OrdersApp(vm: OrdersViewModel = viewModel()) {
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.foreground(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { vm.foreground(false) }
    var settings by rememberSaveable { mutableStateOf(false) }
    var confirmationId by remember { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm.message) {
        vm.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }
    LaunchedEffect(vm.email) { if (vm.email == null) { settings = false; confirmationId = null } }
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
    ) { granted -> notificationPermissionGranted = granted }

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
            verticalArrangement = Arrangement.spacedBy(12.dp),
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
                                if (
                                    enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                    !context.canPostOrderNotifications()
                                ) permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
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
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

private data class StatusColors(val background: Color, val foreground: Color)

@Composable
private fun StatusLabel(order: Order) {
    if (isNewOrderVisual(order)) {
        Surface(
            shape = RoundedCornerShape(999.dp),
            color = Color(0xFFF5D0FE),
            contentColor = Color(0xFF86198F),
            border = BorderStroke(1.dp, Color(0xFFE879F9)),
        ) {
            Text(
                "НОВЫЙ ЗАКАЗ",
                modifier = Modifier.padding(horizontal = 11.dp, vertical = 5.dp),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
            )
        }
        return
    }
    val colors = when (orderStatusTone(order)) {
        StatusTone.BLUE -> StatusColors(Color(0xFFDBEAFE), Color(0xFF1E40AF))
        StatusTone.GREEN -> StatusColors(Color(0xFFDCFCE7), Color(0xFF166534))
        StatusTone.ORANGE -> StatusColors(Color(0xFFFFEDD5), Color(0xFF9A3412))
        StatusTone.RED -> StatusColors(Color(0xFFFEE2E2), Color(0xFF991B1B))
    }
    Surface(shape = RoundedCornerShape(999.dp), color = colors.background, contentColor = colors.foreground) {
        Text(
            displayOrderStatus(order.status).display(),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            color = colors.foreground,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun DeliveryStatus(order: Order, compact: Boolean = false) {
    val status = order.deliveryStatusInfo()
    if (status.stage.isBlank()) return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            status.stage,
            style = if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = if (compact) FontWeight.Normal else FontWeight.Medium,
        )
        if (status.current.isNotBlank()) {
            Text(status.current, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OrdersScreen(vm: OrdersViewModel, onSettings: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Заказы", fontWeight = FontWeight.Bold)
                        Text(
                            if (vm.realtimeConnected) "Онлайн" else "Подключение…",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (vm.realtimeConnected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    TextButton({ vm.refresh() }, enabled = !vm.loading) { Text("Обновить") }
                    TextButton(onSettings) { Text("Настройки") }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp)) {
            if (!vm.realtimeConnected) Text(
                "Автообновление подключается. Доступно ручное обновление.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
            )
            PullToRefreshBox(
                isRefreshing = vm.loading,
                onRefresh = { vm.refresh() },
                modifier = Modifier.weight(1f),
            ) {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(top = 8.dp, bottom = 20.dp),
                ) {
                    if (vm.orders.isEmpty()) item {
                        Text(
                            if (vm.loading) "Загрузка…" else "Заказов пока нет.",
                            Modifier.padding(24.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(vm.orders, key = { it.id }) { order -> OrderCard(order) { vm.open(order.id) } }
                }
            }
        }
    }
}

@Composable
private fun OrderCard(order: Order, onClick: () -> Unit) {
    val newOrder = isNewOrderVisual(order)
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = if (newOrder) 3.dp else 1.dp),
        border = BorderStroke(
            if (newOrder) 2.dp else 1.dp,
            if (newOrder) Color(0xFFE879F9) else MaterialTheme.colorScheme.outlineVariant,
        ),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(order.platform.display(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text("№${order.number()}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                Text(money(order.total()), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                StatusLabel(order)
                Text(
                    "${order.orderDate.display()} · ${order.orderTime.display()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DeliveryStatus(order, compact = true)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Text(
                order.items.sortedBy { it.position }.joinToString("\n") {
                    "${it.productName.display()} · ${it.size.display()} × ${amount(it.quantity)}"
                }.ifBlank { "—" },
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
            val customerLine = listOf(order.customer.display(), order.phone.display()).filter { it != "—" }.joinToString(" · ")
            if (customerLine.isNotBlank()) Text(customerLine, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DetailField(label: String, value: String) {
    Column(Modifier.padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer { Text(value, style = MaterialTheme.typography.bodyLarge) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Details(vm: OrdersViewModel, onAccept: (Order) -> Unit) {
    val order = vm.detail
    val context = LocalContext.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(order?.let { "Заказ №${it.number()}" } ?: "Заказ", fontWeight = FontWeight.SemiBold) },
                navigationIcon = { TextButton({ vm.closeDetail() }) { Text("Назад") } },
                actions = { TextButton({ vm.refresh() }, enabled = !vm.loading) { Text("Обновить") } },
            )
        },
        bottomBar = {
            if (order != null && canAccept(order, vm.email)) {
                Surface(shadowElevation = 8.dp) {
                    Button(
                        onClick = { onAccept(order) },
                        modifier = Modifier.fillMaxWidth().padding(12.dp).height(50.dp),
                        enabled = vm.acceptingId == null,
                    ) { Text(if (vm.acceptingId == order.id) "Принятие…" else "Принять заказ", fontWeight = FontWeight.SemiBold) }
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (order == null) {
            Text("Заказ недоступен или удалён.", Modifier.padding(padding).padding(24.dp))
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item {
                Card(
                    Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = if (isNewOrderVisual(order)) BorderStroke(2.dp, Color(0xFFE879F9)) else null,
                ) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column {
                                Text(order.platform.display(), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                                Text("№${order.number()}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                            }
                            Text(money(order.total()), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        }
                        StatusLabel(order)
                        Text("${order.orderDate.display()} · ${order.orderTime.display()}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        DeliveryStatus(order)
                    }
                }
            }
            item { Text("Товары", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(order.items.sortedBy { it.position }) { product ->
                Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(product.productName.display(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        DetailField("Размер", product.size.display())
                        Text("${amount(product.quantity)} × ${product.price?.let { money(BigDecimal.valueOf(it)) } ?: "—"}")
                    }
                }
            }
            item {
                SectionCard("Клиент") {
                    DetailField("Имя", order.customer.display())
                    DetailField("Телефон", order.phone.display())
                    if (!order.phone.isNullOrBlank()) {
                        FilledTonalButton(
                            onClick = { openDialer(context, order.phone) },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) { Text("Позвонить ${order.phone}", fontWeight = FontWeight.SemiBold) }
                    }
                }
            }
            item {
                SectionCard("Доставка") {
                    for ((key, label) in listOf(
                        "carrier" to "Перевозчик", "recipient" to "Получатель",
                        "recipientPhone" to "Телефон получателя", "city" to "Город", "address" to "Адрес",
                        "ttn" to "ТТН", "payer" to "Плательщик",
                    )) DetailField(label, order.deliveryField(key))
                    val deliveryStatus = order.deliveryStatusInfo()
                    DetailField("Статус", deliveryStatus.stage.display())
                    if (deliveryStatus.current.isNotBlank()) DetailField("Текущий статус", deliveryStatus.current)
                    DetailField("Расход продавца", order.shipping?.let { money(BigDecimal.valueOf(it)) } ?: "—")
                }
            }
            item {
                SectionCard("Оплата") {
                    DetailField("Способ", order.deliveryField("paymentMethod"))
                    DetailField("Статус", order.deliveryField("paymentStatus"))
                    DetailField("Сумма", order.deliveryField("paymentAmount"))
                }
            }
            if (order.shipments().isNotEmpty()) item { Text("История отправлений", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            items(order.shipments()) { shipment ->
                Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        DetailField("ТТН", shipment.field("ttn"))
                        DetailField("Перевозчик", shipment.field("carrier"))
                        DetailField("Город / адрес", "${shipment.field("city")} · ${shipment.field("address")}")
                        DetailField("Первое / последнее изменение", "${shipment.field("firstSeenAt")} · ${shipment.field("lastSeenAt")}")
                    }
                }
            }
            if (!canAccept(order, vm.email)) {
                acceptUnavailableReason(order, vm.email)?.let { reason ->
                    item { Text(reason, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
    }
}