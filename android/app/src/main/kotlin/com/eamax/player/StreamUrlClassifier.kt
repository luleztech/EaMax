package com.eamax.player

/**
 * URL classification aligned with Flutter [stream_url_utils.dart].
 * Keeps native routing consistent with the Dart player.
 */
object StreamUrlClassifier {

    enum class Format { DASH, HLS, PROGRESSIVE, GATEWAY, UNKNOWN }

    private val obviousM3u8 = Regex("""\.m3u8?(\?|#|$)""", RegexOption.IGNORE_CASE)
    private val m3u8Query = Regex("""[?&](format|type)=m3u8?(\b|&|$)""", RegexOption.IGNORE_CASE)
    private val obviousMpd = Regex("""\.mpd(\?|#|$)""", RegexOption.IGNORE_CASE)
    private val obviousProgressive =
        Regex("""\.(mp4|m4v|webm|mkv|mov|ts)(\?|#|$)""", RegexOption.IGNORE_CASE)
    private val gatewayScript = Regex("""\.(php|asp|aspx|cgi|jsp|html?)(\?|#|/|$)""", RegexOption.IGNORE_CASE)
    private val iptvPortPath =
        Regex("""^https?://[^/]+:\d{2,5}/(live|stream|play|hls|iptv|channel|ch)/""", RegexOption.IGNORE_CASE)
    private val iptvPortTriple =
        Regex("""^https?://[^/]+:\d{2,5}/[^/]+/[^/]+/[^/?#]+$""", RegexOption.IGNORE_CASE)
    private val iptvHostPath =
        Regex("""^https?://[^/]+/(live|stream|play|hls|iptv|channel|ch)/[^/?#]+""", RegexOption.IGNORE_CASE)

    fun isLikelyIptvLiveUrl(url: String): Boolean {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return false
        if (hasObviousM3u8(trimmed) || hasObviousMpd(trimmed) || hasObviousProgressive(trimmed)) {
            return false
        }
        val base = trimmed.split('#').first()
        return iptvPortPath.containsMatchIn(base) ||
            iptvPortTriple.containsMatchIn(base) ||
            iptvHostPath.containsMatchIn(base)
    }

    fun isGatewayUrl(url: String): Boolean {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return false
        if (hasObviousM3u8(trimmed) || hasObviousMpd(trimmed) || hasObviousProgressive(trimmed)) {
            return false
        }
        if (isLikelyIptvLiveUrl(trimmed)) return false
        val u = trimmed.lowercase()
        if (gatewayScript.containsMatchIn(trimmed)) return true
        return u.contains("/embed/") ||
            u.contains("/gateway/") ||
            (u.contains("/stream/") && !hasObviousM3u8(trimmed) && !hasObviousMpd(trimmed)) ||
            (u.contains("/play/") && !hasObviousM3u8(trimmed) && !hasObviousMpd(trimmed)) ||
            u.contains("/player/")
    }

    fun shouldUseWebViewForUrl(url: String): Boolean = isGatewayUrl(url)

    /** Alias used across EaMax native player code. */
    fun needsWebPlayer(url: String): Boolean = shouldUseWebViewForUrl(url)

    fun detectFormat(url: String): Format {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return Format.UNKNOWN
        val u = trimmed.lowercase()
        if (hasObviousMpd(trimmed) ||
            (u.contains("dash") && !hasObviousM3u8(trimmed)) ||
            u.contains("/manifest") && !hasObviousM3u8(trimmed) ||
            u.contains("/relay/stream") ||
            u.contains("/api/relay/")
        ) {
            return Format.DASH
        }
        if (hasObviousM3u8(trimmed) || u.contains("hls") || u.contains("/relay/m3u8")) {
            return Format.HLS
        }
        if (hasObviousProgressive(trimmed)) return Format.PROGRESSIVE
        if (isLikelyIptvLiveUrl(trimmed)) return Format.HLS
        if (isGatewayUrl(trimmed)) return Format.GATEWAY
        if (u.startsWith("http")) {
            val base = trimmed.split('#').first()
            if (iptvPortPath.containsMatchIn(base) || iptvPortTriple.containsMatchIn(base)) {
                return Format.HLS
            }
        }
        return Format.UNKNOWN
    }

    private fun hasObviousM3u8(url: String): Boolean =
        obviousM3u8.containsMatchIn(url) || m3u8Query.containsMatchIn(url)

    private fun hasObviousMpd(url: String): Boolean = obviousMpd.containsMatchIn(url)

    private fun hasObviousProgressive(url: String): Boolean = obviousProgressive.containsMatchIn(url)
}
