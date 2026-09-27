package ua.orders.crm

import android.content.Context
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private object ProductImages {
    private const val DISK_LIMIT = 100L * 1024 * 1024
    private const val DOWNLOAD_LIMIT = 4 * 1024 * 1024
    private val cache = object : LruCache<String, Bitmap>(12 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }
    private val locks = ConcurrentHashMap<String, Any>()

    fun cached(url: String?): Bitmap? = synchronized(cache) { url?.let(cache::get) }

    private fun file(context: Context, url: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
            .joinToString("") { "%02x".format(it) }
        return File(File(context.cacheDir, "product-images"), "$hash.png")
    }

    private fun diskCached(context: Context, url: String): Bitmap? {
        val image = file(context, url)
        if (!image.isFile) return null
        return BitmapFactory.decodeFile(image.path)?.also { image.setLastModified(System.currentTimeMillis()) }
            ?: run { image.delete(); null }
    }

    private fun save(context: Context, url: String, bitmap: Bitmap) {
        val target = file(context, url)
        target.parentFile?.mkdirs()
        val temporary = File(target.parentFile, "${target.name}.tmp")
        temporary.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val files = target.parentFile?.listFiles()?.sortedBy { it.lastModified() }.orEmpty()
        var total = files.sumOf { it.length() }
        for (image in files) {
            if (total + temporary.length() <= DISK_LIMIT) break
            val size = image.length()
            if (image.delete()) total -= size
        }
        if (!temporary.renameTo(target)) temporary.delete()
    }

    fun load(context: Context, url: String): Bitmap? {
        cached(url)?.let { return it }
        diskCached(context, url)?.also { synchronized(cache) { cache.put(url, it) }; return it }
        val lock = locks.computeIfAbsent(url) { Any() }
        synchronized(lock) {
            try {
                cached(url)?.let { return it }
                diskCached(context, url)?.also { synchronized(cache) { cache.put(url, it) }; return it }
                return download(url)?.also { bitmap ->
                    synchronized(cache) { cache.put(url, bitmap) }
                    runCatching { save(context, url, bitmap) }
                }
            } finally { locks.remove(url, lock) }
        }
    }

    private fun download(url: String): Bitmap? {
        val address = runCatching { URL(url) }.getOrNull() ?: return null
        if (address.protocol != "https") return null
        val connection = runCatching { address.openConnection() as? HttpURLConnection }.getOrNull() ?: return null
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        return try {
            connection.connect()
            if (connection.responseCode !in 200..299 ||
                !connection.contentType.orEmpty().startsWith("image/", ignoreCase = true) ||
                connection.contentLengthLong > DOWNLOAD_LIMIT
            ) return null
            val data = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val block = ByteArray(8192)
                while (true) {
                    val count = input.read(block)
                    if (count < 0) break
                    if (output.size() + count > DOWNLOAD_LIMIT) return null
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
            BitmapFactory.decodeByteArray(data, 0, data.size, options)
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}

@Composable
fun ProductThumbnail(imageUrl: String?, modifier: Modifier = Modifier, size: Dp = 76.dp) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val url = imageUrl?.trim().orEmpty()
    val bitmap = produceState<Bitmap?>(initialValue = ProductImages.cached(url), key1 = url) {
        if (url.isNotBlank()) value = withContext(Dispatchers.IO) { ProductImages.load(context, url) }
    }.value
    Box(
        modifier = modifier.size(size).clip(RoundedCornerShape(12.dp))
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
