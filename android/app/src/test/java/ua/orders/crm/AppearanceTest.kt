package ua.orders.crm

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearanceTest {
    @Test fun lightThemeUsesBlackForPrimaryAndSecondaryText() {
        val scheme = ordersColors(false)
        assertEquals(Color.Black, scheme.onSurface)
        assertEquals(Color.Black, scheme.onSurfaceVariant)
    }

    @Test fun darkThemeKeepsLightTextOnDarkBackground() {
        val scheme = ordersColors(true)
        assertTrue(scheme.onSurface.red > scheme.background.red)
        assertTrue(scheme.onSurfaceVariant.red > scheme.background.red)
    }

}
