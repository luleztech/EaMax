package com.eamax.player

import android.net.Uri

/**
 * URL classification aligned with EaMax React Native [phpStreamSupport] + [StreamEngine].
 * Gateway pages (.php, /embed/, etc.) often return HTML with buried .m3u8 / .mpd links.
 */
object StreamUrlClassifier {

    fun isPhpLikeUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return Regex("""\.php(\?|$|#)""", RegexOption.IGNORE_CASE).containsMatchIn(url)
    }

    /** PHP, ASP, player gateways, embed paths — probe/sniff instead of assuming DASH. */
    fun isLikelyGatewayUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        return Regex("""\.(php|asp|aspx|cgi|jsp)(\?|$|#)""", RegexOption.IGNORE_CASE).containsMatchIn(url) ||
            "/embed/" in u || "/gateway/" in u || "/stream/" in u ||
            "/play/" in u || "/player/" in u
    }

    fun hasObviousM3u8(url: String): Boolean =
        Regex("""\.m3u8(\?|#|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url)

    fun hasObviousMpd(url: String): Boolean =
        Regex("""\.mpd(\?|#|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url)

    fun hasObviousProgressiveExtension(url: String): Boolean {
        val u = url.lowercase()
        return listOf(".mp4", ".m4v", ".webm", ".mkv", ".mov", ".ts").any { u.contains(it) }
    }

    fun isRelayStyleUrl(url: String): Boolean {
        val u = url.lowercase()
        return "/relay/stream" in u || "/relay/m3u8" in u || "/api/relay/" in u
    }

    /**
     * Signed redirect fronts (e.g. `*.ycn-redirect.com/live/.../index.m3u8`) often answer **403 /
     * "blocked"** to library User-Agents. Use browser-like UA + Referer/Origin — same idea as
     * [PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT] for gateway probes in [StreamProbe].
     */
    fun isYcnRedirectHost(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val host = Uri.parse(url.trim()).host?.lowercase().orEmpty()
            host == "ycn-redirect.com" || host.endsWith(".ycn-redirect.com")
        } catch (_: Exception) {
            false
        }
    }
}
