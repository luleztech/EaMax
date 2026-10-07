package com.eamax.player

import android.net.Uri

/** Mirrors Dart [playback_http_headers.dart] — CDNs often reject players without Referer/Origin. */
object PlaybackHttpHeaders {

    fun defaultsForUrl(rawUrl: String): Map<String, String> {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return emptyMap()
        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return emptyMap()
        if (uri.scheme.isNullOrBlank() || uri.host.isNullOrBlank()) return emptyMap()

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
        return merged
    }
}
