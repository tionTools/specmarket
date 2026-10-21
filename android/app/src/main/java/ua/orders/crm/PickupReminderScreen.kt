package ua.orders.crm

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Person
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
    manualHistory: Map<String, PickupManualLog>,
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
    // Preserve server-defined urgency; sort the dates within each queue.
    val urgent = sortPickupQueueByDeadline(visible.filter { it.activeStage() != null })
    val informational = sortPickupQueueByDeadline(visible.filter { it.activeStage() == null })
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
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
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
                    manualLog = manualHistory[row.orderId + "|" + row.ttn],
                    onEdit = { order ->
                        edit = order
                        deadlineInput = row.deadline.orEmpty()
                    }, onAskSent = ::beginSend)
            }
            item(key = "separator") { HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant) }
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
                    manualLog = manualHistory[row.orderId + "|" + row.ttn],
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
    manualLog: PickupManualLog?,
    onEdit: (Order) -> Unit,
    onAskSent: (PickupQueueRow, PickupReminderStage?, String?) -> Unit,
) {
    val context = LocalContext.current
    val stage = row.activeStage()
    val phone = order?.pickupContactPhone()
    val meest = order?.isMeestShipment() == true ||
        row.carrier.orEmpty().lowercase().contains("meest")
    // Match OrderCard: same white/dark surface, elevation, 22dp corners, compact spacing.
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 13.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        "№ " + (row.orderNumber?.toString() ?: order?.number() ?: "—"),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                    if (order != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            PlatformLogo(order.platform)
                            Spacer(Modifier.width(6.dp))
                            Text(
                                listOf(order.orderDate, order.orderTime)
                                    .filterNotNull().filter(String::isNotBlank).joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                }
                Spacer(Modifier.width(6.dp))
                val activeLabel = when (stage) {
                    PickupReminderStage.FIRST -> "Первое напоминание"
                    PickupReminderStage.LAST -> "Повторное напоминание"
                    null -> "Ожидает получения"
                }
                val activeColor = if (stage == null) Color(0xFFDCFCE7) else Color(0xFFFFEDD5)
                val activeText = if (stage == null) Color(0xFF166534) else Color(0xFF9A3412)
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = activeColor,
                    contentColor = activeText,
                ) {
                    Text(
                        activeLabel,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            val product = order?.items?.minByOrNull { it.position ?: Int.MAX_VALUE }
            if (product != null) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    ProductThumbnail(product.imageUrl, size = 72.dp)
                    Spacer(Modifier.width(9.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            product.productName.display(),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 2,
                        )
                        product.size?.takeIf(String::isNotBlank)?.let { size ->
                            Text(
                                "Размер: $size",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        val extra = (order.items.size - 1).coerceAtLeast(0)
                        if (extra > 0) {
                            Text(
                                "Ещё $extra товаров",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            if (order != null) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Icon(
                        Icons.Filled.Person,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(17.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Column(Modifier.weight(1f)) {
                        Text(order.recipientName(), style = MaterialTheme.typography.bodyMedium)
                        val buyerPhone = order.buyerPhone()
                        if (buyerPhone != "—") {
                            Text(
                                buyerPhone,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFFEAF8F2),
                contentColor = Color(0xFF087B58),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(Icons.Filled.LocalShipping, contentDescription = null,
                        modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            "Готово к выдаче",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                        )
                        Text(
                            listOf(row.ttn, row.carrier.orEmpty())
                                .filter(String::isNotBlank).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.Black,
                            maxLines = 2,
                        )
                        if (!row.trackingStatus.isNullOrBlank()) {
                            Text(
                                row.trackingStatus,
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFF087B58),
                                maxLines = 2,
                            )
                        }
                    }
                }
            }

            val arrival = order?.deliveryValue("trackingPickupArrivedAt").orEmpty()
            if (arrival.isNotBlank()) {
                Text("Прибытие: " + arrival, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val deadlineText = when {
                row.deadline.isNullOrBlank() -> "Срок хранения неизвестен"
                meest -> "Контрольная дата напоминания: " + row.deadline
                row.source == "manual" -> "Проверенный срок: " + row.deadline
                else -> "Расчётный срок: " + row.deadline
            }
            Text(
                deadlineText,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (order?.isNovaPickupPoint() == true) {
                Text("Пункт выдачи НП", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary)
            }
            if (manualLog != null) {
                val clock = runCatching {
                    java.time.Instant.parse(manualLog.acknowledgedAt)
                        .atZone(java.time.ZoneId.of(PICKUP_KYIV_ZONE))
                        .format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm"))
                }.getOrDefault(manualLog.acknowledgedAt)
                Text(
                    "Последнее ручное напоминание: " + clock + " · " +
                        manualLog.channel.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (stage == null && row.firstSentAt != null && row.lastSentAt == null) {
                Text(
                    "Первое напоминание отмечено. Второе появится в день срока.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (order != null) {
                TextButton(onClick = { onEdit(order) }, enabled = !busy) {
                    Text("Изменить срок")
                }
            } else {
                Text(
                    "Контакты не загружены. Обновите список.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (stage == null) {
                Text(
                    "Можно напомнить вручную без утверждения о сроке возврата.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else if (messengersEnabled) {
                Text(
                    "Текст будет скопирован. После отправки подтвердите.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
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
