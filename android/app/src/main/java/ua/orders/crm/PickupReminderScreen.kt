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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.temporal.ChronoUnit

private data class PendingSentDialog(
    val order: Order,
    val stage: PickupReminderStage,
    val channel: String?,
)

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
    // A single transient dialog state, like the working "Изменить срок"
    // dialog. Prepare it before leaving for a messenger; if Android kills
    // this screen, the unconditional manual confirmation action remains.
    var sentDialog by remember { mutableStateOf<PendingSentDialog?>(null) }

    fun askAboutSentMessage(order: Order, stage: PickupReminderStage, channel: String?) {
        sentDialog = PendingSentDialog(order, stage, channel)
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
                                                colors = ButtonDefaults.filledTonalButtonColors(
                                                    containerColor = Color(0xFFEDE9FE),
                                                    contentColor = Color(0xFF5B21B6),
                                                ),
                                            ) { Text("Позвонить", style = MaterialTheme.typography.labelSmall) }
                                        } else {
                                            val channel = if (action == ContactAction.VIBER) "viber" else "telegram"
                                            Button(
                                                onClick = {
                                                    val draft = order.pickupReminderText(stage, reminder.deadline, today)
                                                    askAboutSentMessage(order, stage, channel)
                                                    if (!openPickupDraft(context, contactPhone.orEmpty(), channel, draft)) {
                                                        Toast.makeText(context, "Текст скопирован, чат можно открыть вручную.",
                                                            Toast.LENGTH_LONG).show()
                                                    }
                                                },
                                                enabled = !busy && contactPhone != null,
                                                modifier = Modifier.weight(1f).height(44.dp),
                                                contentPadding = PaddingValues(horizontal = 4.dp),
                                                colors = ButtonDefaults.buttonColors(
                                                    containerColor = if (action == ContactAction.VIBER)
                                                        Color(0xFF7360F2) else Color(0xFF229ED9),
                                                    contentColor = Color.White,
                                                ),
                                            ) { Text(if (action == ContactAction.VIBER) "Viber" else "Telegram",
                                                style = MaterialTheme.typography.labelSmall) }
                                        }
                                    }
                                }
                                // Always available for a message sent outside the app,
                                // even if the messenger never returned an activity result.
                                TextButton(
                                    onClick = { askAboutSentMessage(order, stage, null) },
                                    enabled = !busy,
                                ) { Text("Отметить отправленным") }
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

    val dialog = sentDialog
    if (dialog != null) {
        AlertDialog(
            onDismissRequest = { sentDialog = null },
            title = { Text("Сообщение отправлено?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Подтверждайте только после фактической отправки сообщения клиенту.")
                    Text("Где отправлено?")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("viber" to "Viber", "telegram" to "Telegram").forEach { (channel, title) ->
                            FilterChip(
                                selected = dialog.channel == channel,
                                onClick = { sentDialog = dialog.copy(channel = channel) },
                                label = { Text(title) },
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(onClick = {
                    val channel = dialog.channel ?: return@Button
                    onConfirmSent(dialog.order, dialog.stage, channel)
                    sentDialog = null
                }, enabled = !busy && dialog.channel != null) { Text("Да, отправлено") }
            },
            dismissButton = { TextButton(onClick = { sentDialog = null }) { Text("Нет") } },
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
