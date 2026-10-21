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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate


@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PickupReminderContent(
    orders: List<Order>,
    queue: List<PickupQueueRow>,
    loading: Boolean,
    busy: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onSaveDeadline: (Order, String) -> Unit,
    onConfirmSent: (PickupQueueRow, PickupReminderStage, String) -> Unit,
    onConfirmManualSent: (PickupQueueRow, String) -> Unit,
    searchQuery: String = "",
) {
    val byId = remember(orders, queue) {
        orders.filter { order ->
            queue.any { row -> row.orderId == order.id &&
                row.ttn == order.deliveryValue("ttn").trim() }
        }.associateBy { it.id }
    }
    val messengersEnabled by LocalContext.current.messengersEnabled().collectAsState(initial = true)
    val visible = queue.filter {
        searchQuery.isBlank() || it.ttn.contains(searchQuery.trim(), true) ||
            it.orderNumber?.toString()?.contains(searchQuery.trim()) == true ||
            byId[it.orderId]?.matchesOrderSearch(searchQuery) == true
    }
    val urgent = visible.filter { it.activeStage() != null }
    val informational = visible.filter { it.activeStage() == null }
    var edit by remember { mutableStateOf<Order?>(null) }
    var deadlineInput by remember { mutableStateOf("") }
    var pendingId by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingTtn by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingStage by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingChannel by rememberSaveable { mutableStateOf<String?>(null) }
    fun clear() {
        pendingId = null
        pendingTtn = null
        pendingStage = null
        pendingChannel = null
    }
    fun beginSend(row: PickupQueueRow, stage: PickupReminderStage?, channel: String?) {
        pendingId = row.orderId
        pendingTtn = row.ttn
        pendingStage = stage?.databaseValue ?: "manual"
        pendingChannel = channel
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text("Напомнить", style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = onRefresh, enabled = !loading && !busy) { Text("Обновить") }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        LazyColumn(Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "urgent_title") {
                Text("Первая очередь — пора напомнить (" + urgent.size + ")",
                    style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 6.dp))
            }
            if (urgent.isEmpty()) item(key = "urgent_empty") {
                Text(if (loading) "Загрузка…" else if (error != null && queue.isEmpty())
                    "Список недоступен." else "Срочных напоминаний нет.",
                    modifier = Modifier.padding(vertical = 8.dp))
            }
            items(urgent, key = { "urgent-" + it.orderId }) { row ->
                PickupReminderCard(row, byId[row.orderId], busy, messengersEnabled,
                    onEdit = { order ->
                        edit = order
                        deadlineInput = row.deadline.orEmpty()
                    }, onAskSent = ::beginSend)
            }
            item(key = "separator") { HorizontalDivider(Modifier.padding(vertical = 8.dp)) }
            item(key = "info_title") {
                Text("Вторая очередь — информационно (" + informational.size + ")",
                    style = MaterialTheme.typography.titleSmall)
            }
            if (informational.isEmpty()) item(key = "info_empty") {
                Text(if (loading) "Загрузка…" else if (error != null && queue.isEmpty())
                    "Список недоступен." else "Других посылок на получении нет.",
                    modifier = Modifier.padding(vertical = 8.dp))
            }
            items(informational, key = { "info-" + it.orderId }) { row ->
                PickupReminderCard(row, byId[row.orderId], busy, messengersEnabled,
                    onEdit = { order ->
                        edit = order
                        deadlineInput = row.deadline.orEmpty()
                    }, onAskSent = ::beginSend)
            }
        }
    }
    if (edit != null) {
        val order = edit!!
        AlertDialog(
            onDismissRequest = { edit = null },
            title = { Text("Проверенный срок получения") },
            text = { Column {
                Text("Укажите проверенный срок в формате ГГГГ-ММ-ДД.")
                OutlinedTextField(deadlineInput, { deadlineInput = it },
                    label = { Text("ГГГГ-ММ-ДД") }, singleLine = true)
            } },
            confirmButton = { Button(onClick = {
                onSaveDeadline(order, deadlineInput)
                edit = null
            }, enabled = !busy && runCatching { LocalDate.parse(deadlineInput) }.isSuccess) {
                Text("Сохранить")
            } },
            dismissButton = { TextButton(onClick = { edit = null }) { Text("Отмена") } },
        )
    }
    val current = queue.firstOrNull { it.orderId == pendingId && it.ttn == pendingTtn }
    val stage = when (pendingStage) {
        "first" -> PickupReminderStage.FIRST
        "last" -> PickupReminderStage.LAST
        else -> null
    }
    if (current != null && pendingStage != null) {
        AlertDialog(
            onDismissRequest = ::clear,
            title = { Text("Сообщение отправлено?") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Подтверждайте только после фактической отправки клиенту.")
                Text("Где отправлено?")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("viber" to "Viber", "telegram" to "Telegram").forEach { (channel, title) ->
                        FilterChip(selected = pendingChannel == channel, onClick = {
                            pendingChannel = channel
                        }, label = { Text(title) })
                    }
                }
            } },
            confirmButton = { Button(onClick = {
                val channel = pendingChannel ?: return@Button
                if (stage == null) onConfirmManualSent(current, channel)
                else onConfirmSent(current, stage, channel)
                clear()
            }, enabled = !busy && pendingChannel != null &&
                (stage == null || current.activeStage() == stage)) { Text("Да, отправлено") } },
            dismissButton = { TextButton(onClick = ::clear) { Text("Нет") } },
        )
    }
}

@Composable
private fun PickupReminderCard(
    row: PickupQueueRow,
    order: Order?,
    busy: Boolean,
    messengersEnabled: Boolean,
    onEdit: (Order) -> Unit,
    onAskSent: (PickupQueueRow, PickupReminderStage?, String?) -> Unit,
) {
    val context = LocalContext.current
    val stage = row.activeStage()
    val phone = order?.pickupContactPhone()
    val meest = order?.isMeestShipment() == true ||
        row.carrier.orEmpty().lowercase().contains("meest")
    Card(shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("Заказ №" + (row.orderNumber?.toString() ?: order?.number() ?: "—"),
                fontWeight = FontWeight.SemiBold)
            if (order != null) Text(order.recipientName(), style = MaterialTheme.typography.bodyMedium)
            Text("ТТН: " + row.ttn, style = MaterialTheme.typography.bodySmall)
            if (!row.carrier.isNullOrBlank())
                Text("Перевозчик: " + row.carrier, style = MaterialTheme.typography.bodySmall)
            if (!row.trackingStatus.isNullOrBlank())
                Text("Статус: " + row.trackingStatus, style = MaterialTheme.typography.bodySmall)
            if (order?.isNovaPickupPoint() == true) Text("Пункт выдачи НП",
                color = MaterialTheme.colorScheme.primary)
            val arrival = order?.deliveryValue("trackingPickupArrivedAt").orEmpty()
            if (arrival.isNotBlank()) Text("Прибытие: " + arrival,
                style = MaterialTheme.typography.bodySmall)
            Text(when (stage) {
                PickupReminderStage.FIRST -> "Первое напоминание"
                PickupReminderStage.LAST -> "Повторное напоминание"
                null -> "Посылка ожидает получения"
            }, fontWeight = FontWeight.SemiBold)
            Text(when {
                row.deadline.isNullOrBlank() -> "Срок хранения неизвестен"
                meest -> "Контрольная дата напоминания: " + row.deadline
                row.source == "manual" -> "Проверенный срок: " + row.deadline
                else -> "Расчётный срок: " + row.deadline
            }, style = MaterialTheme.typography.bodyMedium)
            if (stage == null && row.firstSentAt != null && row.lastSentAt == null)
                Text("Первое напоминание отмечено. Второе появится в день срока.",
                    style = MaterialTheme.typography.bodySmall)
            if (order != null) TextButton(onClick = { onEdit(order) }, enabled = !busy) {
                Text("Изменить срок")
            } else Text("Контакты не загружены. Обновите список.",
                style = MaterialTheme.typography.bodySmall)
            if (stage == null) Text("Можно напомнить вручную без утверждения о сроке возврата.",
                style = MaterialTheme.typography.bodySmall)
            else if (messengersEnabled) Text("Текст будет скопирован. После отправки подтвердите.",
                style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                for (action in contactActions(messengersEnabled)) {
                    if (action == ContactAction.CALL) {
                        FilledTonalButton(onClick = { openDialer(context, phone.orEmpty()) },
                            enabled = !busy && phone != null,
                            modifier = Modifier.weight(1f).height(44.dp),
                            contentPadding = PaddingValues(horizontal = 4.dp),
                            colors = ButtonDefaults.filledTonalButtonColors(
                                containerColor = Color(0xFFEDE9FE),
                                contentColor = Color(0xFF5B21B6))) {
                            Text("Позвонить", style = MaterialTheme.typography.labelSmall)
                        }
                    } else {
                        val channel = if (action == ContactAction.VIBER) "viber" else "telegram"
                        Button(onClick = {
                            if (order != null) {
                                val draft = if (stage == null || row.deadline.isNullOrBlank())
                                    order.pickupManualReminderText()
                                else order.pickupReminderText(stage, row.deadline)
                                onAskSent(row, stage, channel)
                                if (!openPickupDraft(context, phone.orEmpty(), channel, draft))
                                    Toast.makeText(context, "Текст скопирован, чат можно открыть вручную.",
                                        Toast.LENGTH_LONG).show()
                            }
                        }, enabled = !busy && phone != null,
                            modifier = Modifier.weight(1f).height(44.dp),
                            contentPadding = PaddingValues(horizontal = 4.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (action == ContactAction.VIBER)
                                    Color(0xFF7360F2) else Color(0xFF229ED9),
                                contentColor = Color.White)) {
                            Text(if (action == ContactAction.VIBER) "Viber" else "Telegram",
                                style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            TextButton(onClick = { onAskSent(row, stage, null) }, enabled = !busy && order != null) {
                Text(if (stage == null) "Отметить ручную отправку" else "Отметить отправленным")
            }
        }
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
