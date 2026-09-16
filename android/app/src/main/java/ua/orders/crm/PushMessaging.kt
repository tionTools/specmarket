package ua.orders.crm

import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

private const val PUSH_PREFS = "orders_push"
private const val PUSH_DEVICE_ID = "device_id"
private const val PUSH_SESSION_ACTIVE = "session_active"
private const val PUSH_NOTIFICATIONS_ENABLED = "notifications_enabled"

fun Context.pushDeviceId(): String {
    val preferences = getSharedPreferences(PUSH_PREFS, Context.MODE_PRIVATE)
    val existing = preferences.getString(PUSH_DEVICE_ID, null)
    if (!existing.isNullOrBlank()) return existing
    val created = UUID.randomUUID().toString()
    preferences.edit().putString(PUSH_DEVICE_ID, created).apply()
    return created
}

fun Context.savePushSessionActive(active: Boolean) {
    getSharedPreferences(PUSH_PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(PUSH_SESSION_ACTIVE, active)
        .apply()
}

fun Context.pushSessionActive(): Boolean =
    getSharedPreferences(PUSH_PREFS, Context.MODE_PRIVATE).getBoolean(PUSH_SESSION_ACTIVE, false)

fun Context.savePushNotificationsEnabled(enabled: Boolean) {
    getSharedPreferences(PUSH_PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(PUSH_NOTIFICATIONS_ENABLED, enabled)
        .apply()
}

fun Context.pushNotificationsEnabled(): Boolean =
    getSharedPreferences(PUSH_PREFS, Context.MODE_PRIVATE).getBoolean(PUSH_NOTIFICATIONS_ENABLED, true)

suspend fun firebasePushToken(): String = suspendCancellableCoroutine { continuation ->
    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        if (!continuation.isActive) return@addOnCompleteListener
        if (task.isSuccessful && !task.result.isNullOrBlank()) {
            continuation.resume(task.result)
        } else {
            continuation.resumeWithException(task.exception ?: IllegalStateException("FCM token недоступен"))
        }
    }
}

class OrdersFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = applicationContext
        if (!app.pushSessionActive()) return
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                OrdersRepository().setPushDevice(
                    deviceId = app.pushDeviceId(),
                    token = token,
                    enabled = app.pushNotificationsEnabled() && app.canPostOrderNotifications(),
                )
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (_: Exception) {
                // Token rotation can race session restoration; foreground registration retries it.
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val app = applicationContext
        if (!app.pushSessionActive() || !app.pushNotificationsEnabled() || !app.canPostOrderNotifications()) return
        val notification = pushOrderNotification(message.data) ?: return
        app.showNewOrderNotification(notification)
    }
}
