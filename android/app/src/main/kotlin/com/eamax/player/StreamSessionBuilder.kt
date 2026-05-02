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
            "CLEARKEY", "CLEAR_KEY" -> DrmType.CLEARKEY
            "WIDEVINE" -> DrmType.WIDEVINE
            "WIDEVINE_L1" -> DrmType.WIDEVINE_L1
            "WIDEVINE_L3" -> DrmType.WIDEVINE_L3
            "PLAYREADY" -> DrmType.PLAYREADY
            else -> DrmType.NONE
        }

        val headers = parseHeaders(headersJson)

        // Backend sometimes ships keys without drmType — infer ClearKey when keys exist for manifests.
        if (drmType == DrmType.NONE && clearKeyHex.isNotEmpty()) {
            val ul = url.lowercase()
            if (ul.contains(".mpd") || ul.contains(".m3u8") || ul.contains(".m3u")) {
                drmType = DrmType.CLEARKEY
            }
        }

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

        // Accept full JSON payloads:
        // {"keys":[{"kid":"...","k":"..."}]} or [{"kid":"...","k":"..."}]
        if (str.startsWith("{") || str.startsWith("[")) {
            parseJsonClearKeys(str)?.let { if (it.isNotEmpty()) return it }
        }

        // Accept key pairs separated by ';' or '|':
        // kid:key;kid2:key2
        if (str.contains(";") || str.contains("|")) {
            val out = str
                .split(';', '|')
                .mapNotNull { parseSingleClearKey(it) }
            if (out.isNotEmpty()) return out
        }

        // Backward-compatible single key formats:
        // kid:key OR kid,key OR plain key
        return parseSingleClearKey(str)?.let { listOf(it) } ?: emptyList()
    }

    private fun parseJsonClearKeys(json: String): List<ClearKey>? {
        return try {
            val out = mutableListOf<ClearKey>()
            if (json.trim().startsWith("{")) {
                val obj = JSONObject(json)
                val keys = obj.optJSONArray("keys")
                if (keys != null) {
                    for (i in 0 until keys.length()) {
                        val item = keys.optJSONObject(i) ?: continue
                        val parsed = buildClearKey(
                            item.optString("kid", ""),
                            item.optString("k", "")
                        )
                        if (parsed != null) out += parsed
                    }
                } else {
                    buildClearKey(obj.optString("kid", ""), obj.optString("k", ""))?.let { out += it }
                }
            } else {
                val arr = org.json.JSONArray(json)
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    val parsed = buildClearKey(
                        item.optString("kid", ""),
                        item.optString("k", "")
                    )
                    if (parsed != null) out += parsed
                }
            }
            out
        } catch (_: Exception) {
            null
        }
    }

    private fun parseSingleClearKey(raw: String): ClearKey? {
        val str = raw.trim()
        if (str.isEmpty()) return null
        val (kid, key) = when {
            str.contains(":") -> {
                val p = str.split(":", limit = 2).map { it.trim() }
                p.getOrElse(0) { "" } to p.getOrElse(1) { "" }
            }
            str.contains(",") -> {
                val p = str.split(",", limit = 2).map { it.trim() }
                p.getOrElse(0) { "" } to p.getOrElse(1) { "" }
            }
            else -> str to str
        }
        return buildClearKey(kid, key)
    }

    private fun buildClearKey(rawKid: String, rawKey: String): ClearKey? {
        val kid = rawKid.trim()
        val key = rawKey.trim()
        if (kid.isEmpty() || key.isEmpty()) return null
        val hexPat = Regex("^[0-9a-fA-F]+$")
        val kidB64 = normalizeClearKeyKid(kid, hexPat) ?: return null
        val keyB64 = normalizeClearKeyKey(key, hexPat) ?: return null
        return ClearKey(kid = kidB64, k = keyB64)
    }

    private fun normalizeClearKeyKid(raw: String, hexPat: Regex): String? {
        val cleaned = raw.trim().trim('"').trim('\'')
        val compactUuid = cleaned.replace("-", "")
        val rawBytes = when {
            compactUuid.length == 32 && hexPat.matches(compactUuid) -> hexToBytes(compactUuid)
            else -> decodeAnyBase64OrNull(cleaned)
        } ?: return null
        return toBase64Url(rawBytes)
    }

    private fun normalizeClearKeyKey(raw: String, hexPat: Regex): String? {
        val cleaned = raw.trim().trim('"').trim('\'')
        val rawBytes = if (cleaned.length >= 32 && hexPat.matches(cleaned)) {
            hexToBytes(cleaned)
        } else {
            decodeAnyBase64OrNull(cleaned)
        } ?: return null
        return toBase64Url(rawBytes)
    }

    private fun hexToBytes(hex: String): ByteArray? {
        val clean = hex.replace(Regex("[^0-9a-fA-F]"), "")
        if (clean.length < 2 || clean.length % 2 != 0) return null
        val bytes = ByteArray(clean.length / 2)
        var i = 0
        while (i < bytes.size) {
            bytes[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            i++
        }
        return bytes
    }

    private fun toBase64Url(bytes: ByteArray): String {
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return b64.replace('+', '-').replace('/', '_').trimEnd('=')
    }

    private fun decodeAnyBase64OrNull(value: String): ByteArray? {
        decodeBase64UrlOrNull(value)?.let { return it }
        val paddedStd = when (value.length % 4) {
            2 -> "$value=="
            3 -> "$value="
            0 -> value
            else -> return null
        }
        return try {
            Base64.decode(paddedStd, Base64.DEFAULT)
        } catch (_: Exception) {
            null
        }
    }

    private fun decodeBase64UrlOrNull(base64Url: String): ByteArray? {
        val normalized = base64Url
            .replace('-', '+')
            .replace('_', '/')
        val padded = when (normalized.length % 4) {
            2 -> "$normalized=="
            3 -> "$normalized="
            0 -> normalized
            else -> return null
        }
        return try {
            Base64.decode(padded, Base64.DEFAULT)
        } catch (_: Exception) {
            null
        }
    }
}
