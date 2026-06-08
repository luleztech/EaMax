package com.eamax.player

import android.util.Base64
import android.util.Log
import com.eamax.domain.model.ClearKey
import com.eamax.domain.model.DrmType

/**
 * Extracts XOR-encrypted stream / DRM fields embedded in PHP gateway pages
 * (e.g. bailatv.live/spo2.php, nur.mpilalivetv.com/v1/player.php).
 *
 * Same decryption the in-page Shaka player performs — lets native ExoPlayer play
 * Widevine DASH without relying on WebView EME (broken on many Huawei devices).
 */
object PhpGatewayExtractor {

    private const val TAG = "PhpGatewayExtractor"

    data class Extracted(
        val streamUrl: String,
        val isHls: Boolean,
        val licenseUrl: String = "",
        val authToken: String = "",
        val clearKeys: List<ClearKey> = emptyList(),
    ) {
        fun resolvedKind(): StreamProbe.ResolvedKind =
            if (isHls) StreamProbe.ResolvedKind.EXO_HLS else StreamProbe.ResolvedKind.EXO_DASH

        fun drmType(): DrmType = when {
            licenseUrl.isNotEmpty() && authToken.isNotEmpty() -> DrmType.WIDEVINE
            clearKeys.isNotEmpty() -> DrmType.CLEARKEY
            else -> DrmType.NONE
        }
    }

    fun extractFromHtml(html: String): Extracted? {
        if (html.isBlank()) return null
        val blocked = html.trim().equals("blocked", ignoreCase = true) ||
            html.length < 200 && "blocked" in html.lowercase()
        if (blocked) {
            Log.w(TAG, "gateway HTML blocked/rejected")
            return null
        }

        val keyPart = matchQuoted(html, "keyPart") ?: return null
        val encryptedMpd = matchQuoted(html, "encryptedMpd") ?: return null

        val streamUrl = xorDecrypt(encryptedMpd, keyPart)?.trim().orEmpty()
        if (streamUrl.isEmpty() || !streamUrl.startsWith("http", ignoreCase = true)) {
            Log.w(TAG, "decrypted stream URL invalid")
            return null
        }

        val licenseUrl = matchQuoted(html, "encryptedLicense")
            ?.let { xorDecrypt(it, keyPart)?.trim().orEmpty() }
            .orEmpty()
        val authToken = matchQuoted(html, "encryptedToken")
            ?.let { xorDecrypt(it, keyPart)?.trim().orEmpty() }
            .orEmpty()

        val clearKeys = mutableListOf<ClearKey>()
        matchQuoted(html, "encryptedClearKey")?.let { enc ->
            val dec = xorDecrypt(enc, keyPart)?.trim().orEmpty() ?: return@let
            if (dec.contains(':')) {
                val parts = dec.split(':', limit = 2)
                val kid = parts.getOrElse(0) { "" }.trim()
                val k = parts.getOrElse(1) { "" }.trim()
                if (kid.isNotEmpty() && k.isNotEmpty()) {
                    clearKeys += ClearKey(kid = kid, k = k)
                }
            }
        }

        val isHls = streamUrl.contains(".m3u8", ignoreCase = true)
        Log.d(TAG, "extracted ${if (isHls) "HLS" else "DASH"} stream, widevine=${licenseUrl.isNotEmpty()}")
        return Extracted(
            streamUrl = streamUrl,
            isHls = isHls,
            licenseUrl = licenseUrl,
            authToken = authToken,
            clearKeys = clearKeys,
        )
    }

    fun xorDecrypt(encodedData: String, key: String): String? {
        if (encodedData.isEmpty() || key.isEmpty()) return null
        return try {
            val raw = Base64.decode(encodedData, Base64.DEFAULT)
            val out = CharArray(raw.size)
            for (i in raw.indices) {
                out[i] = (raw[i].toInt() xor key[i % key.length].code).toChar()
            }
            String(out)
        } catch (e: Exception) {
            Log.w(TAG, "xorDecrypt failed: ${e.message}")
            null
        }
    }

    private fun matchQuoted(html: String, varName: String): String? {
        val pattern = Regex("""${Regex.escape(varName)}\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
        return pattern.find(html)?.groupValues?.getOrNull(1)?.trim()?.takeIf { it.isNotEmpty() }
    }
}
