package ua.orders.crm

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private object ProductImages {
    private val cache = object : LruCache<String, Bitmap>(12 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    fun cached(url: String?): Bitmap? = synchronized(cache) { url?.let(cache::get) }

    fun load(url: String): Bitmap? {
        cached(url)?.let { return it }
        val address = runCatching { URL(url) }.getOrNull() ?: return null
        if (address.protocol != "https") return null
        val connection = (address.openConnection() as? HttpURLConnection) ?: return null
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        return try {
            connection.connect()
            if (connection.responseCode !in 200..299 ||
                !connection.contentType.orEmpty().startsWith("image/", ignoreCase = true) ||
                connection.contentLengthLong > 4 * 1024 * 1024
            ) return null
            val data = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val block = ByteArray(8192)
                while (true) {
                    val count = input.read(block)
                    if (count < 0) break
                    if (output.size() + count > 4 * 1024 * 1024) return null
                    output.write(block, 0, count)
                }
                output.toByteArray()
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
            val options = BitmapFactory.Options().apply {
                inSampleSize = generateSequence(1) { it * 2 }
                    .first { sample -> bounds.outWidth / sample <= 512 && bounds.outHeight / sample <= 512 }
            }
            BitmapFactory.decodeByteArray(data, 0, data.size, options)?.also {
                synchronized(cache) { cache.put(url, it) }
            }
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}

@Composable
fun ProductThumbnail(imageUrl: String?, modifier: Modifier = Modifier) {
    val url = imageUrl?.trim().orEmpty()
    val bitmap = produceState<Bitmap?>(initialValue = ProductImages.cached(url), key1 = url) {
        if (url.isNotBlank()) value = withContext(Dispatchers.IO) { ProductImages.load(url) }
    }.value
    Box(
        modifier = modifier.size(76.dp).clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Фото товара",
                modifier = Modifier.matchParentSize(),
                contentScale = ContentScale.Fit,
            )
        } else {
            Text("Нет фото", style = MaterialTheme.typography.labelSmall, fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
