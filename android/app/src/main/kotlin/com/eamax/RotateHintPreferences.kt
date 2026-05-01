package com.eamax

import android.content.Context

internal object RotateHintPreferences {
    private const val PREFS_NAME = "eamax_player_prefs"
    private const val KEY_NEVER_SHOW = "never_show_rotate_hint"

    fun neverShowHint(context: Context): Boolean =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_NEVER_SHOW, false)

    fun setNeverShowHint(context: Context, value: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_NEVER_SHOW, value)
            .apply()
    }
}
