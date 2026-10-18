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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import java.time.LocalDate
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PickupReminderContent(
    orders: List<Order>,
    reminders: Map<String, PickupReminderState>,
    loading: Boolean,
    busy: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onSaveDeadline: (Order, String) -> Unit,
    onConfirmSent: (Order, PickupReminderStage, String) -> Unit,
) {
    val context = LocalContext.current
    val messengersEnabled by context.messengersEnabled().collectAsState(initial = true)
    val today = pickupToday()
    var edit by remember { mutableStateOf<Order?>(null) }
    var deadlineInput by remember { mutableStateOf("") }
    // Keep the pending send attempt in saved state *before* launching the messenger.
    // The system may recreate our activity while Telegram/Viber is in front.
    var pendingOrderId by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingStageName by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingChannel by rememberSaveable { mutableStateOf<String?>(null) }
    var awaitingMessengerReturn by rememberSaveable { mutableStateOf(false) }
    var showSentConfirmation by rememberSaveable { mutableStateOf(false) }

    fun clearPendingSend() {
        pendingOrderId = null
        pendingStageName = null
        pendingChannel = null
        awaitingMessengerReturn = false
        showSentConfirmation = false
    }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (pendingOrderId != null && awaitingMessengerReturn) {
            awaitingMessengerReturn = false
            showSentConfirmation = true
        }
    }
    val applicable = remember(orders, reminders, today) {
        orders.filter(::isOrderVisibleInMainList).filter { order ->
            order.isPickupReminderDue(reminders[order.id], today)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Кому пора напомнить", style = MaterialTheme.typography.titleSmall)
            TextButton(onRefresh, enabled = !loading && !busy) { Text("Обновить") }
        }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error != null) {
                Text(error, color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            }
            Text("Сроки получены из штатной синхронизации. Сообщения отправляются вручную.",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                style = MaterialTheme.typography.bodySmall)
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
                    val contactPhone = order.pickupContactPhone()
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
                                null -> "Напоминание не требуется"
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
                                if (messengersEnabled) {
                                    Text("Текст будет скопирован. Отправку подтвердите после сообщения.",
                                        style = MaterialTheme.typography.bodySmall)
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    for (action in contactActions(messengersEnabled)) {
                                        if (action == ContactAction.CALL) {
                                            FilledTonalButton(
                                                onClick = { openDialer(context, contactPhone.orEmpty()) },
                                                enabled = !busy && contactPhone != null,
                                                modifier = Modifier.weight(1f).height(44.dp),
                                                contentPadding = PaddingValues(horizontal = 4.dp),
                                            ) { Text("Позвонить", style = MaterialTheme.typography.labelSmall) }
                                        } else {
                                            val channel = if (action == ContactAction.VIBER) "viber" else "telegram"
                                            Button(
                                                onClick = {
                                                    val draft = order.pickupReminderText(stage, reminder.deadline, today)
                                                    pendingOrderId = order.id
                                                    pendingStageName = stage.name
                                                    pendingChannel = channel
                                                    awaitingMessengerReturn = true
                                                    showSentConfirmation = false
                                                    if (!openPickupDraft(context, contactPhone.orEmpty(), channel, draft)) {
                                                        awaitingMessengerReturn = false
                                                        showSentConfirmation = true
                                                        Toast.makeText(context, "Текст скопирован, чат можно открыть вручную.",
                                                            Toast.LENGTH_LONG).show()
                                                    }
                                                },
                                                enabled = !busy && contactPhone != null,
                                                modifier = Modifier.weight(1f).height(44.dp),
                                                contentPadding = PaddingValues(horizontal = 4.dp),
                                            ) { Text(if (action == ContactAction.VIBER) "Viber" else "Telegram",
                                                style = MaterialTheme.typography.labelSmall) }
                                        }
                                    }
                                }
                                if (pendingOrderId == order.id &&
                                    pendingStageName == stage.name && pendingChannel != null) {
                                    TextButton(onClick = {
                                        awaitingMessengerReturn = false
                                        showSentConfirmation = true
                                    }) { Text("Подтвердить отправку") }
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

    val pendingOrder = orders.firstOrNull { it.id == pendingOrderId }
    val pendingStage = pendingStageName?.let { name ->
        PickupReminderStage.entries.firstOrNull { it.name == name }
    }
    val selectedChannel = pendingChannel
    if (showSentConfirmation && pendingOrder != null && pendingStage != null && selectedChannel != null) {
        AlertDialog(
            onDismissRequest = { clearPendingSend() },
            title = { Text("Сообщение отправлено?") },
            text = { Text("Подтверждайте только после отправки сообщения клиенту.") },
            confirmButton = {
                Button(onClick = {
                    onConfirmSent(pendingOrder, pendingStage, selectedChannel)
                    clearPendingSend()
                }, enabled = !busy) { Text("Да, отправлено") }
            },
            dismissButton = { TextButton(onClick = { clearPendingSend() }) { Text("Нет") } },
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
