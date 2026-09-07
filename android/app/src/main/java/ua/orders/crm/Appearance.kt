package ua.orders.crm

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.flow.map

enum class Appearance(val label: String) { SYSTEM("Системная"), LIGHT("Светлая"), DARK("Тёмная") }
fun Appearance.isDark(systemDark: Boolean) = this == Appearance.DARK || this == Appearance.SYSTEM && systemDark
private val Context.appearanceStore by preferencesDataStore("orders_appearance")
private val appearanceKey = stringPreferencesKey("appearance")
private val newOrderNotificationsKey = booleanPreferencesKey("new_order_notifications")
fun Context.appearance() = appearanceStore.data.map { Appearance.entries.find { mode -> mode.name == it[appearanceKey] } ?: Appearance.SYSTEM }
suspend fun Context.saveAppearance(value: Appearance) { appearanceStore.edit { it[appearanceKey] = value.name } }
fun Context.newOrderNotifications() = appearanceStore.data.map { it[newOrderNotificationsKey] ?: true }
suspend fun Context.saveNewOrderNotifications(value: Boolean) { appearanceStore.edit { it[newOrderNotificationsKey] = value } }
fun ordersColors(dark: Boolean): ColorScheme = if (dark) darkColorScheme(primary = Color(0xFF9CCAFF), secondary = Color(0xFFFFB95B), surface = Color(0xFF121417), onSurface = Color(0xFFE2E2E6)) else lightColorScheme(primary = Color(0xFF155E9E), secondary = Color(0xFF795900), surface = Color(0xFFFFFBFF), onSurface = Color(0xFF1A1C20))
