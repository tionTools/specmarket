package ua.orders.crm

// The messenger preference is local to each Android installation.
internal enum class ContactAction { VIBER, CALL, TELEGRAM }

internal fun contactActions(messengersEnabled: Boolean): List<ContactAction> =
    if (messengersEnabled) listOf(ContactAction.VIBER, ContactAction.CALL, ContactAction.TELEGRAM)
    else listOf(ContactAction.CALL)
