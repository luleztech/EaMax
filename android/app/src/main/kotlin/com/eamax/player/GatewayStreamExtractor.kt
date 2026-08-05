package com.eamax.player

import android.util.Base64

/** Decrypted stream payload from PHP / HTML gateway pages. */
data class GatewayExtracted(
    val streamUrl: String,
    val isHls: Boolean = false,
    val licenseUrl: String = "",
    val authToken: String = "",
    val clearKeyRaw: String = "",
)

object GatewayStreamExtractor {
    private val streamFields = listOf(
        "encryptedMpd", "encryptedStream", "encryptedUrl", "encryptedHls",
        "encryptedDash", "encryptedManifest",
    )
    private val licenseFields = listOf(
        "encryptedLicense", "encryptedLicence", "encryptedDrm", "encryptedWidevine",
        "encryptedLicenseUrl", "encryptedLic", "encryptedWV", "encryptedWidevineUrl",
        "licUrl", "license_url",
    )
    private val tokenFields = listOf("encryptedToken", "encryptedAuth", "encryptedAuthToken")
    private val keyFields = listOf("keyPart", "key", "xorKey", "decryptKey")
    private val clearKeyFields = listOf("encryptedClearKey", "encryptedClearKeys", "encryptedKeys")

    fun extract(html: String): GatewayExtracted? {
        if (html.isBlank()) return null
        val blocked = html.trim().lowercase() == "blocked" ||
            (html.length < 200 && html.lowercase().contains("blocked"))
        if (blocked) return null
        // Do NOT bail on "recaptcha" in the page — many PHP gateways embed Google
        // reCAPTCHA scripts alongside encryptedMpd/keyPart. Skipping extract forces
        // WebView and shows the captcha to users.

        parseFields(html, requireStream = true)?.let { return it.toExtracted() }
        extractInlineDrm(html)?.let { return it }
        return null
    }

    fun extractDrmFromHtml(html: String, fallbackStreamUrl: String = ""): GatewayExtracted? {
        parseFields(html, requireStream = false)?.let { fields ->
            if (fields.licenseUrl.isNotEmpty() || fields.authToken.isNotEmpty() || fields.clearKeyRaw.isNotEmpty()) {
                val stream = fields.streamUrl.ifBlank { fallbackStreamUrl }
                if (stream.isNotEmpty()) {
                    return GatewayExtracted(
                        streamUrl = stream,
                        isHls = stream.lowercase().contains(".m3u8"),
                        licenseUrl = fields.licenseUrl,
                        authToken = fields.authToken,
                        clearKeyRaw = fields.clearKeyRaw,
                    )
                }
            }
        }
        return extractInlineDrm(html, fallbackStreamUrl)
    }

    private data class ParsedFields(
        val streamUrl: String = "",
        val licenseUrl: String = "",
        val authToken: String = "",
        val clearKeyRaw: String = "",
    ) {
        fun toExtracted() = GatewayExtracted(
            streamUrl = streamUrl,
            isHls = streamUrl.lowercase().contains(".m3u8"),
            licenseUrl = licenseUrl,
            authToken = authToken,
            clearKeyRaw = clearKeyRaw,
        )
    }

    private fun parseFields(html: String, requireStream: Boolean): ParsedFields? {
        val keyPart = pickQuoted(html, keyFields) ?: return null
        if (keyPart.isEmpty()) return null

        var streamUrl = ""
        for (name in streamFields) {
            val enc = pickQuoted(html, listOf(name)) ?: continue
            if (enc.isEmpty()) continue
            streamUrl = xorDecrypt(enc, keyPart)
            if (streamUrl.isNotEmpty()) break
        }
        if (requireStream && (streamUrl.isEmpty() || !streamUrl.lowercase().startsWith("http"))) {
            return null
        }

        var licenseUrl = ""
        for (name in licenseFields) {
            val enc = pickQuoted(html, listOf(name)) ?: continue
            if (enc.isEmpty()) continue
            licenseUrl = xorDecrypt(enc, keyPart)
            if (licenseUrl.isNotEmpty()) break
        }

        var authToken = ""
        for (name in tokenFields) {
            val enc = pickQuoted(html, listOf(name)) ?: continue
            if (enc.isEmpty()) continue
            authToken = xorDecrypt(enc, keyPart)
            if (authToken.isNotEmpty()) break
        }

        var clearKeyRaw = ""
        for (name in clearKeyFields) {
            val enc = pickQuoted(html, listOf(name)) ?: continue
            if (enc.isEmpty()) continue
            clearKeyRaw = xorDecrypt(enc, keyPart)
            if (clearKeyRaw.isNotEmpty()) break
        }

        return ParsedFields(streamUrl, licenseUrl, authToken, clearKeyRaw)
    }

    private fun extractInlineDrm(html: String, fallbackStreamUrl: String = ""): GatewayExtracted? {
        val licenseUrl = extractInlineLicenseUrl(html)
        var authToken = ""
        for (name in tokenFields) {
            val v = pickQuoted(html, listOf(name)) ?: continue
            if (v.isNotEmpty() && !v.contains('=')) {
                authToken = v
                break
            }
        }
        if (licenseUrl.isEmpty() && authToken.isEmpty()) return null
        val stream = fallbackStreamUrl
        if (stream.isEmpty() && licenseUrl.isEmpty()) return null
        return GatewayExtracted(
            streamUrl = stream,
            isHls = stream.lowercase().contains(".m3u8"),
            licenseUrl = licenseUrl,
            authToken = authToken,
        )
    }

    private fun extractInlineLicenseUrl(html: String): String {
        val patterns = listOf(
            """['"]com\.widevine\.alpha['"]\s*:\s*['"](https?://[^'"]+)['"]""".toRegex(RegexOption.IGNORE_CASE),
            """['"]com\.widevine['"]\s*:\s*['"](https?://[^'"]+)['"]""".toRegex(RegexOption.IGNORE_CASE),
            """servers\s*:\s*\{[^}]*com\.widevine\.alpha['"]?\s*:\s*['"](https?://[^'"]+)['"]""".toRegex(RegexOption.IGNORE_CASE),
            """licenseServer(?:s|Url)?\s*[:=]\s*['"](https?://[^'"]+)['"]""".toRegex(RegexOption.IGNORE_CASE),
            """licenseUrl\s*:\s*['"](https?://[^'"]+)['"]""".toRegex(RegexOption.IGNORE_CASE),
            """Lic_?url\s*=\s*['"](https?://[^'"]+)['"]""".toRegex(RegexOption.IGNORE_CASE),
            """(https?://[^\s"'<>]*(?:license|widevine|RightsManager|AcquireLicense|/wv/|/drm/|/proxy/)[^\s"'<>]*)""".toRegex(RegexOption.IGNORE_CASE),
        )
        for (re in patterns) {
            val url = re.find(html)?.groupValues?.getOrNull(1)?.trim().orEmpty()
            if (url.lowercase().startsWith("http") &&
                !url.lowercase().contains(".js") &&
                !url.lowercase().contains(".css")
            ) {
                return url
            }
        }
        return ""
    }

    private fun pickQuoted(html: String, names: List<String>): String? {
        for (name in names) {
            val escaped = Regex.escape(name)
            val patterns = listOf(
                """$escaped[\s=:]+"([^"]+)"""".toRegex(RegexOption.IGNORE_CASE),
                """$escaped[\s=:]+'([^']+)'""".toRegex(RegexOption.IGNORE_CASE),
                """["']$escaped["']\s*:\s*"([^"]+)"""".toRegex(RegexOption.IGNORE_CASE),
                """["']$escaped["']\s*:\s*'([^']+)'""".toRegex(RegexOption.IGNORE_CASE),
                """$escaped\s*=\s*`([^`]+)`""".toRegex(RegexOption.IGNORE_CASE),
            )
            for (re in patterns) {
                val v = re.find(html)?.groupValues?.getOrNull(1)?.trim()
                if (!v.isNullOrEmpty()) return v
            }
        }
        return null
    }

    private fun xorDecrypt(enc: String, key: String): String {
        if (enc.isEmpty() || key.isEmpty()) return ""
        return try {
            val raw = Base64.decode(enc, Base64.DEFAULT)
            val out = ByteArray(raw.size) { i ->
                (raw[i].toInt() xor key[i % key.length].code).toByte()
            }
            String(out, Charsets.UTF_8).trim()
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * True only for hard bot walls (Cloudflare interstitial / human-check pages)
     * with no embedded stream payload. Soft "recaptcha" script tags on PHP gateways
     * must NOT match — those pages still contain encryptedMpd.
     */
    fun looksLikeHardBotChallenge(html: String): Boolean {
        val t = html.lowercase()
        val hasStreamPayload =
            t.contains("encryptedmpd") ||
                t.contains("encryptedstream") ||
                t.contains("encryptedurl") ||
                t.contains("encryptedhls") ||
                t.contains("encrypteddash") ||
                t.contains("encryptedmanifest") ||
                t.contains("keypart") ||
                t.contains("xorkey") ||
                t.contains("decryptkey")
        if (hasStreamPayload) return false
        return looksLikeForbiddenPage(html) ||
            t.contains("cf-challenge") ||
            t.contains("challenge-platform") ||
            t.contains("just a moment") ||
            t.contains("verify you are human") ||
            t.contains("verify you are not a robot") ||
            t.contains("not a robot") ||
            t.contains("attention required") ||
            t.contains("checking your browser") ||
            (t.contains("g-recaptcha") && t.contains("data-sitekey") && html.length < 12_000)
    }

    /** Gateway / WAF rejected the request (often after bot/reCAPTCHA scoring). */
    fun looksLikeForbiddenPage(html: String): Boolean {
        val t = html.lowercase()
        if (t.isBlank()) return false
        // Small error pages like the Cloudflare/IIS 403 shell we see from nur.mpilali…
        val compact = html.length < 8_000
        if (!compact) {
            // Still catch an obvious full-page 403 title.
            return t.contains("<title>") && t.contains("403") && t.contains("forbidden")
        }
        return (t.contains("403") && t.contains("forbidden")) ||
            t.contains("access to this resource on the server is denied") ||
            t.contains("access denied") && t.contains("403") ||
            (t.contains("<h1") && t.contains(">403<")) ||
            t.contains("error 403")
    }

    @Deprecated("Use looksLikeHardBotChallenge", ReplaceWith("looksLikeHardBotChallenge(html)"))
    fun looksLikeBotChallenge(html: String): Boolean = looksLikeHardBotChallenge(html)
}
