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
    var selectedId by mutableStateOf<String?>(null); private set
    var detail by mutableStateOf<Order?>(null); private set
    var acceptingId by mutableStateOf<String?>(null); private set

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
                        realtimeJob?.cancel()
                        realtimeJob = null
                        realtimeConnected = false
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
                        if (visible) { startRealtime(); refresh() }
                    } else {
                        initializing = false
                    }
                } else if (session is SessionStatus.NotAuthenticated) {
                    initializing = false
                    email = null
                    realtimeJob?.cancel()
                    realtimeJob = null
                    realtimeConnected = false
                    clearOrders()
                }
            }
        }
    }

    fun foreground(active: Boolean) {
        visible = active
        if (email != null) startRealtime()
        if (active && email != null) refresh()
    }

    private fun startRealtime() {
        if (realtimeJob?.isActive == true) return
        realtimeJob = viewModelScope.launch {
            while (isActive && email != null) {
                try {
                    repository.watch(onConnection = { connected ->
                        val reconnect = connected && !realtimeConnected
                        realtimeConnected = connected
                        if (reconnect && visible) refresh()
                    }) { change ->
                        requests.withLock {
                            val account = email ?: return@withLock
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
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { realtimeConnected = false }
                delay(5_000)
            }
        }
    }

    private suspend fun notifyOrQueue(order: Order) {
        if (!isNewOrderNotificationCandidate(order)) {
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
            if (order == null || !isNewOrderNotificationCandidate(order)) {
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
        }
    }

    fun notificationsSettingChanged(enabled: Boolean) {
        viewModelScope.launch {
            requests.withLock {
                if (!enabled) pendingNotificationIds.clear() else flushPendingNotificationsLocked()
                persistCache()
            }
        }
    }

    private fun clearOrders() {
        orders = emptyList()
        ordersBeforeDetail = emptyList()
        selectedId = null
        detail = null
        pendingNotificationIds.clear()
        initialLoadComplete = false
    }

    private fun merge(order: Order) {
        orders = mergeOrders(orders, listOf(order))
        if (selectedId == order.id) detail = order
    }

    private suspend fun persistCache(account: String? = email) {
        val currentAccount = account ?: return
        cache.save(currentAccount, orders, pendingNotificationIds)
    }

    fun refresh() {
        if (email == null || loading) return
        val account = email
        loading = true
        viewModelScope.launch {
            try {
                requests.withLock {
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
                    if (email != account) return@withLock
                    val discovered = if (baselineComplete) fetched.filter { it.id !in knownIds } else emptyList()
                    orders = mergeOrders(orders, fetched)
                    initialLoadComplete = true
                    for (order in discovered) notifyOrQueue(order)
                    selectedId?.let { id ->
                        val updated = repository.order(id)
                        if (email == account && selectedId == id && updated != null) merge(updated)
                    }
                    flushPendingNotificationsLocked()
                    persistCache(account)
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { message = "Не удалось обновить заказы. Показаны сохранённые данные." }
            finally { loading = false }
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
            try { repository.signOut() }
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
                message = when {
                    !result.ok -> result.message ?: "Заказ не принят. Обновите данные и проверьте статус."
                    result.alreadyAccepted.isNotEmpty() -> "Заказ уже принят."
                    else -> "Заказ принят."
                }
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
