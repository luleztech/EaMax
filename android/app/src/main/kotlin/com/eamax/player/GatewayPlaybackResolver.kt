package com.eamax.player

import android.util.Log
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.StreamSession
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fetches gateway HTML with browser headers and extracts direct manifest URLs so ExoPlayer
 * can play without loading bot-protected WebView pages (reCAPTCHA / Cloudflare).
 */
object GatewayPlaybackResolver {
    private const val TAG = "GatewayResolver"
    private const val MAX_READ_BYTES = 512 * 1024

    data class Resolved(
        val streamUrl: String,
        val licenseUrl: String = "",
        val authToken: String = "",
        val clearKeyRaw: String = "",
        val isHls: Boolean = false,
        val headers: Map<String, String> = emptyMap(),
        val drmType: DrmType? = null,
    )

    fun resolve(session: StreamSession): Resolved? {
        val gatewayUrl = session.mpdUrl.trim()
        if (!StreamUrlClassifier.needsWebPlayer(gatewayUrl)) return null

        val audioLang = session.preferredAudioLanguage.ifBlank { "sw" }
        val reqHeaders = PlaybackBrowserHeaders.buildForUrl(gatewayUrl, session.headers, audioLang)
        if (session.token.isNotBlank() && !reqHeaders.keys.any { it.equals("Authorization", ignoreCase = true) }) {
            reqHeaders["Authorization"] = "Bearer ${session.token}"
        }

        val html = fetchHtml(gatewayUrl, reqHeaders) ?: return null

        // Prefer decrypting embedded stream even when the page mentions reCAPTCHA.
        val encrypted = GatewayStreamExtractor.extract(html)
            ?: GatewayStreamExtractor.extractDrmFromHtml(html)
        if (encrypted != null && encrypted.streamUrl.lowercase().startsWith("http")) {
            return buildResolved(gatewayUrl, session, encrypted, reqHeaders)
        }

        val manifest = ManifestUrlExtractor.extract(html, gatewayUrl)
        if (manifest != null) {
            return Resolved(
                streamUrl = manifest.url,
                isHls = manifest.isHls,
                headers = reqHeaders,
                licenseUrl = session.licenseUrl,
                authToken = session.token,
            )
        }

        if (GatewayStreamExtractor.looksLikeHardBotChallenge(html)) {
            Log.w(TAG, "Gateway HTML is a hard bot challenge with no stream payload")
            return null
        }

        return null
    }

    private fun buildResolved(
        gatewayUrl: String,
        session: StreamSession,
        extracted: GatewayExtracted,
        reqHeaders: Map<String, String>,
    ): Resolved {
        val merged = LinkedHashMap(reqHeaders)
        if (extracted.authToken.isNotEmpty() &&
            !merged.keys.any { it.equals("Authorization", ignoreCase = true) }
        ) {
            merged["Authorization"] = "Bearer ${extracted.authToken}"
        }
        val license = extracted.licenseUrl.ifBlank { session.licenseUrl }
        val clearKey = extracted.clearKeyRaw
        var drm: DrmType? = null
        if (session.drmType != DrmType.NONE) {
            drm = session.drmType
        } else if (license.isNotBlank()) {
            drm = if (license.lowercase().contains("playready")) DrmType.PLAYREADY else DrmType.WIDEVINE_L3
        } else if (clearKey.isNotBlank()) {
            drm = DrmType.CLEARKEY
        }
        Log.i(TAG, "Extracted direct stream from gateway (${gatewayUrl.take(48)}…)")
        return Resolved(
            streamUrl = extracted.streamUrl,
            licenseUrl = license,
            authToken = extracted.authToken.ifBlank { session.token },
            clearKeyRaw = clearKey,
            isHls = extracted.isHls,
            headers = merged,
            drmType = drm,
        )
    }

    private fun fetchHtml(url: String, headers: Map<String, String>): String? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 12_000
                readTimeout = 12_000
                requestMethod = "GET"
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
            }
            val code = connection.responseCode
            val stream: InputStream? =
                if (code in 200..299) connection.inputStream else connection.errorStream
            if (stream == null) {
                Log.w(TAG, "Gateway fetch HTTP $code (no body)")
                return null
            }
            val body = stream.bufferedReader(Charsets.UTF_8).use { reader ->
                val sb = StringBuilder()
                val buf = CharArray(8192)
                var total = 0
                while (true) {
                    val n = reader.read(buf)
                    if (n <= 0) break
                    sb.append(buf, 0, n)
                    total += n
                    if (total >= MAX_READ_BYTES) break
                }
                sb.toString()
            }
            if (code !in 200..299) {
                Log.w(TAG, "Gateway fetch HTTP $code bodyLen=${body.length} (not usable for extract)")
                return null
            }
            Log.d(TAG, "Gateway fetch HTTP $code bodyLen=${body.length}")
            body
        } catch (e: Exception) {
            Log.w(TAG, "Gateway fetch failed: ${e.message}")
            null
        } finally {
            connection?.disconnect()
        }
    }
}
