package ua.orders.crm

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.exceptions.RestException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class OrdersViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = OrdersRepository()
    private val cache = OrdersCache(application)
    private val requests = Mutex()
    private val pendingNotificationIds = linkedSetOf<String>()
    private var realtimeJob: Job? = null
    private var realtimeGeneration = 0L
    private var refreshJob: Job? = null
    private var refreshGeneration = 0L
    private var pushRegistrationJob: Job? = null
    private var visible = false
    private var ordersBeforeDetail: List<Order> = emptyList()
    var email by mutableStateOf<String?>(null); private set
    var initializing by mutableStateOf(true); private set
    var initialLoadComplete by mutableStateOf(false); private set
    var authBusy by mutableStateOf(false); private set
    var orders by mutableStateOf<List<Order>>(emptyList()); private set
    var loading by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null); private set
    var realtimeConnected by mutableStateOf(false); private set
    var lastRefreshSucceeded by mutableStateOf(false); private set
    var selectedId by mutableStateOf<String?>(null); private set
    var detail by mutableStateOf<Order?>(null); private set
    var acceptingId by mutableStateOf<String?>(null); private set
    // Optional, lazy-loaded feature state. Core order refresh never touches it.
    var pickupQueue by mutableStateOf<List<PickupQueueRow>>(emptyList()); private set
    // Authoritative live orders for the reminder queue; never derive the badge from OrdersCache.
    var pickupOrders by mutableStateOf<List<Order>>(emptyList()); private set
    var pickupLoading by mutableStateOf(false); private set
    var pickupLoaded by mutableStateOf(false); private set
    var pickupBusy by mutableStateOf(false); private set
    var pickupError by mutableStateOf<String?>(null); private set
    private var pickupGeneration = 0L
    private var pickupLoadedDay: java.time.LocalDate? = null
    private var pickupJob: Job? = null
    private var pickupPollingJob: Job? = null

    init {
        viewModelScope.launch {
            repository.sessionStatus.collect { session ->
                if (session is SessionStatus.Initializing) {
                    initializing = true
                    return@collect
                }
                val nextEmail = (session as? SessionStatus.Authenticated)?.session?.user?.email
                if (session is SessionStatus.Authenticated) {
                    if (email != nextEmail) {
                        initializing = true
                        stopRealtime()
                        clearOrders()
                        val account = nextEmail.orEmpty()
                        val cached = cache.load(account)
                        email = nextEmail
                        if (cached != null) {
                            orders = sortOrdersForDisplay(cached.orders)
                            pendingNotificationIds.clear()
                            pendingNotificationIds.addAll(cached.pendingNotificationIds)
                            initialLoadComplete = true
                        }
                        initializing = false
                        if (visible) foreground(true)
                    } else {
                        initializing = false
                    }
                    getApplication<Application>().savePushSessionActive(true)
                    getApplication<Application>().schedulePickupReminderCheck()
                    syncPushRegistration()
                } else if (session is SessionStatus.NotAuthenticated) {
                    initializing = false
                    email = null
                    stopRealtime()
                    pushRegistrationJob?.cancel()
                    pushRegistrationJob = null
                    getApplication<Application>().savePushSessionActive(false)
                    getApplication<Application>().cancelPickupReminderChecks()
                    clearOrders()
                }
            }
        }
    }

    fun foreground(active: Boolean) {
        visible = active
        if (!active) {
            stopRealtime()
            pickupPollingJob?.cancel()
            pickupPollingJob = null
            return
        }
        if (email != null) {
            retryConnection()
            syncPushRegistration()
            loadPickupReminders()
            if (pickupPollingJob?.isActive != true) {
                pickupPollingJob = viewModelScope.launch {
                    while (isActive && visible && email != null) {
                        delay(20_000)
                        if (!pickupLoading && !pickupBusy) {
                            try {
                                val snapshot = withTimeout(15_000) { repository.pickupQueue() }
                                pickupQueue = snapshot
                                pickupLoaded = true
                                pickupLoadedDay = pickupToday()
                                pickupError = null
                            } catch (cancel: CancellationException) { throw cancel }
                            catch (_: Exception) {
                                pickupLoaded = false
                                pickupError = "Не удалось обновить напоминания. Нажмите «Обновить»."
                            }
                        }
                    }
                }
            }
        }
    }

    private fun stopRealtime() {
        ++realtimeGeneration
        realtimeConnected = false
        realtimeJob?.cancel()
    }

    fun networkRestored() {
        if (visible && email != null) {
            retryConnection()
            loadPickupReminders()
        }
    }

    fun retryConnection() {
        if (email == null) return
        startRealtime(forceRestart = true)
        refresh(force = true)
    }

    fun manualRefresh() {
        if (email == null) return
        startRealtime(forceRestart = true)
        refresh(force = true, reconcileRecent = true)
        loadPickupReminders()
    }

    private fun syncPushRegistration(enabledOverride: Boolean? = null) {
        if (email == null) return
        pushRegistrationJob?.cancel()
        pushRegistrationJob = viewModelScope.launch {
            try {
                val app = getApplication<Application>()
                val settingEnabled = enabledOverride ?: app.newOrderNotifications().first()
                app.savePushNotificationsEnabled(settingEnabled)
                val enabled = settingEnabled && app.canPostOrderNotifications()
                repository.setPushDevice(
                    deviceId = app.pushDeviceId(),
                    token = if (enabled) firebasePushToken() else null,
                    enabled = enabled,
                )
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (_: Exception) {
                // Registration is retried after auth restoration and on foreground resume.
            }
        }
    }

    private fun startRealtime(forceRestart: Boolean = false) {
        val account = email ?: return
        if (!visible) return
        val previousJob = realtimeJob
        if (!forceRestart && previousJob?.isActive == true) return
        val generation = ++realtimeGeneration
        if (forceRestart) {
            realtimeConnected = false
            previousJob?.cancel()
        }
        realtimeJob = viewModelScope.launch {
            // Old channel cleanup must not prevent a new connection indefinitely.
            withTimeoutOrNull(7_000) { previousJob?.join() }
            // Background new-order delivery uses FCM; Realtime is needed only while the UI is active.
            while (isActive && visible && email == account && generation == realtimeGeneration) {
                try {
                    repository.watch(onConnection = { connected ->
                        if (email == account && generation == realtimeGeneration) {
                            val reconnect = connected && !realtimeConnected
                            realtimeConnected = connected
                            if (reconnect) refresh()
                        }
                    }) { change ->
                        withTimeout(25_000) {
                            requests.withLock {
                                if (email != account || generation != realtimeGeneration) return@withLock
                                if (change.operation.equals("DELETE", ignoreCase = true)) {
                                    orders = orders.filterNot { it.id == change.order_id }
                                    pendingNotificationIds.remove(change.order_id)
                                    if (selectedId == change.order_id) { detail = null; message = "Заказ удалён." }
                                } else {
                                    val order = repository.order(change.order_id)
                                    if (order != null) {
                                        val known = orders.any { it.id == order.id }
                                        merge(order)
                                        if (!known) notifyOrQueue(order)
                                    }
                                }
                                persistCache(account)
                            }
                        }
                    }
                } catch (_: TimeoutCancellationException) {
                    if (generation == realtimeGeneration) realtimeConnected = false
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) {
                    if (generation == realtimeGeneration) realtimeConnected = false
                }
                delay(5_000)
            }
        }
    }

    private suspend fun notifyOrQueue(order: Order) {
        if (!shouldNotifyNewOrder(order)) {
            pendingNotificationIds.remove(order.id)
            return
        }
        val app = getApplication<Application>()
        if (!app.newOrderNotifications().first()) {
            pendingNotificationIds.remove(order.id)
            return
        }
        if (!app.canPostOrderNotifications()) {
            pendingNotificationIds.add(order.id)
            return
        }
        app.showNewOrderNotification(order)
        pendingNotificationIds.remove(order.id)
    }

    private suspend fun flushPendingNotificationsLocked() {
        if (pendingNotificationIds.isEmpty()) return
        val app = getApplication<Application>()
        if (!app.newOrderNotifications().first()) {
            pendingNotificationIds.clear()
            return
        }
        if (!app.canPostOrderNotifications()) return
        for (id in pendingNotificationIds.toList()) {
            val order = orders.find { it.id == id }
            if (order == null || !shouldNotifyNewOrder(order)) {
                pendingNotificationIds.remove(id)
                continue
            }
            app.showNewOrderNotification(order)
            pendingNotificationIds.remove(id)
        }
    }

    fun notificationsPermissionChanged() {
        viewModelScope.launch {
            requests.withLock {
                flushPendingNotificationsLocked()
                persistCache()
            }
            syncPushRegistration()
        }
    }

    fun notificationsSettingChanged(enabled: Boolean) {
        getApplication<Application>().savePushNotificationsEnabled(enabled)
        viewModelScope.launch {
            requests.withLock {
                if (!enabled) pendingNotificationIds.clear() else flushPendingNotificationsLocked()
                persistCache()
            }
            syncPushRegistration(enabled)
        }
    }

    private fun clearOrders() {
        ++refreshGeneration
        refreshJob?.cancel()
        refreshJob = null
        loading = false
        lastRefreshSucceeded = false
        ++realtimeGeneration
        orders = emptyList()
        ordersBeforeDetail = emptyList()
        selectedId = null
        detail = null
        pendingNotificationIds.clear()
        initialLoadComplete = false
        ++pickupGeneration
        pickupJob?.cancel()
        pickupJob = null
        pickupPollingJob?.cancel()
        pickupPollingJob = null
        pickupQueue = emptyList()
        pickupOrders = emptyList()
        pickupLoaded = false
        pickupLoadedDay = null
        pickupLoading = false
        pickupBusy = false
        pickupError = null
    }

    private fun merge(order: Order) {
        orders = mergeOrders(orders, listOf(order))
        if (selectedId == order.id) detail = order
    }

    private suspend fun persistCache(account: String? = email) {
        val currentAccount = account ?: return
        cache.save(currentAccount, orders, pendingNotificationIds)
    }

    fun refresh(force: Boolean = false, reconcileRecent: Boolean = false) {
        val account = email ?: return
        if (loading && !force) return
        val generation = ++refreshGeneration
        refreshJob?.cancel()
        loading = true
        refreshJob = viewModelScope.launch {
            try {
                withTimeout(30_000) {
                    requests.withLock {
                        if (orders.isEmpty()) {
                            cache.load(account)?.let { cached ->
                                if (cached.orders.isNotEmpty()) {
                                    orders = sortOrdersForDisplay(cached.orders)
                                    pendingNotificationIds.clear()
                                    pendingNotificationIds.addAll(cached.pendingNotificationIds)
                                    initialLoadComplete = true
                                }
                            }
                        }
                        val baselineComplete = initialLoadComplete
                        val knownIds = orders.mapTo(hashSetOf()) { it.id }
                        val cursor = latestOrderUpdatedAt(orders)
                        val fetched = if (cursor == null) {
                            val first = repository.orders()
                            if (!baselineComplete && first.isEmpty()) {
                                delay(750)
                                repository.orders()
                            } else first
                        } else {
                            repository.ordersChangedSince(cursor)
                        }
                        val recent = if (reconcileRecent && cursor != null) {
                            repository.recentOrders()
                        } else emptyList()
                        if (email != account || generation != refreshGeneration) return@withLock
                        val refreshed = fetched + recent
                        val discovered = if (baselineComplete) {
                            refreshed.filter { it.id !in knownIds }.distinctBy { it.id }
                        } else emptyList()
                        orders = mergeOrders(orders, refreshed)
                        initialLoadComplete = true
                        for (order in discovered) notifyOrQueue(order)
                        selectedId?.let { id ->
                            val updated = repository.order(id)
                            if (email == account && selectedId == id && updated != null) merge(updated)
                        }
                        flushPendingNotificationsLocked()
                        persistCache(account)
                    }
                }
                if (generation == refreshGeneration && email == account) lastRefreshSucceeded = true
            } catch (_: TimeoutCancellationException) {
                if (generation == refreshGeneration) {
                    lastRefreshSucceeded = false
                    message = "Соединение не ответило за 30 секунд. Нажмите «Обновить» для повторного подключения."
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) {
                if (generation == refreshGeneration) {
                    lastRefreshSucceeded = false
                    message = "Не удалось обновить заказы. Показаны сохранённые данные."
                }
            } finally {
                if (generation == refreshGeneration) {
                    loading = false
                    refreshJob = null
                }
            }
        }
    }


    // The badge and the reminder screen share a live server snapshot independent
    // of device-local OrdersCache. Refresh on resume, manual refresh and day rollover.
    fun ensurePickupReminderCount() {
        if (email == null || pickupLoading ||
            (pickupLoaded && pickupLoadedDay == pickupToday())) return
        loadPickupReminders()
    }

    // A single server RPC defines both the badge and both queues.
    // Detailed order data is only optional enrichment for contact actions.
    fun loadPickupReminders() {
        if (pickupLoading) return
        val account = email ?: return
        val generation = ++pickupGeneration
        pickupJob?.cancel()
        pickupLoading = true
        pickupLoaded = false
        pickupOrders = emptyList()
        pickupError = null
        pickupJob = viewModelScope.launch {
            try {
                val queue = withTimeout(20_000) { repository.pickupQueue() }
                if (email != account || generation != pickupGeneration) return@launch
                pickupQueue = queue
                pickupLoaded = true
                pickupLoadedDay = pickupToday()
                // No order enrichment failure may hide a server-authoritative entry.
                val details = try {
                    withTimeout(30_000) { repository.pickupCandidateOrders() }
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) {
                    pickupError = "Список получен. Контактные данные временно недоступны."
                    emptyList()
                }
                if (email == account && generation == pickupGeneration) pickupOrders = details
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) {
                if (email == account && generation == pickupGeneration) {
                    pickupLoaded = false
                    pickupQueue = emptyList()
                    pickupOrders = emptyList()
                    pickupError = "Серверный список недоступен. Проверить напоминания не удалось."
                }
            } finally {
                if (generation == pickupGeneration) {
                    pickupLoading = false
                    pickupJob = null
                }
            }
        }
    }

    fun savePickupDeadline(order: Order, deadline: String) {
        if (pickupBusy || email == null) return
        val ttn = order.deliveryValue("ttn").trim()
        if (ttn.isBlank()) { message = "У заказа нет ТТН."; return }
        pickupBusy = true
        viewModelScope.launch {
            var changed = false
            try {
                repository.setPickupDeadline(order.id, ttn, deadline)
                changed = true
                message = "Срок сохранён."
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { message = "Не удалось сохранить срок. Повторите позже." }
            finally {
                pickupBusy = false
                if (changed) loadPickupReminders()
            }
        }
    }

    fun confirmPickupSent(row: PickupQueueRow, stage: PickupReminderStage, channel: String) {
        if (pickupBusy || email == null) return
        if (pickupQueue.firstOrNull { it.orderId == row.orderId && it.ttn == row.ttn }?.activeStage() != stage ||
            row.deadline.isNullOrBlank()) {
            message = "Напоминание устарело. Обновите данные."
            return
        }
        pickupBusy = true
        viewModelScope.launch {
            var confirmed = false
            try {
                repository.confirmPickupReminder(row.orderId, row.ttn, row.deadline, stage, channel)
                confirmed = true
                // The server has accepted the confirmation. Never leave a due badge
                // while the follow-up fetch is pending or another device is offline.
                pickupQueue = pickupQueue.map {
                    if (it.orderId != row.orderId || it.ttn != row.ttn) it
                    else if (stage == PickupReminderStage.FIRST)
                        it.copy(firstSentAt = java.time.Instant.now().toString(), firstChannel = channel,
                            category = "informational", stage = null)
                    else it.copy(lastSentAt = java.time.Instant.now().toString(), lastChannel = channel,
                        category = "informational", stage = null)
                }
                message = "Отправка отмечена."
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) {
                message = "Не удалось подтвердить отправку. Проверьте статус."
            } finally {
                pickupBusy = false
                if (confirmed) loadPickupReminders()
            }
        }
    }

    fun confirmPickupManualSent(row: PickupQueueRow, channel: String) {
        if (pickupBusy || email == null) return
        if (pickupQueue.none { it.orderId == row.orderId && it.ttn == row.ttn && it.category == "informational" }) {
            message = "Данные изменились. Обновите список."
            return
        }
        pickupBusy = true
        viewModelScope.launch {
            var confirmed = false
            try {
                repository.confirmManualPickupReminder(row.orderId, row.ttn, channel)
                confirmed = true
                message = "Ручная отправка сохранена в общем журнале."
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) {
                message = "Не удалось записать ручную отправку на сервере."
            } finally {
                pickupBusy = false
                if (confirmed) loadPickupReminders()
            }
        }
    }

    fun open(id: String) {
        ordersBeforeDetail = orders
        selectedId = id
        detail = orders.find { it.id == id }
        viewModelScope.launch {
            try {
                val fresh = repository.order(id)
                if (fresh != null) {
                    requests.withLock {
                        if (selectedId == id) {
                            merge(fresh)
                            persistCache()
                        }
                    }
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { message = "Не удалось обновить детали. Показаны сохранённые данные." }
        }
    }

    fun closeDetail() {
        orders = ordersAfterClosingDetail(orders, ordersBeforeDetail)
        ordersBeforeDetail = emptyList()
        selectedId = null
        detail = null
    }
    fun dismissMessage() { message = null }

    fun login(email: String, password: String) {
        if (authBusy) return
        authBusy = true; message = null
        viewModelScope.launch {
            try { repository.signIn(email, password) }
            catch (cancel: CancellationException) { throw cancel }
            catch (_: IllegalArgumentException) { message = "Используйте личный аккаунт CRM." }
            catch (_: Exception) { message = "Не удалось войти. Проверьте email, пароль и соединение." }
            finally { authBusy = false }
        }
    }
    fun logout() {
        if (authBusy || acceptingId != null) return
        authBusy = true
        viewModelScope.launch {
            try {
                pushRegistrationJob?.cancelAndJoin()
                val app = getApplication<Application>()
                try { repository.setPushDevice(app.pushDeviceId(), null, false) }
                catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { /* Local logout still disables displaying incoming push. */ }
                repository.signOut()
                app.savePushSessionActive(false)
            }
            catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { message = "Не удалось выйти. Проверьте соединение и повторите." }
            finally { authBusy = false }
        }
    }
    fun accept(order: Order) {
        val route = acceptRoute(order, email) ?: return
        acceptingId = order.id
        viewModelScope.launch {
            try {
                val result = repository.accept(route, requireNotNull(order.externalId))
                message = acceptResultMessage(result)
            } catch (cancel: CancellationException) { throw cancel }
            catch (error: RestException) {
                message = if (error.statusCode == 409) "Статус заказа уже изменился. Данные обновлены."
                    else "Не удалось принять заказ. Проверьте статус и повторите."
            } catch (_: Exception) { message = "Не удалось получить подтверждение. Проверьте актуальный статус заказа." }
            finally {
                try {
                    requests.withLock {
                        repository.order(order.id)?.let { merge(it) }
                        persistCache()
                    }
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { message = "Не удалось обновить статус. Нажмите «Обновить» перед повтором." }
                acceptingId = null
            }
        }
    }
}
