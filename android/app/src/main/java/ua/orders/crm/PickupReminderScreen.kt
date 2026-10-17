package ua.orders.crm

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.temporal.ChronoUnit

// Separate, on-demand page: the proven v0.29 orders UI and refresh
// remain untouched even if the optional reminder backend fails.
@Composable
fun PickupRemindersScreen(vm: OrdersViewModel, onBack: () -> Unit) {
    LaunchedEffect(vm.email) { if (vm.email != null) vm.loadPickupReminders() }
    PickupReminderContent(
        orders = vm.orders,
        reminders = vm.pickupReminders,
        loading = vm.pickupLoading,
        busy = vm.pickupBusy,
        error = vm.pickupError,
        onBack = onBack,
        onRefresh = vm::loadPickupReminders,
        onSaveDeadline = vm::savePickupDeadline,
        onConfirmSent = vm::confirmPickupSent,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PickupReminderContent(
    orders: List<Order>,
    reminders: Map<String, PickupReminderState>,
    loading: Boolean,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onSaveDeadline: (Order, String) -> Unit,
    onConfirmSent: (Order, PickupReminderStage, String) -> Unit,
) {
    val context = LocalContext.current
    val today = pickupToday()
    var edit by remember { mutableStateOf<Order?>(null) }
    var deadlineInput by remember { mutableStateOf("") }
    var sentConfirmation by remember { mutableStateOf<Triple<Order, PickupReminderStage, String>?>(null) }
    val applicable = remember(orders, reminders, today) {
        orders.filter(::isOrderVisibleInMainList).filter { order ->
            order.pendingPickupReminder(reminders[order.id], today) != null ||
                order.needsPickupDeadline(reminders[order.id])
        }
    }

    Scaffold(
        topBar = { TopAppBar(
            title = { Text("Напоминания") },
            navigationIcon = { TextButton(onBack) { Text("Назад") } },
            actions = { TextButton(onRefresh, enabled = !loading && !busy) { Text("Обновить") } },
        ) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) {
                Text(error, color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            }
            Text("Сроки из штатной синхронизации доставок. Сообщения отправляете вы.",
                modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (applicable.isEmpty()) {
                    item { Text(
                        if (loading) "Загружаем напоминания…"
                        else if (error != null) "Не удалось проверить напоминания."
                        else "Сейчас нет заказов, требующих напоминания.",
                        Modifier.padding(16.dp),
                    ) }
                }
                items(applicable, key = { it.id }) { order ->
                    val reminder = reminders[order.id]
                    val stage = order.pendingPickupReminder(reminder, today)
                    val days = reminder?.deadline?.let {
                        runCatching { ChronoUnit.DAYS.between(today, LocalDate.parse(it)) }.getOrNull()
                    }
                    Card(shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text("Заказ №${order.number()}", fontWeight = FontWeight.SemiBold)
                            Text(order.recipientName(), style = MaterialTheme.typography.bodyMedium)
                            Text("ТТН: ${order.deliveryValue("ttn")}", style = MaterialTheme.typography.bodySmall)
                            if (order.isNovaPickupPoint()) {
                                Text("Пункт выдачи НП", color = MaterialTheme.colorScheme.primary)
                            }
                            val caption = when (stage) {
                                PickupReminderStage.FIRST ->
                                    if (days == 1L) "Напомнить: остался 1 день" else "Напомнить: осталось 2 дня"
                                PickupReminderStage.LAST -> "Напомнить: сегодня последний день"
                                null -> "Уточнить крайний срок получения"
                            }
                            Text(caption, fontWeight = FontWeight.SemiBold)
                            if (reminder != null && reminder.ttn == order.deliveryValue("ttn").trim()) {
                                Text("Крайний срок: ${reminder.deadline}")
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = {
                                    edit = order
                                    deadlineInput = reminder?.takeIf {
                                        it.ttn == order.deliveryValue("ttn").trim()
                                    }?.deadline.orEmpty()
                                }, enabled = !busy) { Text("Изменить срок") }
                            }
                            if (stage != null && reminder != null) {
                                Text("Текст будет скопирован. Отправку подтвердите после сообщения.",
                                    style = MaterialTheme.typography.bodySmall)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    for (channel in listOf("telegram", "viber")) {
                                        Button(
                                            onClick = {
                                                val phone = order.recipientPhone()
                                                val draft = order.pickupReminderText(stage, reminder.deadline, today)
                                                val launched = openPickupDraft(context, phone, channel, draft)
                                                if (launched) {
                                                    sentConfirmation = Triple(order, stage, channel)
                                                } else {
                                                    Toast.makeText(context, "Текст скопирован, чат можно открыть вручную.",
                                                        Toast.LENGTH_LONG).show()
                                                    sentConfirmation = Triple(order, stage, channel)
                                                }
                                            },
                                            enabled = !busy && normalizeCustomerPhone(order.recipientPhone()) != null,
                                        ) { Text(if (channel == "telegram") "Telegram" else "Viber") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (edit != null) {
        val order = edit!!
        val valid = runCatching { LocalDate.parse(deadlineInput) }.getOrNull()
        AlertDialog(
            onDismissRequest = { edit = null },
            title = { Text("Крайний срок получения") },
            text = {
                Column {
                    Text("Укажите проверенный срок в формате ГГГГ-ММ-ДД.")
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = deadlineInput,
                        onValueChange = { deadlineInput = it },
                        singleLine = true,
                        label = { Text("ГГГГ-ММ-ДД") },
                    )
                }
            },
            confirmButton = {
                Button(onClick = {
                    onSaveDeadline(order, deadlineInput)
                    edit = null
                }, enabled = valid != null && !busy) { Text("Сохранить") }
            },
            dismissButton = { TextButton(onClick = { edit = null }) { Text("Отмена") } },
        )
    }

    if (sentConfirmation != null) {
        val (order, stage, channel) = sentConfirmation!!
        AlertDialog(
            onDismissRequest = { sentConfirmation = null },
            title = { Text("Сообщение отправлено?") },
            text = { Text("Подтверждайте только после отправки сообщения клиенту.") },
            confirmButton = {
                Button(onClick = {
                    onConfirmSent(order, stage, channel)
                    sentConfirmation = null
                }, enabled = !busy) { Text("Да, отправлено") }
            },
            dismissButton = { TextButton(onClick = { sentConfirmation = null }) { Text("Нет") } },
        )
    }
}

private fun openPickupDraft(context: Context, phone: String, channel: String, message: String): Boolean {
    val normalized = normalizeCustomerPhone(phone) ?: return false
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Нагадування", message))
    val uri = Uri.Builder()
        .scheme(if (channel == "viber") "viber" else "tg")
        .authority(if (channel == "viber") "chat" else "resolve")
        .appendQueryParameter(if (channel == "viber") "number" else "phone", normalized)
        .build()
    return try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
        Toast.makeText(context, "Текст скопирован. Вставьте его в чат.", Toast.LENGTH_LONG).show()
        true
    } catch (_: Exception) {
        false
    }
}
