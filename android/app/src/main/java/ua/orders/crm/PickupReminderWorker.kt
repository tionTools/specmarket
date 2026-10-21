package ua.orders.crm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.jan.supabase.auth.status.SessionStatus
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout

const val EXTRA_OPEN_REMINDERS = "ua.orders.crm.extra.OPEN_REMINDERS"
private const val REMINDER_WORK_NAME = "pickup_reminders_daily"
private const val REMINDER_CHANNEL = "pickup_reminders"
private const val REMINDER_PREFS = "pickup_reminder_notification_receipts"

fun Context.schedulePickupReminderCheck(nextDay: Boolean = false, append: Boolean = false) {
    if (!pushSessionActive()) return
    val now = ZonedDateTime.now(ZoneId.of(PICKUP_KYIV_ZONE))
    val request = OneTimeWorkRequestBuilder<PickupReminderWorker>()
        .setInitialDelay(millisUntilPickupMorning(now, nextDay), TimeUnit.MILLISECONDS)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
        .build()
    WorkManager.getInstance(applicationContext).enqueueUniqueWork(
        REMINDER_WORK_NAME,
        if (append) ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP,
        request,
    )
}

fun Context.cancelPickupReminderChecks() =
    WorkManager.getInstance(applicationContext).cancelUniqueWork(REMINDER_WORK_NAME)

private fun Context.checkedPickupDay(account: String, today: LocalDate): Boolean {
    val key = "day:${account.lowercase().trim().hashCode()}"
    return getSharedPreferences(REMINDER_PREFS, Context.MODE_PRIVATE)
        .getString(key, null) == today.toString()
}

private fun Context.markPickupDayChecked(account: String, today: LocalDate) {
    val key = "day:${account.lowercase().trim().hashCode()}"
    getSharedPreferences(REMINDER_PREFS, Context.MODE_PRIVATE)
        .edit().putString(key, today.toString()).apply()
}

private fun Context.postPickupReminderNotification(count: Int) {
    if (count <= 0 || !canPostOrderNotifications()) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
        NotificationChannel(REMINDER_CHANNEL, "Напоминания о получении", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Одно уведомление в день не раньше 08:00 по Киеву"
        },
    )
    val intent = Intent(this, MainActivity::class.java).apply {
        putExtra(EXTRA_OPEN_REMINDERS, true)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingIntent = PendingIntent.getActivity(
        this, 4601, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = Notification.Builder(this, REMINDER_CHANNEL)
        .setSmallIcon(R.drawable.ic_specmarket_notification)
        .setContentTitle("Пора напомнить о посылках")
        .setContentText("Ожидают напоминания: $count")
        .setContentIntent(pendingIntent)
        .setCategory(Notification.CATEGORY_REMINDER)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .build()
    manager.notify(4601, notification)
}

class PickupReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        if (!app.pushSessionActive()) return Result.success()
        val now = ZonedDateTime.now(ZoneId.of(PICKUP_KYIV_ZONE))
        if (now.hour < 8 || now.hour >= 21) {
            app.schedulePickupReminderCheck(nextDay = now.hour >= 21, append = true)
            return Result.success()
        }

        var shouldRetry = false
        try {
            if (!app.pickupNotificationsEnabled().first() || !app.canPostOrderNotifications())
                return Result.success()

            val repo = OrdersRepository()
            val auth = withTimeout(15_000) {
                repo.sessionStatus.first { it !is SessionStatus.Initializing }
            }
            val account = (auth as? SessionStatus.Authenticated)?.session?.user?.email.orEmpty()
            if (account.isBlank()) return Result.success()

            val today = pickupToday()
            if (app.checkedPickupDay(account, today)) return Result.success()
            val reminders = withTimeout(20_000) { repo.pickupReminders() }
            val candidates = reminders.filter { reminder ->
                val deadline = runCatching { LocalDate.parse(reminder.deadline) }.getOrNull()
                (deadline == today && reminder.lastSentAt == null) ||
                    (deadline == today.plusDays(1) && reminder.firstSentAt == null)
            }
            // Re-read each live order; delivered and returning parcels never trigger notifications.
            val count = withTimeout(90_000) {
                candidates.count { reminder ->
                    repo.order(reminder.orderId)?.isPickupReminderDue(reminder, today) == true
                }
            }
            if (count > 0) app.postPickupReminderNotification(count)
            app.markPickupDayChecked(account, today)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            if (runAttemptCount < 2 &&
                ZonedDateTime.now(ZoneId.of(PICKUP_KYIV_ZONE)).hour in 8..20) {
                shouldRetry = true
                return Result.retry()
            }
        } finally {
            if (!shouldRetry && app.pushSessionActive()) app.schedulePickupReminderCheck(nextDay = true, append = true)
        }
        return Result.success()
    }
}
