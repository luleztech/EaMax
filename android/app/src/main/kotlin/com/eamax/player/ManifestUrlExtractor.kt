package com.eamax.player

data class ManifestExtracted(val url: String, val isHls: Boolean)

object ManifestUrlExtractor {
    private const val HTML_EXTRACT_MAX = 524_288

    fun extract(html: String, baseUrl: String): ManifestExtracted? {
        if (html.isBlank() || baseUrl.isBlank()) return null
        val slice = if (html.length > HTML_EXTRACT_MAX) html.substring(0, HTML_EXTRACT_MAX) else html
        val found = linkedSetOf<String>()

        """["'`](https?://[^"'`\s<>]+)["'`]""".toRegex(RegexOption.IGNORE_CASE)
            .findAll(slice).forEach { pushUrl(it.groupValues[1], baseUrl, found) }
        """https?://[^\s"'<>()]+?\.(m3u8|mpd)(?:[?#][^\s"'<>()]*)?""".toRegex(RegexOption.IGNORE_CASE)
            .findAll(slice).forEach { pushUrl(it.value, baseUrl, found) }
        """(?:src|href|file|url|source|streamUrl|playlistUrl|manifestUrl|hlsUrl|dashUrl)\s*[:=]\s*["']([^"']+)["']""".toRegex(RegexOption.IGNORE_CASE)
            .findAll(slice).forEach { pushUrl(it.groupValues[1], baseUrl, found) }
        """["'](\/?[\w\-./%]+\.(?:m3u8|mpd)(?:\?[^"'<>\s]*)?)["']""".toRegex(RegexOption.IGNORE_CASE)
            .findAll(slice).forEach { pushUrl(it.groupValues[1], baseUrl, found) }

        for (u in found) {
            if (""".\.m3u8(\?|$|#)""".toRegex(RegexOption.IGNORE_CASE).containsMatchIn(u)) {
                return ManifestExtracted(u, isHls = true)
            }
        }
        for (u in found) {
            if (""".\.mpd(\?|$|#)""".toRegex(RegexOption.IGNORE_CASE).containsMatchIn(u)) {
                return ManifestExtracted(u, isHls = false)
            }
        }
        return null
    }

    private fun pushUrl(raw: String, baseUrl: String, out: MutableSet<String>) {
        var s = raw.trim()
        if (s.startsWith("'") || s.startsWith('`') || s.startsWith('"')) s = s.substring(1)
        if (s.endsWith("'") || s.endsWith('"')) s = s.substring(0, s.length - 1)
        if (s.isEmpty() || s.startsWith("data:") || s.startsWith("javascript:")) return
        s = s.replace("""\u0026""", "&").replace("&amp;", "&").replace("""\/""", "/")
        try {
            val abs = when {
                s.startsWith("//") -> "https:$s"
                s.lowercase().startsWith("http") -> s
                else -> java.net.URI(baseUrl).resolve(s).toString()
            }
            out.add(abs)
        } catch (_: Exception) {
        }
    }
}
