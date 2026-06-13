package com.eamax.player

import android.util.Base64
import android.util.Log
import com.eamax.domain.model.ClearKey
import com.eamax.domain.model.DrmType

/**
 * Extracts XOR-encrypted stream / DRM fields embedded in PHP gateway pages
 * (e.g. bailatv.live/spo2.php, nur.mpilalivetv.com/v1/player.php).
 */
object PhpGatewayExtractor {

    private const val TAG = "PhpGatewayExtractor"

    private val STREAM_FIELD_NAMES = listOf(
        "encryptedMpd", "encryptedStream", "encryptedUrl",
        "encryptedHls", "encryptedDash", "encryptedManifest",
    )
    private val LICENSE_FIELD_NAMES = listOf(
        "encryptedLicense", "encryptedLicence", "encryptedDrm",
        "encryptedWidevine", "encryptedLicenseUrl",
    )
    private val TOKEN_FIELD_NAMES = listOf(
        "encryptedToken", "encryptedAuth", "encryptedAuthToken",
    )
    private val KEY_FIELD_NAMES = listOf("keyPart", "key", "xorKey", "decryptKey")
    private val CLEARKEY_FIELD_NAMES = listOf(
        "encryptedClearKey", "encryptedClearKeys", "encryptedKeys",
    )

    data class Extracted(
        val streamUrl: String,
        val isHls: Boolean,
        val licenseUrl: String = "",
        val authToken: String = "",
        val clearKeys: List<ClearKey> = emptyList(),
        val licenseHeaders: Map<String, String> = emptyMap(),
    ) {
        fun resolvedKind(): StreamProbe.ResolvedKind =
            if (isHls) StreamProbe.ResolvedKind.EXO_HLS else StreamProbe.ResolvedKind.EXO_DASH

        fun drmType(): DrmType = when {
            licenseUrl.isNotEmpty() -> DrmType.WIDEVINE_L3
            clearKeys.isNotEmpty() -> DrmType.CLEARKEY
            else -> DrmType.NONE
        }
    }

    fun extractFromHtml(html: String): Extracted? {
        val fields = parseFields(html) ?: return null
        return buildExtracted(fields)
    }

    /** License + token when stream URL is already known (e.g. from network intercept). */
    fun extractDrmFromHtml(html: String): Extracted? {
        val fields = parseFields(html, requireStream = false) ?: extractInlineDrmFields(html)
        if (fields == null) return null
        if (fields.licenseUrl.isEmpty() && fields.authToken.isEmpty() && fields.clearKeys.isEmpty()) {
            return null
        }
        val stream = fields.streamUrl
        return Extracted(
            streamUrl = stream,
            isHls = stream.contains(".m3u8", ignoreCase = true),
            licenseUrl = fields.licenseUrl,
            authToken = fields.authToken,
            clearKeys = fields.clearKeys,
        )
    }

    fun extractFromHtml(html: String, fallbackStreamUrl: String): Extracted? {
        extractFromHtml(html)?.let { return it }
        if (fallbackStreamUrl.isBlank()) return null
        return extractDrmFromHtml(html)?.copy(
            streamUrl = fallbackStreamUrl,
            isHls = fallbackStreamUrl.contains(".m3u8", ignoreCase = true),
        )
    }

    private data class ParsedFields(
        val streamUrl: String = "",
        val licenseUrl: String = "",
        val authToken: String = "",
        val clearKeys: List<ClearKey> = emptyList(),
    )

    private fun parseFields(html: String, requireStream: Boolean = true): ParsedFields? {
        if (html.isBlank()) return null
        val blocked = html.trim().equals("blocked", ignoreCase = true) ||
            html.length < 200 && "blocked" in html.lowercase()
        if (blocked) {
            Log.w(TAG, "gateway HTML blocked/rejected")
            return null
        }

        val keyPart = KEY_FIELD_NAMES.firstNotNullOfOrNull { matchQuoted(html, it) } ?: return null

        val encStream = STREAM_FIELD_NAMES.firstNotNullOfOrNull { matchQuoted(html, it) }
        val streamUrl = encStream?.let { xorDecrypt(it, keyPart)?.trim().orEmpty() }.orEmpty()
        if (requireStream && (streamUrl.isEmpty() || !streamUrl.startsWith("http", ignoreCase = true))) {
            return null
        }

        val licenseUrl = LICENSE_FIELD_NAMES.firstNotNullOfOrNull { matchQuoted(html, it) }
            ?.let { xorDecrypt(it, keyPart)?.trim().orEmpty() }
            .orEmpty()
        val authToken = TOKEN_FIELD_NAMES.firstNotNullOfOrNull { matchQuoted(html, it) }
            ?.let { xorDecrypt(it, keyPart)?.trim().orEmpty() }
            .orEmpty()

        val clearKeys = mutableListOf<ClearKey>()
        CLEARKEY_FIELD_NAMES.forEach { name ->
            matchQuoted(html, name)?.let { enc ->
                val dec = xorDecrypt(enc, keyPart)?.trim().orEmpty()
                if (dec.contains(':')) {
                    val parts = dec.split(':', limit = 2)
                    val kid = parts.getOrElse(0) { "" }.trim()
                    val k = parts.getOrElse(1) { "" }.trim()
                    if (kid.isNotEmpty() && k.isNotEmpty()) {
                        clearKeys += ClearKey(kid = kid, k = k)
                    }
                }
            }
        }

        return ParsedFields(streamUrl, licenseUrl, authToken, clearKeys)
    }

    /** Shaka/Widevine config embedded in page scripts (no XOR fields). */
    private fun extractInlineDrmFields(html: String): ParsedFields? {
        if (html.isBlank()) return null
        val licenseUrl = extractInlineLicenseUrl(html)
        val authToken = TOKEN_FIELD_NAMES.firstNotNullOfOrNull { matchQuoted(html, it) }
            ?.let { it.trim() }
            .orEmpty()
        if (licenseUrl.isEmpty() && authToken.isEmpty()) return null
        Log.d(TAG, "inline DRM config widevine=${licenseUrl.isNotEmpty()}")
        return ParsedFields(licenseUrl = licenseUrl, authToken = authToken)
    }

    private fun extractInlineLicenseUrl(html: String): String {
        val patterns = listOf(
            Regex("""['"]com\.widevine\.alpha['"]\s*:\s*['"](https?://[^'"]+)['"]""", RegexOption.IGNORE_CASE),
            Regex("""['"]com\.widevine['"]\s*:\s*['"](https?://[^'"]+)['"]""", RegexOption.IGNORE_CASE),
            Regex("""licenseUrl\s*:\s*['"](https?://[^'"]+)['"]""", RegexOption.IGNORE_CASE),
            Regex("""Lic_?url\s*=\s*['"](https?://[^'"]+)['"]""", RegexOption.IGNORE_CASE),
            Regex("""(https?://[^\s"'<>]*(?:license|widevine|RightsManager|AcquireLicense|/wv/|/drm/)[^\s"'<>]*)""", RegexOption.IGNORE_CASE),
        )
        for (re in patterns) {
            val url = re.find(html)?.groupValues?.getOrNull(1)?.trim().orEmpty()
            if (url.startsWith("http", ignoreCase = true) &&
                !url.contains(".js", ignoreCase = true) &&
                !url.contains(".css", ignoreCase = true)
            ) {
                return url
            }
        }
        return ""
    }

    private fun buildExtracted(fields: ParsedFields): Extracted {
        val isHls = fields.streamUrl.contains(".m3u8", ignoreCase = true)
        Log.d(
            TAG,
            "extracted ${if (isHls) "HLS" else "DASH"} stream, widevine=${fields.licenseUrl.isNotEmpty()}",
        )
        return Extracted(
            streamUrl = fields.streamUrl,
            isHls = isHls,
            licenseUrl = fields.licenseUrl,
            authToken = fields.authToken,
            clearKeys = fields.clearKeys,
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
        val escaped = Regex.escape(varName)
        val patterns = listOf(
            Regex("""$escaped[\s=:]+"([^"]+)"""", RegexOption.IGNORE_CASE),
            Regex("""$escaped[\s=:]+'([^']+)'""", RegexOption.IGNORE_CASE),
            Regex("""["']$escaped["']\s*:\s*"([^"]+)"""", RegexOption.IGNORE_CASE),
            Regex("""["']$escaped["']\s*:\s*'([^']+)'""", RegexOption.IGNORE_CASE),
            Regex("""${escaped}\s*=\s*`([^`]+)`""", RegexOption.IGNORE_CASE),
        )
        for (re in patterns) {
            val v = re.find(html)?.groupValues?.getOrNull(1)?.trim().orEmpty()
            if (v.isNotEmpty()) return v
        }
        return null
    }
}
