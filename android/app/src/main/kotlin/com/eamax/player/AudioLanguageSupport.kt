package com.eamax.player

/** Admin stream language: Swahili (default) or English. */
object AudioLanguageSupport {
    const val DEFAULT = "sw"

    fun normalize(raw: String?): String {
        val lang = raw?.trim()?.lowercase().orEmpty()
        return when {
            lang.isEmpty() || lang == "auto" || lang == "default" -> DEFAULT
            lang == "en" || lang == "eng" || lang.startsWith("en-") -> "en"
            lang == "sw" || lang == "swa" || lang.startsWith("sw-") -> DEFAULT
            else -> DEFAULT
        }
    }

    fun aliases(lang: String): List<String> = when (normalize(lang)) {
        "en" -> listOf("en", "eng", "en-us", "en-gb", "en-au")
        else -> listOf("sw", "swa", "sw-tz", "sw-ke")
    }

    fun acceptLanguageHeader(lang: String): String = when (normalize(lang)) {
        "en" -> "en-US,en;q=0.9,sw;q=0.8"
        else -> "sw-TZ,sw;q=0.9,en;q=0.8"
    }

    fun matchesTrackLanguage(trackLang: String?, target: String): Boolean {
        val t = trackLang?.trim()?.lowercase().orEmpty()
        if (t.isEmpty()) return false
        return aliases(target).any { alias ->
            t == alias || t.startsWith("$alias-")
        }
    }

    fun matchesTrackLabel(label: String?, target: String): Boolean {
        val t = label?.trim()?.lowercase().orEmpty()
        if (t.isEmpty()) return false
        return when (normalize(target)) {
            "en" -> t.contains("english") || t.contains(" eng") || t.startsWith("eng")
            else -> t.contains("swahili") || t.contains("kiswahili") || t.contains("swa")
        }
    }
}
