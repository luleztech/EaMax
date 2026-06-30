package com.eamax

import android.content.Context

/** User-chosen playback audio language (persists across channels). */
internal object PlayerLanguagePreferences {
    private const val PREFS_NAME = "eamax_player_prefs"
    private const val KEY_AUDIO_LANGUAGE = "preferred_audio_language"

    fun get(context: Context): String? {
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_AUDIO_LANGUAGE, null)
            ?.trim()
        return if (raw.isNullOrEmpty()) null else normalizeAudioLanguage(raw)
    }

    fun set(context: Context, language: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_AUDIO_LANGUAGE, normalizeAudioLanguage(language))
            .apply()
    }

    private fun normalizeAudioLanguage(raw: String): String {
        val v = raw.trim().lowercase()
        return if (v == "en" || v.startsWith("en-") || v == "eng") "en" else "sw"
    }
}
