package ua.orders.crm

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.math.RoundingMode

private const val NEW_ORDERS_CHANNEL_ID = "new_orders"
const val EXTRA_OPEN_ORDER_ID = "ua.orders.crm.extra.OPEN_ORDER_ID"

data class PushOrderNotification(
    val orderId: String,
    val platform: String,
    val total: String,
    val customer: String,
    val number: String,
)

fun pushOrderNotification(data: Map<String, String>): PushOrderNotification? {
    if (data["type"] != "new_order") return null
    val orderId = data["order_id"].orEmpty().trim()
    if (orderId.isEmpty()) return null
    return PushOrderNotification(
        orderId = orderId,
        platform = data["platform"].orEmpty().trim().ifBlank { "—" },
        total = data["total"].orEmpty().trim().ifBlank { "—" },
        customer = data["customer"].orEmpty().trim().ifBlank { "—" },
        number = data["order_number"].orEmpty().trim().ifBlank { "—" },
    )
}

fun Context.canPostOrderNotifications(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

fun Context.showNewOrderNotification(order: Order) {
    val total = order.total().setScale(2, RoundingMode.HALF_UP).toPlainString() + " грн"
    showNewOrderNotification(
        PushOrderNotification(
            orderId = order.id,
            platform = order.platform.display(),
            total = total,
            customer = order.customer.display(),
            number = order.number(),
        ),
    )
}

fun Context.showNewOrderNotification(order: PushOrderNotification) {
    if (!canPostOrderNotifications()) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
        NotificationChannel(
            NEW_ORDERS_CHANNEL_ID,
            "Новые заказы",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Новые заказы Prom, Эпицентр и Kasta"
        },
    )
    val intent = Intent(this, MainActivity::class.java).apply {
        putExtra(EXTRA_OPEN_ORDER_ID, order.orderId)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingIntent = PendingIntent.getActivity(
        this,
        order.orderId.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = Notification.Builder(this, NEW_ORDERS_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_orders)
        .setContentTitle("Новый заказ · ${order.platform} · ${order.total}")
        .setContentText("${order.customer} · №${order.number}")
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(pendingIntent)
        .setCategory(Notification.CATEGORY_MESSAGE)
        .build()
    manager.notify(order.orderId.hashCode(), notification)
}
