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
    private val requests = Mutex()
    private var realtimeJob: Job? = null
    private var visible = false
    private var ordersBeforeDetail: List<Order> = emptyList()
    var email by mutableStateOf<String?>(null); private set
    var initializing by mutableStateOf(true); private set
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
                initializing = session is SessionStatus.Initializing
                val nextEmail = (session as? SessionStatus.Authenticated)?.session?.user?.email
                if (session is SessionStatus.Authenticated) {
                    if (email != nextEmail) {
                        clearOrders()
                        email = nextEmail
                        if (visible) { startRealtime(); refresh() }
                    }
                } else if (session is SessionStatus.NotAuthenticated) {
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
                            if (change.operation == "DELETE") {
                                orders = orders.filterNot { it.id == change.order_id }
                                if (selectedId == change.order_id) { detail = null; message = "Заказ удалён." }
                            } else {
                                val order = repository.order(change.order_id)
                                if (order != null) {
                                    merge(order)
                                    if (change.operation == "INSERT") notifyNewOrder(order)
                                }
                            }
                        }
                    }
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { realtimeConnected = false }
                delay(5_000)
            }
        }
    }

    private suspend fun notifyNewOrder(order: Order) {
        if (!isNewOrderNotificationCandidate(order)) return
        val app = getApplication<Application>()
        if (!app.newOrderNotifications().first() || !app.canPostOrderNotifications()) return
        app.showNewOrderNotification(order)
    }

    private fun clearOrders() {
        orders = emptyList(); ordersBeforeDetail = emptyList(); selectedId = null; detail = null
    }

    private fun merge(order: Order) {
        orders = sortOrdersForDisplay(orders.filterNot { it.id == order.id } + order)
        if (selectedId == order.id) detail = order
    }

    fun refresh() {
        if (email == null || loading) return
        val account = email
        loading = true
        viewModelScope.launch {
            try {
                requests.withLock {
                    val batch = repository.orders()
                    if (email != account) return@withLock
                    orders = sortOrdersForDisplay(ordersDuringDetailRefresh(orders, batch, selectedId != null))
                    selectedId?.let { id ->
                        val updated = repository.order(id)
                        if (email == account && selectedId == id) detail = updated
                    }
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { message = "Не удалось обновить заказы. Проверьте соединение и повторите." }
            finally { loading = false }
        }
    }

    fun open(id: String) {
        ordersBeforeDetail = orders
        selectedId = id; detail = orders.find { it.id == id }
        viewModelScope.launch {
            try {
                val fresh = repository.order(id)
                if (selectedId == id) detail = fresh
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { message = "Не удалось обновить детали. Показаны ранее загруженные данные." }
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
                    }
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { message = "Не удалось обновить статус. Нажмите «Обновить» перед повтором." }
                acceptingId = null
            }
        }
    }
}
