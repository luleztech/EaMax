package com.eamax

import android.content.Context
import com.eamax.player.AudioLanguageSupport

/** User-chosen playback audio language (persists across channels). */
internal object PlayerLanguagePreferences {
    private const val PREFS_NAME = "eamax_player_prefs"
    private const val KEY_AUDIO_LANGUAGE = "preferred_audio_language"

    fun get(context: Context): String? {
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_AUDIO_LANGUAGE, null)
            ?.trim()
        return if (raw.isNullOrEmpty()) null else AudioLanguageSupport.normalize(raw)
    }

    fun set(context: Context, language: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_AUDIO_LANGUAGE, AudioLanguageSupport.normalize(language))
            .apply()
    }
}
