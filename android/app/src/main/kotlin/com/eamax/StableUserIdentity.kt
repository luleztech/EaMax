package com.eamax

import android.content.Context
import android.util.Log
import java.io.File

/**
 * Persists the Flutter/external user id outside the Flutter SharedPreferences plugin so Play Store
 * updates never strand identity if plugin metadata migrates. Mirrors [lib/services/user_id_backup_io.dart].
 */
object StableUserIdentity {
    private const val TAG = "StableUserIdentity"
    private const val PREFS = "eamax_stable_identity_v1"
    private const val KEY_USER_ID = "external_user_id"
    private const val FILE_NAME = "eamax_user_identity.txt"

    fun read(context: Context): String? {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val fromPrefs = prefs.getString(KEY_USER_ID, null)?.trim()?.takeIf { it.isNotEmpty() }
        if (fromPrefs != null) return fromPrefs

        return try {
            val f = File(context.applicationContext.filesDir, FILE_NAME)
            if (!f.exists()) return null
            f.readText().trim().takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            Log.w(TAG, "read file: ${e.message}")
            null
        }
    }

    fun persist(context: Context, userId: String) {
        val id = userId.trim()
        if (id.isEmpty()) return
        try {
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_USER_ID, id)
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "prefs: ${e.message}")
        }
        try {
            val f = File(context.applicationContext.filesDir, FILE_NAME)
            f.writeText(id)
        } catch (e: Exception) {
            Log.w(TAG, "file: ${e.message}")
        }
    }
}
