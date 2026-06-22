package com.eamax.player

import android.net.Uri
import android.webkit.CookieManager

/** Headers gateways and Azam-style CDNs expect (Referer, Origin, Cookie from WebView). */
object GatewayHttpHeaders {

    fun forGateway(gatewayUrl: String, sessionHeaders: Map<String, String> = emptyMap()): Map<String, String> {
        val h = LinkedHashMap<String, String>()
        sessionHeaders.forEach { (k, v) -> if (v.isNotBlank()) h[k] = v }
        h.putIfAbsent("User-Agent", PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT)
        val gateway = stripFragment(gatewayUrl.trim())
        if (gateway.startsWith("http", ignoreCase = true)) {
            if (!h.keys.any { it.equals("Referer", ignoreCase = true) }) {
                h["Referer"] = gateway
            }
            if (!h.keys.any { it.equals("Origin", ignoreCase = true) }) {
                originFromUrl(gateway)?.let { h["Origin"] = it }
            }
            mergeCookies(h, gateway)
        }
        return h
    }

    /** Merge gateway Referer/Origin/Cookie onto manifest/CDN requests. */
    fun forManifest(
        manifestUrl: String,
        gatewayUrl: String,
        sessionHeaders: Map<String, String> = emptyMap(),
    ): Map<String, String> {
        val h = LinkedHashMap(forGateway(gatewayUrl, sessionHeaders))
        if (!h.containsKey("Accept")) {
            h["Accept"] = "application/dash+xml,application/vnd.apple.mpegurl,*/*"
        }
        if (manifestUrl.startsWith("http", ignoreCase = true)) {
            mergeCookies(h, manifestUrl)
        }
        return h
    }

    fun mergeCookies(headers: MutableMap<String, String>, url: String) {
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {
        }
        val cookie = CookieManager.getInstance().getCookie(url)?.trim().orEmpty()
        if (cookie.isEmpty()) return
        val existing = headers["Cookie"]?.trim().orEmpty()
        headers["Cookie"] = if (existing.isEmpty()) cookie else "$existing; $cookie"
    }

    fun originFromUrl(url: String): String? {
        return try {
            val u = Uri.parse(url)
            if (u.scheme == null || u.host == null) return null
            val portPart = when {
                u.port <= 0 || u.port == 80 || u.port == 443 -> ""
                else -> ":${u.port}"
            }
            "${u.scheme}://${u.host}$portPart"
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Headers for Widevine license POST (Nagra/Azam expect CDN Origin/Referer + octet-stream body).
     */
    fun forLicense(
        licenseUrl: String,
        gatewayUrl: String,
        manifestUrl: String,
        capturedHeaders: Map<String, String> = emptyMap(),
        drmHeaders: Map<String, String> = emptyMap(),
    ): Map<String, String> {
        val h = LinkedHashMap<String, String>()
        drmHeaders.forEach { (k, v) -> if (v.isNotBlank()) h[k] = v }
        capturedHeaders.forEach { (k, v) -> if (v.isNotBlank()) h[k] = v }

        h.putIfAbsent("User-Agent", PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT)
        h.putIfAbsent("Accept", "*/*")
        h.putIfAbsent("Content-Type", "application/octet-stream")

        val nagraOrAzam = licenseUrl.contains("nagra", ignoreCase = true) ||
            manifestUrl.contains("azamtvltd", ignoreCase = true) ||
            manifestUrl.contains("cdntoken=", ignoreCase = true)

        if (nagraOrAzam && manifestUrl.startsWith("http", ignoreCase = true)) {
            val manifestOrigin = originFromUrl(manifestUrl)
            if (manifestOrigin != null) {
                h.putIfAbsent("Origin", manifestOrigin)
            }
            // Nagra validates Referer against the tokenized manifest URL, not gateway page.
            h.putIfAbsent("Referer", manifestUrl)
        } else if (gatewayUrl.startsWith("http", ignoreCase = true)) {
            h.putIfAbsent("Referer", stripFragment(gatewayUrl.trim()))
            originFromUrl(gatewayUrl)?.let { h.putIfAbsent("Origin", it) }
        }

        if (licenseUrl.startsWith("http", ignoreCase = true)) {
            mergeCookies(h, licenseUrl)
        }
        if (manifestUrl.startsWith("http", ignoreCase = true)) {
            mergeCookies(h, manifestUrl)
        }
        if (gatewayUrl.startsWith("http", ignoreCase = true)) {
            mergeCookies(h, gatewayUrl)
        }
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {
        }
        return h
    }

    private fun stripFragment(url: String): String {
        val i = url.indexOf('#')
        return if (i >= 0) url.substring(0, i) else url
    }
}
