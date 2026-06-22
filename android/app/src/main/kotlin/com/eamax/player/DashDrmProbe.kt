package com.eamax.player

import android.util.Log

/**
 * Fetches a DASH manifest and extracts Widevine / PlayReady license URLs when present.
 */
object DashDrmProbe {

    private const val TAG = "DashDrmProbe"
    private val WIDEVINE_UUID = "edef8ba9-79d6-4ace-a3c3-27dcd51d21"

    data class Result(
        val licenseUrl: String = "",
        val hasWidevine: Boolean = false,
        val hasPlayReady: Boolean = false,
    )

    fun probe(manifestUrl: String, headers: Map<String, String>): Result {
        if (!manifestUrl.startsWith("http", ignoreCase = true)) return Result()
        return try {
            val reqHeaders = HashMap(headers).apply {
                putIfAbsent("Accept", "application/dash+xml,application/xml,text/xml,*/*")
                putIfAbsent("User-Agent", PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT)
            }
            val client = EamaxHttpDataSource.fastProbeClient
            val b = okhttp3.Request.Builder().url(manifestUrl)
            reqHeaders.forEach { (k, v) -> b.header(k, v) }
            val body = client.newCall(b.get().build()).execute().use { r ->
                if (!r.isSuccessful) {
                    Log.w(TAG, "MPD probe HTTP ${r.code} for ${manifestUrl.take(80)}")
                    return Result()
                }
                r.body?.string().orEmpty()
            }
            if (body.isBlank() || body.contains("<html", ignoreCase = true)) return Result()

            val hasWidevine = body.contains(WIDEVINE_UUID, ignoreCase = true)
            val hasPlayReady = body.contains("9a04f079-9840-4286-ab92-e65be0885f95", ignoreCase = true)
            val licenseUrl = extractLicenseUrl(body)
            if (licenseUrl.isNotEmpty()) {
                Log.d(TAG, "MPD license URL found: ${licenseUrl.take(100)}")
            } else if (hasWidevine) {
                Log.d(TAG, "MPD has Widevine ContentProtection but no explicit LA URL")
            }
            Result(licenseUrl = licenseUrl, hasWidevine = hasWidevine, hasPlayReady = hasPlayReady)
        } catch (e: Exception) {
            Log.w(TAG, "MPD probe failed: ${e.message}")
            Result()
        }
    }

    private fun extractLicenseUrl(xml: String): String {
        val patterns = listOf(
            Regex("""(?i)(?:Lic_?url|LicenseUrl|licenseUrl)\s*=\s*["']([^"']+)["']"""),
            Regex("""(?i)<(?:ms:|dashif:)?laurl[^>]+(?:Lic_?url|LicenseUrl)\s*=\s*["']([^"']+)["']"""),
            Regex("""(?i)<(?:ms:|dashif:)?Laurl[^>]*>([^<]+)</(?:ms:|dashif:)?Laurl>"""),
            Regex("""(?i)<Laurl[^>]*>([^<]+)</Laurl>"""),
            Regex("""(?i)license[_-]?server[^>]*>([^<]+)</"""),
            Regex("""(?i)"licenseUrl"\s*:\s*"([^"]+)""""),
            Regex("""(?i)'licenseUrl'\s*:\s*'([^']+)'"""),
            Regex("""(?i)RightsManager[^"']*["'](https?://[^"']+)["']"""),
            Regex("""(?i)AcquireLicense[^"']*["'](https?://[^"']+)["']"""),
        )
        for (re in patterns) {
            val m = re.find(xml)
            val url = m?.groupValues?.getOrNull(1)?.trim().orEmpty()
            if (StreamUrlClassifier.isLikelyLicenseServerUrl(url)) return url
        }
        // Widevine block sometimes embeds the LA URL on the same ContentProtection element.
        val cpBlocks = Regex(
            """(?is)<ContentProtection[^>]*edef8ba9-79d6-4ace-a3c3-27dcd51d21[^>]*>.*?</ContentProtection>""",
        ).findAll(xml)
        for (block in cpBlocks) {
            val inner = block.value
            Regex("""https?://[^\s"'<>]+""").findAll(inner).forEach { m ->
                val url = m.value.trim()
                if (StreamUrlClassifier.isLikelyLicenseServerUrl(url)) {
                    return url
                }
            }
        }
        return ""
    }
}
