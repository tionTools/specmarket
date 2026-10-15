package ua.orders.crm

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
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

    @Test fun compactTextStylesAreReadable() {
        val typography = ordersTypography()
        assertEquals(13.sp, typography.labelSmall.fontSize)
        assertEquals(13.sp, typography.labelMedium.fontSize)
        assertEquals(14.sp, typography.bodySmall.fontSize)
    }
}
