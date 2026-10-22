package com.eamax.player

import android.net.Uri

/** Mirrors Dart [playback_http_headers.dart]. */
object PlaybackHttpHeaders {

    private val BROWSER_ONLY_HEADERS = setOf(
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "sec-fetch-user",
        "upgrade-insecure-requests",
        "sec-ch-ua",
        "sec-ch-ua-mobile",
        "sec-ch-ua-platform",
    )

    /**
     * Direct playlists and files. Page headers (Origin, Referer of the stream host,
     * Sec-Fetch-Dest: document) make these HTTP(S) servers return 403.
     * `.php` gateways and `tok_<jwt>` CDNs are not direct media.
     */
    fun isDirectMediaUrl(rawUrl: String): Boolean {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return false
        if (trimmed.contains(".php", ignoreCase = true)) return false
        if (CdnTokenHeaders.refererOriginForUrl(trimmed) != null) return false
        val path = runCatching { Uri.parse(trimmed).path }.getOrNull()?.lowercase() ?: return false
        return path.endsWith(".m3u8") ||
            path.endsWith(".m3u") ||
            path.endsWith(".mpd") ||
            path.endsWith(".mp4") ||
            path.endsWith(".m4v") ||
            path.endsWith(".ts") ||
            path.endsWith(".mkv") ||
            path.endsWith(".webm")
    }

    fun defaultsForUrl(rawUrl: String): Map<String, String> {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return emptyMap()
        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return emptyMap()
        if (uri.scheme.isNullOrBlank() || uri.host.isNullOrBlank()) return emptyMap()

        if (isDirectMediaUrl(trimmed)) {
            return linkedMapOf(
                "User-Agent" to OrizonStreamClient.USER_AGENT,
                "Accept" to "*/*",
                "Accept-Language" to "en-US,en;q=0.9,sw;q=0.8",
                "Connection" to "keep-alive",
            )
        }

        val port = when (uri.port) {
            -1, 80, 443 -> ""
            else -> ":${uri.port}"
        }
        val cdnOrigin = "${uri.scheme}://${uri.host}$port"
        val tokenPair = CdnTokenHeaders.refererOriginForUrl(trimmed)
        val referer = tokenPair?.first ?: "$cdnOrigin/"
        val origin = tokenPair?.second ?: cdnOrigin

        return linkedMapOf(
            "Referer" to referer,
            "Origin" to origin,
            "User-Agent" to OrizonStreamClient.USER_AGENT,
            "Connection" to "keep-alive",
            "Accept-Language" to "en-US,en;q=0.9,sw;q=0.8",
            "Accept" to
                "text/html,application/xhtml+xml,application/xml;q=0.9," +
                "application/dash+xml,application/vnd.apple.mpegurl;q=0.8,*/*;q=0.7",
        )
    }

    fun merge(sessionHeaders: Map<String, String>, streamUrl: String): LinkedHashMap<String, String> {
        val merged = LinkedHashMap<String, String>()
        merged.putAll(defaultsForUrl(streamUrl))
        merged.putAll(sessionHeaders)
        merged.putIfAbsent("User-Agent", OrizonStreamClient.USER_AGENT)
        merged.putIfAbsent("Accept", "*/*")
        merged.putIfAbsent("Connection", "keep-alive")
        if (isDirectMediaUrl(streamUrl)) {
            val drop = merged.keys.filter { it.lowercase() in BROWSER_ONLY_HEADERS }
            drop.forEach { merged.remove(it) }
            val host = runCatching { Uri.parse(streamUrl.trim()).host }.getOrNull()?.lowercase().orEmpty()
            if (host.isNotEmpty()) {
                val originKey = merged.keys.firstOrNull { it.equals("Origin", ignoreCase = true) }
                val refererKey = merged.keys.firstOrNull { it.equals("Referer", ignoreCase = true) }
                if (originKey != null && merged[originKey].orEmpty().lowercase().contains(host)) {
                    merged.remove(originKey)
                }
                if (refererKey != null && merged[refererKey].orEmpty().lowercase().contains(host)) {
                    merged.remove(refererKey)
                }
            }
            merged["Accept"] = "*/*"
        }
        return merged
    }
}
