package ua.orders.crm

import androidx.compose.material3.Typography
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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

    @Test fun lightBackgroundAndWhiteCardsStayUnchanged() {
        val colors = ordersColors(false)
        assertEquals(Color(0xFFEEF0F3), colors.background)
        assertEquals(Color.White, colors.surface)
    }

    @Test fun lightThemeBodyTextHasMediumWeightButSameMetrics() {
        val original = Typography()
        val updated = ordersTypography(false)
        val before = listOf(original.bodySmall, original.bodyMedium, original.bodyLarge)
        val after = listOf(updated.bodySmall, updated.bodyMedium, updated.bodyLarge)
        before.zip(after).forEach { (old, new) ->
            assertEquals(old.fontSize, new.fontSize)
            assertEquals(old.lineHeight, new.lineHeight)
            assertEquals(old.letterSpacing, new.letterSpacing)
            assertEquals(FontWeight.Medium, new.fontWeight)
        }
        assertEquals(original.titleMedium, updated.titleMedium)
        assertEquals(original.labelLarge, updated.labelLarge)
    }

    @Test fun darkTypographyStaysUnchanged() {
        assertEquals(Typography().bodySmall, ordersTypography(true).bodySmall)
        assertEquals(Typography().bodyMedium, ordersTypography(true).bodyMedium)
        assertEquals(Typography().bodyLarge, ordersTypography(true).bodyLarge)
    }
}
