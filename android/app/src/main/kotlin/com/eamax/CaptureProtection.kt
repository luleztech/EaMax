package com.eamax

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import java.security.KeyStore

/**
 * Detects traffic-capture / HTTPS-interception tooling that could expose stream URLs,
 * tokens and API payloads (HttpCanary, Reqable, PCAPdroid, ...).
 *
 * Three independent signals are used so that renaming/cloning one app does not bypass it:
 *  1. A known capture app is installed and enabled.
 *  2. A system-wide HTTP proxy is configured (Charles / mitmproxy / Burp style).
 *  3. A user-installed CA certificate exists (required to decrypt HTTPS).
 */
internal object CaptureProtection {
    const val ID_SYSTEM_PROXY = "system:proxy"
    const val ID_USER_CA = "system:user_ca"

    private val capturePackages = listOf(
        "com.reqable.android",
        "com.guoshi.httpcanary",
        "com.guoshi.httpcanary.premium",
        "com.guoshi.httpcanary.premium.pro",
        "com.emanuelef.remote_capture", // PCAPdroid
        "app.greyshirts.sslcapture", // Packet Capture
        "tech.httptoolkit.android.v1",
        "com.network.proxy", // ProxyPin
        "com.minhui.networkcapture", // Packet Capture / Network Capture
        "com.minhui.networkcapture.pro",
        "jp.co.taosoftware.android.packetcapture",
    )

    data class DetectedApp(val packageName: String, val label: String)

    /** Everything that should block the app. Name kept for the Flutter bridge contract. */
    fun findEnabledCaptureApps(context: Context): List<DetectedApp> {
        val found = ArrayList<DetectedApp>()
        found += findInstalledCaptureApps(context)
        if (isSystemProxyActive(context)) {
            found += DetectedApp(ID_SYSTEM_PROXY, "Proxy ya mfumo (HTTP proxy) imewashwa")
        }
        if (hasUserInstalledCertificates()) {
            found += DetectedApp(ID_USER_CA, "Cheti cha usalama (CA) kilichowekwa na mtumiaji")
        }
        return found
    }

    private fun findInstalledCaptureApps(context: Context): List<DetectedApp> =
        capturePackages.mapNotNull { packageName ->
            try {
                val info = context.packageManager.getApplicationInfo(packageName, 0)
                if (!info.enabled) return@mapNotNull null
                DetectedApp(
                    packageName = packageName,
                    label = context.packageManager.getApplicationLabel(info).toString(),
                )
            } catch (_: PackageManager.NameNotFoundException) {
                null
            } catch (_: RuntimeException) {
                null
            }
        }

    private fun isSystemProxyActive(context: Context): Boolean {
        try {
            val host = System.getProperty("http.proxyHost")
            if (!host.isNullOrBlank()) return true
            val httpsHost = System.getProperty("https.proxyHost")
            if (!httpsHost.isNullOrBlank()) return true
        } catch (_: RuntimeException) {
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                val proxy = cm?.defaultProxy
                if (proxy != null && !proxy.host.isNullOrBlank()) return true
            } catch (_: RuntimeException) {
            }
        }
        return false
    }

    private const val CA_CACHE_TTL_MS = 60_000L

    @Volatile private var caCheckedAtMs = 0L
    @Volatile private var caCachedResult = false

    /**
     * Enumerating AndroidCAStore loads every trusted certificate (slow on low-end devices), so it
     * must never run repeatedly on the main thread: the result is cached and can be pre-warmed
     * from a background thread via [warmUp].
     */
    private fun hasUserInstalledCertificates(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
        val now = android.os.SystemClock.elapsedRealtime()
        if (caCheckedAtMs != 0L && now - caCheckedAtMs < CA_CACHE_TTL_MS) return caCachedResult
        val result = try {
            val store = KeyStore.getInstance("AndroidCAStore")
            store.load(null)
            java.util.Collections.list(store.aliases()).any { it.startsWith("user:") }
        } catch (_: Exception) {
            false
        }
        caCachedResult = result
        caCheckedAtMs = android.os.SystemClock.elapsedRealtime()
        return result
    }

    /** Call from a background thread so later main-thread checks hit the cache. */
    fun warmUp() {
        hasUserInstalledCertificates()
    }
}

/** Keep signed stream paths and query tokens out of Logcat. */
internal fun safeUrlForLogs(rawUrl: String?): String {
    if (rawUrl.isNullOrBlank()) return "<empty>"
    val uri = runCatching { Uri.parse(rawUrl) }.getOrNull() ?: return "<url>"
    val scheme = uri.scheme ?: return "<url>"
    val host = uri.host ?: return "<url>"
    return "$scheme://$host"
}
