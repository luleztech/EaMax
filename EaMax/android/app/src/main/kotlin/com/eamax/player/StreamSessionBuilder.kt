package com.eamax.player

import android.os.Bundle
import android.util.Base64
import com.eamax.domain.model.ClearKey
import com.eamax.domain.model.DrmData
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.PlayerMode
import com.eamax.domain.model.StreamSession
import org.json.JSONObject

/** Builds [StreamSession] from Flutter MethodChannel extras (aligned with RN / backend). */
object StreamSessionBuilder {

    fun fromFlutterBundle(b: Bundle): StreamSession {
        val url = b.getString("url")?.trim().orEmpty()
        val licenseUrl = b.getString("licenseUrl")?.trim().orEmpty()
        val token = b.getString("token")?.trim().orEmpty()
        val drmTypeStr = (b.getString("drmType") ?: "NONE").uppercase()
        val clearKeyHex = b.getString("clearKeyHex")?.trim().orEmpty()
        val headersJson = b.getString("headersJson")?.trim().orEmpty()

        val expiresAt = (System.currentTimeMillis() / 1000) + 86400 * 365L

        var drmType = when (drmTypeStr) {
            "CLEARKEY" -> DrmType.CLEARKEY
            "WIDEVINE" -> DrmType.WIDEVINE
            "WIDEVINE_L1" -> DrmType.WIDEVINE_L1
            "WIDEVINE_L3" -> DrmType.WIDEVINE_L3
            "PLAYREADY" -> DrmType.PLAYREADY
            else -> DrmType.NONE
        }

        val headers = parseHeaders(headersJson)

        // Widevine/PlayReady with no license URI causes native DRM failures (often crashes). Treat as clear.
        if (drmType != DrmType.NONE && drmType != DrmType.CLEARKEY && licenseUrl.isEmpty()) {
            drmType = DrmType.NONE
        }
        if (drmType == DrmType.CLEARKEY && parseClearKeysFromHex(clearKeyHex).isEmpty()) {
            drmType = DrmType.NONE
        }

        val drmData = when (drmType) {
            DrmType.CLEARKEY -> DrmData(keys = parseClearKeysFromHex(clearKeyHex), headers = null)
            else -> DrmData(headers = null)
        }

        return StreamSession(
            mpdUrl = url,
            licenseUrl = licenseUrl,
            token = token,
            expiresAt = expiresAt,
            playerMode = PlayerMode.EXO,
            drmType = drmType,
            drmData = drmData,
            trialRemaining = 999_999,
            channelIsPremium = false,
            headers = headers,
        )
    }

    private fun parseHeaders(json: String): Map<String, String> {
        if (json.isEmpty()) return emptyMap()
        return try {
            val o = JSONObject(json)
            buildMap {
                val it = o.keys()
                while (it.hasNext()) {
                    val k = it.next()
                    put(k, o.optString(k))
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun hexToBase64Url(hex: String): String {
        val clean = hex.replace(Regex("[^0-9a-fA-F]"), "")
        if (clean.length < 2 || clean.length % 2 != 0) return ""
        val bytes = ByteArray(clean.length / 2)
        var i = 0
        while (i < bytes.size) {
            bytes[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            i++
        }
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return b64.replace('+', '-').replace('/', '_').trimEnd('=')
    }

    private fun parseClearKeysFromHex(raw: String): List<ClearKey> {
        if (raw.isEmpty()) return emptyList()
        val str = raw.trim()
        var kid = ""
        var key = ""
        when {
            str.contains(":") -> {
                val p = str.split(":").map { it.trim() }
                kid = p.getOrElse(0) { "" }
                key = p.getOrElse(1) { kid }
            }
            str.contains(",") -> {
                val p = str.split(",").map { it.trim() }
                kid = p.getOrElse(0) { "" }
                key = p.getOrElse(1) { kid }
            }
            else -> {
                kid = str
                key = str
            }
        }
        if (kid.isEmpty() || key.isEmpty()) return emptyList()
        val hexPat = Regex("^[0-9a-fA-F]+$")
        val kidB64 = if (kid.length >= 32 && hexPat.matches(kid)) hexToBase64Url(kid) else kid
        val keyB64 = if (key.length >= 32 && hexPat.matches(key)) hexToBase64Url(key) else key
        return listOf(ClearKey(kid = kidB64, k = keyB64))
    }
}
