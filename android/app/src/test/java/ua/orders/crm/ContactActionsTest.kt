package ua.orders.crm

import org.junit.Assert.assertEquals
import org.junit.Test

class ContactActionsTest {
    @Test fun enabled_messengers_keep_call_in_the_middle() {
        assertEquals(
            listOf(ContactAction.VIBER, ContactAction.CALL, ContactAction.TELEGRAM),
            contactActions(messengersEnabled = true),
        )
    }

    @Test fun disabled_messengers_leave_only_the_phone_action() {
        assertEquals(listOf(ContactAction.CALL), contactActions(messengersEnabled = false))
    }
}
