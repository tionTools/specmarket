package ua.orders.crm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import java.math.BigDecimal
import java.math.RoundingMode

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { OrdersApp() } }
    }
}

private fun money(value: BigDecimal) = value.setScale(2, RoundingMode.HALF_UP).toPlainString() + " грн"
private fun amount(value: Double?) = value?.let { BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() } ?: "—"

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
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when {
                vm.initializing -> {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("Восстановление сессии…", Modifier.padding(24.dp))
                }
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
            text = { Text("Статус заказа изменится в Prom и общей CRM.") },
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
private fun Login(vm: OrdersViewModel) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    LazyColumn(
        Modifier.fillMaxSize().imePadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { Text("Заказы", style = MaterialTheme.typography.headlineLarge) }
        item { Text("Войдите в свой аккаунт CRM") }
        item {
            OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(),
                label = { Text("Email") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        }
        item {
            OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(),
                label = { Text("Пароль") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        }
        item {
            Button(onClick = { vm.login(email, password); password = "" },
                modifier = Modifier.fillMaxWidth(),
                enabled = !vm.authBusy && email.isNotBlank() && password.isNotEmpty()) {
                Text(if (vm.authBusy) "Вход…" else "Войти")
            }
        }
    }
}

@Composable
private fun Settings(vm: OrdersViewModel, onBack: () -> Unit) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TextButton(onBack) { Text("Назад") }
        Text("Настройки", style = MaterialTheme.typography.headlineMedium)
        Text("Аккаунт")
        SelectionContainer { Text(vm.email.display()) }
        Button({ vm.logout() }, enabled = !vm.authBusy && vm.acceptingId == null) { Text("Выйти") }
    }
}

@Composable
private fun StatusLabel(status: String?) {
    val color = when (statusTone(status)) {
        StatusTone.NEW -> Color(0xFF1565C0)
        StatusTone.NEGATIVE -> Color(0xFFB3261E)
        StatusTone.COMPLETE -> Color(0xFF1B6B36)
        StatusTone.ACTIVE -> Color(0xFF965000)
    }
    Text(status.display(), color = color, style = MaterialTheme.typography.labelLarge)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OrdersScreen(vm: OrdersViewModel, onSettings: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Заказы", style = MaterialTheme.typography.headlineMedium)
            TextButton(onSettings) { Text("Настройки") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(vm.showNew, { vm.showNew = true }, { Text("Новые") })
            FilterChip(!vm.showNew, { vm.showNew = false }, { Text("Все") })
            TextButton({ vm.refresh() }, enabled = !vm.loading) { Text("Обновить") }
        }
        if (!vm.realtimeConnected) Text("Автообновление подключается. Доступно ручное обновление.",
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
        PullToRefreshBox(isRefreshing = vm.loading, onRefresh = { vm.refresh() }, modifier = Modifier.weight(1f)) {
            val shown = vm.orders.filter { !vm.showNew || isNewStatus(it.status) }
            LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (shown.isEmpty()) item {
                    Text(if (vm.loading) "Загрузка…" else if (vm.showNew) "В загруженной истории новых заказов нет." else "Заказов пока нет.",
                        Modifier.padding(vertical = 24.dp))
                }
                items(shown, key = { it.id }) { order ->
                    Card(onClick = { vm.open(order.id) }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("${order.platform.display()} · №${order.number()}", style = MaterialTheme.typography.titleMedium)
                            Text("${order.orderDate.display()} ${order.orderTime.display()}")
                            StatusLabel(order.status)
                            Text(money(order.total()), style = MaterialTheme.typography.titleMedium)
                            Text(order.items.sortedBy { it.position }.joinToString("\n") {
                                "${it.productName.display()} · ${it.size.display()} × ${amount(it.quantity)}"
                            }.ifBlank { "—" })
                        }
                    }
                }
                item {
                    if (vm.hasMore) OutlinedButton({ vm.more() },
                        Modifier.fillMaxWidth().padding(vertical = 8.dp), enabled = !vm.loading) { Text("Загрузить ещё") }
                    else Text("Вся история загружена", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun DetailField(label: String, value: String) {
    Column(Modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer { Text(value) }
    }
}

@Composable
private fun Details(vm: OrdersViewModel, onAccept: (Order) -> Unit) {
    val order = vm.detail
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton({ vm.closeDetail() }) { Text("Назад") }
            TextButton({ vm.refresh() }, enabled = !vm.loading) { Text("Обновить") }
        }
        if (order == null) {
            Text("Заказ недоступен или удалён.", Modifier.padding(16.dp))
            return
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Text("${order.platform.display()} · №${order.number()}", style = MaterialTheme.typography.headlineSmall)
                Text("${order.orderDate.display()} ${order.orderTime.display()}")
                StatusLabel(order.status)
                Text(money(order.total()), style = MaterialTheme.typography.titleLarge)
            }
            item { Text("Товары", style = MaterialTheme.typography.titleMedium) }
            items(order.items.sortedBy { it.position }) { product ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(product.productName.display(), style = MaterialTheme.typography.titleMedium)
                        DetailField("Размер", product.size.display())
                        Text("Количество: ${amount(product.quantity)} · Цена: ${product.price?.let { money(BigDecimal.valueOf(it)) } ?: "—"}")
                    }
                }
            }
            item {
                DetailField("Клиент", order.customer.display())
                DetailField("Телефон", order.phone.display())
                HorizontalDivider()
                Text("Доставка", style = MaterialTheme.typography.titleMedium)
                for ((key, label) in listOf("carrier" to "Перевозчик", "recipient" to "Получатель",
                    "recipientPhone" to "Телефон получателя", "city" to "Город", "address" to "Адрес",
                    "ttn" to "ТТН", "payer" to "Плательщик", "trackingStatus" to "Статус доставки")) {
                    DetailField(label, order.deliveryField(key))
                }
                DetailField("Расход продавца на доставку", order.shipping?.let { money(BigDecimal.valueOf(it)) } ?: "—")
                HorizontalDivider()
                DetailField("Способ оплаты", order.deliveryField("paymentMethod"))
                DetailField("Статус оплаты", order.deliveryField("paymentStatus"))
                DetailField("Сумма оплаты", order.deliveryField("paymentAmount"))
            }
            if (order.shipments().isNotEmpty()) item { Text("История отправлений", style = MaterialTheme.typography.titleMedium) }
            items(order.shipments()) { shipment ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        DetailField("ТТН", shipment.field("ttn"))
                        DetailField("Перевозчик", shipment.field("carrier"))
                        DetailField("Город / адрес", "${shipment.field("city")} · ${shipment.field("address")}")
                        DetailField("Первое / последнее изменение", "${shipment.field("firstSeenAt")} · ${shipment.field("lastSeenAt")}")
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
        if (canAccept(order, vm.email)) Button(
            onClick = { onAccept(order) },
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            enabled = vm.acceptingId == null,
        ) { Text(if (vm.acceptingId == order.id) "Принятие…" else "Принять") }
    }
}
