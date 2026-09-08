package ua.orders.crm

import android.content.Context
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.map

enum class Appearance(val label: String) { SYSTEM("Системная"), LIGHT("Светлая"), DARK("Тёмная") }
fun Appearance.isDark(systemDark: Boolean) = this == Appearance.DARK || this == Appearance.SYSTEM && systemDark
private val Context.appearanceStore by preferencesDataStore("orders_appearance")
private val appearanceKey = stringPreferencesKey("appearance")
private val newOrderNotificationsKey = booleanPreferencesKey("new_order_notifications")
private val notificationPermissionAskedKey = booleanPreferencesKey("notification_permission_asked")
fun Context.appearance() = appearanceStore.data.map { Appearance.entries.find { mode -> mode.name == it[appearanceKey] } ?: Appearance.SYSTEM }
suspend fun Context.saveAppearance(value: Appearance) { appearanceStore.edit { it[appearanceKey] = value.name } }
fun Context.newOrderNotifications() = appearanceStore.data.map { it[newOrderNotificationsKey] ?: true }
suspend fun Context.saveNewOrderNotifications(value: Boolean) { appearanceStore.edit { it[newOrderNotificationsKey] = value } }
fun Context.notificationPermissionAsked() = appearanceStore.data.map { it[notificationPermissionAskedKey] ?: false }
suspend fun Context.saveNotificationPermissionAsked(value: Boolean) { appearanceStore.edit { it[notificationPermissionAskedKey] = value } }

fun ordersColors(dark: Boolean): ColorScheme = if (dark) {
    darkColorScheme(
        primary = Color(0xFF6EE7B7),
        onPrimary = Color(0xFF052E25),
        secondary = Color(0xFFF0ABFC),
        tertiary = Color(0xFF7DD3FC),
        background = Color(0xFF0F172A),
        surface = Color(0xFF111827),
        surfaceVariant = Color(0xFF1E293B),
        onSurface = Color(0xFFF8FAFC),
        onSurfaceVariant = Color(0xFFCBD5E1),
        outline = Color(0xFF64748B),
        outlineVariant = Color(0xFF334155),
    )
} else {
    lightColorScheme(
        primary = Color(0xFF047857),
        onPrimary = Color.White,
        secondary = Color(0xFFC026D3),
        tertiary = Color(0xFF0369A1),
        background = Color(0xFFF8FAFC),
        surface = Color.White,
        surfaceVariant = Color(0xFFF1F5F9),
        onSurface = Color(0xFF0F172A),
        onSurfaceVariant = Color(0xFF475569),
        outline = Color(0xFF94A3B8),
        outlineVariant = Color(0xFFE2E8F0),
    )
}
