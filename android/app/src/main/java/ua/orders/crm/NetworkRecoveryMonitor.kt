package ua.orders.crm

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/** Triggers recovery after Android's default network regains verified Internet access. */
class NetworkRecoveryMonitor(context: Context, private val onRestored: () -> Unit) : AutoCloseable {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    @Volatile private var closed = false
    @Volatile private var validated = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            val nowValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            val recovered = nowValidated && !validated
            validated = nowValidated
            if (recovered && !closed) onRestored()
        }

        override fun onLost(network: Network) {
            validated = false
        }
    }

    init {
        connectivity.registerDefaultNetworkCallback(callback)
    }

    override fun close() {
        closed = true
        connectivity.unregisterNetworkCallback(callback)
    }
}
