package com.eamax.player

import android.net.Uri

/** Browser-like HTTP headers for gateway fetch + WebView loads (avoids bot / reCAPTCHA triggers). */
object PlaybackBrowserHeaders {
    const val CHROME_MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

    fun buildForUrl(
        rawUrl: String,
        extra: Map<String, String> = emptyMap(),
        audioLang: String = "sw",
    ): LinkedHashMap<String, String> {
        val h = LinkedHashMap<String, String>()
        h.putAll(extra)

        val trimmed = rawUrl.trim()
        val tokenHeaders = CdnTokenHeaders.refererOriginForUrl(trimmed)
        val parsed = runCatching { Uri.parse(trimmed) }.getOrNull()
        val scheme = parsed?.scheme?.takeIf { it.isNotBlank() } ?: "https"
        val host = parsed?.host?.takeIf { it.isNotBlank() } ?: ""
        val port = when (val p = parsed?.port ?: -1) {
            -1, 80, 443 -> ""
            else -> ":$p"
        }
        val origin = tokenHeaders?.second ?: if (host.isNotEmpty()) "$scheme://$host$port" else ""
        val referer = tokenHeaders?.first ?: if (origin.isNotEmpty()) {
            if (origin.endsWith("/")) origin else "$origin/"
        } else {
            ""
        }

        if (referer.isNotEmpty()) h.putIfAbsent("Referer", referer)
        if (origin.isNotEmpty()) h.putIfAbsent("Origin", origin)

        h.putIfAbsent(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,application/dash+xml,application/vnd.apple.mpegurl;q=0.8,*/*;q=0.7",
        )
        h.putIfAbsent(
            "Accept-Language",
            if (audioLang == "en") "en-US,en;q=0.9,sw;q=0.8" else "sw-TZ,sw;q=0.9,en;q=0.8",
        )
        h.putIfAbsent("Connection", "keep-alive")
        h.putIfAbsent("User-Agent", CHROME_MOBILE_UA)
        h.putIfAbsent("Sec-Fetch-Dest", "document")
        h.putIfAbsent("Sec-Fetch-Mode", "navigate")
        // same-origin when we already send Referer/Origin — "none" looks like a bot probe.
        h.putIfAbsent(
            "Sec-Fetch-Site",
            if (referer.isNotEmpty() || origin.isNotEmpty()) "same-origin" else "none",
        )
        h.putIfAbsent("Sec-Fetch-User", "?1")
        h.putIfAbsent("Upgrade-Insecure-Requests", "1")
        h.putIfAbsent(
            "sec-ch-ua",
            "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
        )
        h.putIfAbsent("sec-ch-ua-mobile", "?1")
        h.putIfAbsent("sec-ch-ua-platform", "\"Android\"")
        // PHP gateways (sp1.php, etc.) require the app package header.
        if (trimmed.contains(".php", ignoreCase = true)) {
            h.putIfAbsent("X-Requested-With", "com.eamax")
        }
        return h
    }
}
