package ua.orders.crm

fun mergeOrders(current: List<Order>, changed: List<Order>): List<Order> {
    if (changed.isEmpty()) return current
    val merged = LinkedHashMap<String, Order>(current.size + changed.size)
    current.forEach { merged[it.id] = it }
    changed.forEach { merged[it.id] = it }
    return sortOrdersForDisplay(merged.values.toList())
}

fun latestOrderUpdatedAt(orders: List<Order>): String? =
    orders.mapNotNull { it.updatedAt?.trim()?.takeIf(String::isNotEmpty) }.maxOrNull()

fun shouldNotifyNewOrder(order: Order): Boolean = isNewOrderVisual(order)

fun normalizeCustomerPhone(phone: String?): String? {
    val raw = phone.orEmpty().trim()
    if (raw.isEmpty()) return null
    val digits = raw.filter(Char::isDigit)
    if (digits.length < 7) return null
    return when {
        raw.startsWith("+") -> "+$digits"
        digits.startsWith("380") -> "+$digits"
        digits.length == 10 && digits.startsWith("0") -> "+38$digits"
        else -> "+$digits"
    }
}
