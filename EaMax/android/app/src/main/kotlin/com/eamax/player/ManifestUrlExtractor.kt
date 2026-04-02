package com.eamax.player

import java.net.URI

/**
 * Extracts first plausible DASH / HLS URL from HTML (gateway pages, IPTV portals).
 * Ported from EaMax StreamEngine.extractManifestUrlFromHtml.
 */
object ManifestUrlExtractor {

    private const val HTML_EXTRACT_MAX = 524288

    data class Extracted(val url: String, val kind: StreamKind)

    enum class StreamKind { HLS, DASH }

    fun extract(html: String, baseUrl: String): Extracted? {
        if (html.isBlank() || baseUrl.isBlank()) return null
        val slice = if (html.length > HTML_EXTRACT_MAX) html.substring(0, HTML_EXTRACT_MAX) else html
        val found = linkedSetOf<String>()

        Regex("""["'`](https?://[^"'`\s<>]+)["'`]""", RegexOption.IGNORE_CASE).findAll(slice).forEach { m ->
            pushUrl(m.groupValues[1], baseUrl, found)
        }
        Regex("""https?://[^\s"'<>()]+?\.(m3u8|mpd)(?:[?#][^\s"'<>()]*)?""", RegexOption.IGNORE_CASE)
            .findAll(slice).forEach { m -> pushUrl(m.value, baseUrl, found) }
        Regex(
            """(?:src|href|file|url|source|streamUrl|playlistUrl|manifestUrl|hlsUrl|dashUrl)\s*[:=]\s*["']([^"']+)["']""",
            RegexOption.IGNORE_CASE
        ).findAll(slice).forEach { m -> pushUrl(m.groupValues[1], baseUrl, found) }
        Regex("""["'](\/?[\w\-./%]+\.(?:m3u8|mpd)(?:\?[^"'<>\s]*)?)["']""", RegexOption.IGNORE_CASE)
            .findAll(slice).forEach { m -> pushUrl(m.groupValues[1], baseUrl, found) }

        for (u in found) {
            if (Regex("""\.m3u8(\?|$|#)""", RegexOption.IGNORE_CASE).containsMatchIn(u)) {
                return Extracted(u, StreamKind.HLS)
            }
        }
        for (u in found) {
            if (Regex("""\.mpd(\?|$|#)""", RegexOption.IGNORE_CASE).containsMatchIn(u)) {
                return Extracted(u, StreamKind.DASH)
            }
        }
        return null
    }

    private fun pushUrl(raw: String, baseUrl: String, out: MutableSet<String>) {
        var s = raw.trim()
        if (s.startsWith("'") || s.startsWith("`") || s.startsWith("\"")) {
            s = s.drop(1)
        }
        if (s.endsWith("'") || s.endsWith("\"")) {
            s = s.dropLast(1)
        }
        if (s.isEmpty() || s.startsWith("data:") || s.startsWith("javascript:")) return
        s = s.replace("\\u0026", "&").replace("&amp;", "&").replace("\\/", "/")
        try {
            val abs = when {
                s.startsWith("//") -> "https:$s"
                s.startsWith("http", ignoreCase = true) -> s
                else -> URI(baseUrl).resolve(s).toString()
            }
            out.add(abs)
        } catch (_: Exception) { }
    }
}
