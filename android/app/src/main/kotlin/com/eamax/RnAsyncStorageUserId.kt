package com.eamax

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.util.Log

/**
 * Reads userId saved by React Native AsyncStorage (SQLite RKStorage) so RN to Flutter
 * Play Store updates keep the same external id (premium / points).
 */
object RnAsyncStorageUserId {
    private const val TAG = "RnAsyncUserId"

    private val KEYS = arrayOf("userId", "@eamax:userId")

    fun readUserId(context: Context): String? {
        val candidate = readFromRkStorage(context) ?: readFromAsyncStorageDb(context)
        return candidate?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun readFromRkStorage(context: Context): String? {
        val dbFile = context.getDatabasePath("RKStorage")
        if (!dbFile.exists()) return null
        var db: SQLiteDatabase? = null
        return try {
            db = SQLiteDatabase.openDatabase(
                dbFile.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY,
            )
            readUserIdFromCatalystTable(db)
        } catch (e: Exception) {
            Log.w(TAG, "RKStorage: ${e.message}")
            null
        } finally {
            try {
                db?.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun readFromAsyncStorageDb(context: Context): String? {
        val candidates = listOf("AsyncStorage", "async_storage")
        for (name in candidates) {
            val dbFile = context.getDatabasePath(name)
            if (!dbFile.exists()) continue
            var db: SQLiteDatabase? = null
            try {
                db = SQLiteDatabase.openDatabase(
                    dbFile.absolutePath,
                    null,
                    SQLiteDatabase.OPEN_READONLY,
                )
                readUserIdFromCatalystTable(db)?.let { return it }
                readUserIdFromStorageTable(db)?.let { return it }
            } catch (e: Exception) {
                Log.d(TAG, "db $name: ${e.message}")
            } finally {
                try {
                    db?.close()
                } catch (_: Exception) {
                }
            }
        }
        return null
    }

    private fun readUserIdFromCatalystTable(db: SQLiteDatabase): String? {
        for (key in KEYS) {
            var c: Cursor? = null
            try {
                c = db.rawQuery(
                    "SELECT value FROM catalystLocalStorage WHERE key = ? LIMIT 1",
                    arrayOf(key),
                )
                if (c.moveToFirst()) {
                    val v = c.getString(0)
                    if (!v.isNullOrBlank()) return v
                }
            } catch (_: Exception) {
            } finally {
                try {
                    c?.close()
                } catch (_: Exception) {
                }
            }
        }
        return null
    }

    private fun readUserIdFromStorageTable(db: SQLiteDatabase): String? {
        for (key in KEYS) {
            var c: Cursor? = null
            try {
                c = db.rawQuery(
                    "SELECT value FROM storage WHERE key = ? LIMIT 1",
                    arrayOf(key),
                )
                if (c.moveToFirst()) {
                    val v = c.getString(0)
                    if (!v.isNullOrBlank()) return v
                }
            } catch (_: Exception) {
            } finally {
                try {
                    c?.close()
                } catch (_: Exception) {
                }
            }
        }
        return null
    }
}
