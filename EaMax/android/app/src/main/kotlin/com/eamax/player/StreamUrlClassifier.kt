package com.eamax.player

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
}
