package com.eamax.player

/** Normalizes admin/playback audio language codes for ExoPlayer and WebView players. */
object AudioLanguageSupport {
    const val DEFAULT = "sw"

    fun normalize(raw: String?): String {
        val r = raw?.trim()?.lowercase().orEmpty()
        return when {
            r.isEmpty() -> DEFAULT
            r == "en" || r.startsWith("en-") || r == "english" || r == "eng" -> "en"
            r == "sw" || r.startsWith("sw-") || r == "swahili" || r == "kiswahili" || r == "swa" -> "sw"
            else -> DEFAULT
        }
    }

    fun matchesTrackLanguage(trackLang: String?, preferred: String): Boolean {
        val t = trackLang?.trim()?.lowercase().orEmpty()
        if (t.isEmpty()) return false
        return when (normalize(preferred)) {
            "en" -> t == "en" || t.startsWith("en-") || t == "eng"
            "sw" -> t == "sw" || t.startsWith("sw-") || t == "swa"
            else -> t == preferred || t.startsWith("$preferred-")
        }
    }

    fun matchesTrackLabel(label: String?, preferred: String): Boolean {
        val t = label?.trim()?.lowercase().orEmpty()
        if (t.isEmpty()) return false
        return when (normalize(preferred)) {
            "en" -> t.contains("english") || t.contains("eng")
            "sw" -> t.contains("swahili") || t.contains("kiswahili") || t.contains("swa")
            else -> false
        }
    }

    fun displayName(code: String): String = when (normalize(code)) {
        "en" -> "Kiingereza (English)"
        else -> "Kiswahili"
    }
}
