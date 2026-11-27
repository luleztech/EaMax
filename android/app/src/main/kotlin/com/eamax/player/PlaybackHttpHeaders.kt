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
        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return false
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (scheme != "http" && scheme != "https") return false
        val path = uri.path?.lowercase().orEmpty()
        // .php gateways (incl. manifest.php) keep page-style headers.
        if (path.contains(".php")) return false
        if (CdnTokenHeaders.refererOriginForUrl(trimmed) != null) return false
        // Path extension, ?format=m3u8 style hints, tokenised paths (index.m3u8;jsessionid,
        // /index.m3u8/), upper-case / percent-encoded names and raw IPTV panel links
        // (http://ip:port/live/user/pass/1) are all direct media — never page headers.
        return StreamUrlClassifier.hasMediaSignature(trimmed)
    }

    fun defaultsForUrl(rawUrl: String): Map<String, String> {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return emptyMap()
        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return emptyMap()
        if (uri.scheme.isNullOrBlank() || uri.host.isNullOrBlank()) return emptyMap()

        if (isDirectMediaUrl(trimmed)) {
            val headers = linkedMapOf(
                "User-Agent" to PlayerRuntimeConfig.pageUserAgent.ifBlank { OrizonStreamClient.USER_AGENT },
                "Accept" to "*/*",
                "Accept-Language" to "en-US,en;q=0.9,sw;q=0.8",
                "Connection" to "keep-alive",
            )
            // Bare-IP IPTV panels often 403 without a matching Referer.
            val host = uri.host.orEmpty()
            if (host.matches(Regex("""^\d{1,3}(?:\.\d{1,3}){3}$"""))) {
                val port = when (uri.port) {
                    -1, 80, 443 -> ""
                    else -> ":${uri.port}"
                }
                val origin = "${uri.scheme}://$host$port"
                headers["Referer"] = "$origin/"
                headers["Origin"] = origin
            }
            return headers
        }

        val port = when (uri.port) {
            -1, 80, 443 -> ""
            else -> ":${uri.port}"
        }
        val cdnOrigin = "${uri.scheme}://${uri.host}$port"
        val tokenPair = CdnTokenHeaders.refererOriginForUrl(trimmed)
        val referer = tokenPair?.first ?: "$cdnOrigin/"
        val origin = tokenPair?.second ?: cdnOrigin

        val headers = linkedMapOf(
            "Referer" to referer,
            "Origin" to origin,
            "User-Agent" to PlayerRuntimeConfig.pageUserAgent.ifBlank { OrizonStreamClient.USER_AGENT },
            "Connection" to "keep-alive",
            "Accept-Language" to "en-US,en;q=0.9,sw;q=0.8",
            "Accept" to
                "text/html,application/xhtml+xml,application/xml;q=0.9," +
                "application/dash+xml,application/vnd.apple.mpegurl;q=0.8,*/*;q=0.7",
        )
        // Admin-managed package marker (Control Center → gateway policy).
        if (StreamUrlClassifier.shouldUseWebViewForUrl(trimmed) ||
            trimmed.contains(".php", ignoreCase = true)
        ) {
            headers["X-Requested-With"] = PlayerRuntimeConfig.packageMarker()
        }
        return headers
    }

    private fun isEmbedLike(url: String): Boolean =
        !isDirectMediaUrl(url) &&
            (url.contains(".php", ignoreCase = true) ||
                StreamUrlClassifier.shouldUseWebViewForUrl(url))

    /**
     * Defaults for [streamUrl] overlaid with [sessionHeaders] (API wins).
     * - Header names are de-duplicated case-insensitively (`referer` vs `Referer`), last one wins.
     * - Blank values are dropped.
     * - `X-Requested-With` is pinned to the Washa package on embed/gateway hosts and removed
     *   from direct media requests (CDNs 403 it); this app's own id is never sent.
     */
    fun merge(sessionHeaders: Map<String, String>, streamUrl: String): LinkedHashMap<String, String> {
        val byLower = LinkedHashMap<String, Pair<String, String>>()
        fun put(k: String, v: String) {
            val key = k.trim()
            val value = v.trim()
            if (key.isEmpty() || value.isEmpty()) return
            byLower[key.lowercase()] = key to value
        }
        defaultsForUrl(streamUrl).forEach { (k, v) -> put(k, v) }
        sessionHeaders.forEach { (k, v) -> put(k, v) }
        if (!byLower.containsKey("user-agent")) put("User-Agent", OrizonStreamClient.USER_AGENT)
        if (!byLower.containsKey("accept")) put("Accept", "*/*")
        if (!byLower.containsKey("connection")) put("Connection", "keep-alive")

        val direct = isDirectMediaUrl(streamUrl)
        when {
            direct -> byLower.remove("x-requested-with")
            isEmbedLike(streamUrl) -> put("X-Requested-With", PlayerRuntimeConfig.packageMarker())
            else -> byLower["x-requested-with"]?.let { (_, v) ->
                if (v.contains("eamax", ignoreCase = true)) put("X-Requested-With", PlayerRuntimeConfig.packageMarker())
            }
        }

        val merged = LinkedHashMap<String, String>()
        byLower.values.forEach { (k, v) -> merged[k] = v }
        if (direct) {
            val drop = merged.keys.filter { it.lowercase() in BROWSER_ONLY_HEADERS }
            drop.forEach { merged.remove(it) }
            val host = runCatching { Uri.parse(streamUrl.trim()).host }.getOrNull()?.lowercase().orEmpty()
            val isBareIp = host.matches(Regex("""^\d{1,3}(?:\.\d{1,3}){3}$"""))
            // Keep Referer/Origin for bare-IP IPTV (they 403 without it). Strip for named CDNs.
            if (host.isNotEmpty() && !isBareIp) {
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
