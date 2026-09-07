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

private const val NEW_ORDERS_CHANNEL_ID = "new_orders"

fun Context.canPostOrderNotifications(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

fun Context.showNewOrderNotification(order: Order) {
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
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingIntent = PendingIntent.getActivity(
        this,
        order.id.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = Notification.Builder(this, NEW_ORDERS_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_orders)
        .setContentTitle("Новый заказ · ${order.platform.display()}")
        .setContentText("№${order.number()} · ${order.customer.display()}")
        .setAutoCancel(true)
        .setContentIntent(pendingIntent)
        .setCategory(Notification.CATEGORY_MESSAGE)
        .build()
    manager.notify(order.id.hashCode(), notification)
}
