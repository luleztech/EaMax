package com.eamax.player

/**
 * URL classification aligned with Flutter [stream_url_utils.dart].
 * Keeps native routing consistent with the Dart player.
 */
object StreamUrlClassifier {

    enum class Format { DASH, HLS, PROGRESSIVE, GATEWAY, UNKNOWN }

    // Extensions are matched on the PATH only (never inside a query value, so a gateway
    // like embed.php?url=…a.m3u8 is not mistaken for media). `;jsessionid` and a trailing
    // slash are tolerated, as are upper-case / percent-encoded paths.
    private val HLS_EXT = setOf("m3u8", "m3u", "m3u8x")
    private val DASH_EXT = setOf("mpd")
    private val PROGRESSIVE_EXT = setOf(
        "mp4", "m4v", "m4s", "m4a", "mov", "webm", "mkv", "ts", "m2ts", "mts", "3gp", "flv", "avi",
        "mp3", "aac", "ogg", "oga", "ogv", "opus", "flac", "wav",
    )
    private val hlsQuery = Regex(
        """(^|[?&])(format|type|output|ext|fmt|container|mode)=(m3u8?|hls|applehls)(\b|&|$)""",
        RegexOption.IGNORE_CASE,
    )
    private val dashQuery = Regex(
        """(^|[?&])(format|type|output|ext|fmt|container|mode)=(mpd|dash)(\b|&|$)""",
        RegexOption.IGNORE_CASE,
    )
    private val progressiveQuery = Regex(
        """(^|[?&])(format|type|output|ext|fmt|container)=(mp4|ts|mkv|webm|mpegts)(\b|&|$)""",
        RegexOption.IGNORE_CASE,
    )
    private val manifestPhp = Regex("""/manifest\.php(\?|#|$)""", RegexOption.IGNORE_CASE)
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
        // mpilali manifest.php serves DASH XML — treat as media, not gateway.
        if (manifestPhp.containsMatchIn(trimmed)) return false
        if (isLikelyIptvLiveUrl(trimmed)) return false
        val u = trimmed.lowercase()
        // Hosted EaMax Shaka page (player.php?e=…) — always WebView, never Exo.
        if (u.contains("/api/playback/embed/player")) return true
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
            manifestPhp.containsMatchIn(trimmed) ||
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

    private fun decodePath(raw: String): String =
        try {
            java.net.URLDecoder.decode(raw.replace("+", "%2B"), "UTF-8")
        } catch (_: Exception) {
            raw
        }

    /** File extension of the URL path (`.m3u8` → "m3u8"), tolerant of `;params` and `/`. */
    fun pathExtension(url: String): String {
        val noFragment = url.trim().substringBefore('#')
        val path = decodePath(noFragment.substringBefore('?'))
            .substringBefore(';')
            .trimEnd('/')
            .lowercase()
        // Skip "http://host" authority so a bare host like example.com is not an extension.
        val afterScheme = path.substringAfter("://", path)
        val slash = afterScheme.indexOf('/')
        if (slash < 0) return ""
        val name = afterScheme.substring(slash + 1).substringAfterLast('/')
        val dot = name.lastIndexOf('.')
        if (dot < 0 || dot == name.length - 1) return ""
        return name.substring(dot + 1)
    }

    /** Strong format from the path extension only (safe to lock the media source on). */
    fun pathFormat(url: String): Format? {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return null
        val ext = pathExtension(trimmed)
        return when {
            ext in HLS_EXT -> Format.HLS
            ext in DASH_EXT -> Format.DASH
            ext in PROGRESSIVE_EXT -> Format.PROGRESSIVE
            manifestPhp.containsMatchIn(trimmed) -> Format.DASH
            else -> null
        }
    }

    /** Path extension first, then explicit `?format=m3u8` style hints. */
    fun strongFormat(url: String): Format? {
        pathFormat(url)?.let { return it }
        val query = url.trim().substringBefore('#').substringAfter('?', "")
        if (query.isEmpty()) return null
        return when {
            hlsQuery.containsMatchIn(query) -> Format.HLS
            dashQuery.containsMatchIn(query) -> Format.DASH
            progressiveQuery.containsMatchIn(query) -> Format.PROGRESSIVE
            else -> null
        }
    }

    /** True when the URL is clearly a media playlist/file (not a gateway page). */
    fun hasMediaSignature(url: String): Boolean =
        strongFormat(url) != null || isLikelyIptvLiveUrl(url)

    private fun hasObviousM3u8(url: String): Boolean = strongFormat(url) == Format.HLS

    private fun hasObviousMpd(url: String): Boolean = strongFormat(url) == Format.DASH

    private fun hasObviousProgressive(url: String): Boolean = strongFormat(url) == Format.PROGRESSIVE
}
