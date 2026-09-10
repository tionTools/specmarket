package ua.orders.crm

import android.content.Context
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class OrdersCacheSnapshot(
    val account: String,
    val orders: List<Order> = emptyList(),
    val pendingNotificationIds: Set<String> = emptySet(),
)

class OrdersCache(context: Context) {
    private val file = File(context.filesDir, "orders-cache.json")
    private val backup = File(context.filesDir, "orders-cache.backup.json")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun readSnapshot(source: File): OrdersCacheSnapshot? {
        if (!source.isFile) return null
        return runCatching {
            json.decodeFromString<OrdersCacheSnapshot>(source.readText(Charsets.UTF_8))
        }.getOrNull()
    }

    suspend fun load(account: String): OrdersCacheSnapshot? = withContext(Dispatchers.IO) {
        val matching = sequenceOf(file, backup)
            .mapNotNull(::readSnapshot)
            .filter { it.account.equals(account, ignoreCase = true) }
            .toList()
        matching.firstOrNull { it.orders.isNotEmpty() } ?: matching.firstOrNull()
    }

    suspend fun save(account: String, orders: List<Order>, pendingNotificationIds: Set<String>) =
        withContext(Dispatchers.IO) {
            file.parentFile?.mkdirs()
            if (readSnapshot(file) != null) {
                runCatching {
                    Files.copy(file.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING)
                }
            }
            val temporary = File(file.parentFile, "${file.name}.tmp")
            temporary.writeText(
                json.encodeToString(
                    OrdersCacheSnapshot(
                        account = account,
                        orders = orders,
                        pendingNotificationIds = pendingNotificationIds,
                    ),
                ),
                Charsets.UTF_8,
            )
            try {
                Files.move(
                    temporary.toPath(),
                    file.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
            if (!backup.isFile) {
                runCatching {
                    Files.copy(file.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING)
                }
            }
        }
}
