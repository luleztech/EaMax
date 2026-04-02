package com.eamax.player

import android.util.Log
import com.eamax.domain.model.StreamSession
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.min

/**
 * Resolves arbitrary stream entry URLs (e.g. https://bailatv.live/sp1.php) to a concrete
 * playback URI + format, or marks the URL as requiring full WebView embedding.
 * Ported from EaMax `StreamEngine.probePlaybackKind` + manifest extraction.
 */
object StreamProbe {

    private const val TAG = "StreamProbe"
    private const val TIMEOUT_MS = 12000
    private const val RANGE_BYTES = 65535

    enum class ResolvedKind {
        EXO_HLS,
        EXO_DASH,
        EXO_PROGRESSIVE,
        /** Let Media3 [androidx.media3.exoplayer.source.DefaultMediaSourceFactory] sniff manifest/playlist. */
        EXO_SNIFF,
        WEB_VIEW_PAGE,
    }

    data class Result(
        val kind: ResolvedKind,
        /** URI to pass to ExoPlayer when kind is EXO_*; original URL when WEB_VIEW_PAGE. */
        val playbackUri: String,
        val finalUrlAfterRedirects: String,
        /** Merge into StreamSession headers (Referer for CDN policies). */
        val headerOverlay: Map<String, String>
    )

    fun resolveForSession(session: StreamSession): Result {
        val original = session.mpdUrl.trim()
        val headers = buildRequestHeaders(session)

        // PHP gateways build or gate playback in the page (JS, redirects, cookies). WebView matches browser behavior.
        if (StreamUrlClassifier.isPhpLikeUrl(original)) {
            return Result(ResolvedKind.WEB_VIEW_PAGE, original, original, refererOverlay(original, headers))
        }

        if (StreamUrlClassifier.hasObviousM3u8(original)) {
            return Result(ResolvedKind.EXO_HLS, original, original, refererOverlay(original, headers))
        }
        if (StreamUrlClassifier.hasObviousMpd(original)) {
            return Result(ResolvedKind.EXO_DASH, original, original, refererOverlay(original, headers))
        }
        if (StreamUrlClassifier.hasObviousProgressiveExtension(original)) {
            return Result(ResolvedKind.EXO_PROGRESSIVE, original, original, refererOverlay(original, headers))
        }

        val useBrowserAccept = StreamUrlClassifier.isLikelyGatewayUrl(original)
        return try {
            probeHttp(original, headers, useBrowserAccept)
        } catch (e: Exception) {
            Log.w(TAG, "probe failed, gateway fallback: ${e.message}")
            if (StreamUrlClassifier.isLikelyGatewayUrl(original) || StreamUrlClassifier.isPhpLikeUrl(original)) {
                Result(ResolvedKind.WEB_VIEW_PAGE, original, original, refererOverlay(original, headers))
            } else {
                Result(ResolvedKind.EXO_SNIFF, original, original, refererOverlay(original, headers))
            }
        }
    }

    private fun buildRequestHeaders(session: StreamSession): MutableMap<String, String> {
        val h = HashMap<String, String>()
        session.headers.forEach { (k, v) -> h[k] = v }
        if (session.token.isNotBlank() && !h.keys.any { it.equals("Authorization", true) }) {
            h["Authorization"] = "Bearer ${session.token}"
        }
        if (StreamUrlClassifier.isLikelyGatewayUrl(session.mpdUrl)) {
            h["User-Agent"] = PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT
        } else {
            h.putIfAbsent("User-Agent", "ExoPlayerLib/2.18.0 (Linux; Android 11)")
        }
        return h
    }

    private fun refererOverlay(original: String, existing: Map<String, String>): Map<String, String> {
        val hasRef = existing.keys.any { it.equals("Referer", true) || it.equals("referer", true) }
        return if (hasRef) emptyMap() else mapOf("Referer" to stripHash(original))
    }

    private fun stripHash(url: String): String {
        val i = url.indexOf('#')
        return if (i >= 0) url.substring(0, i) else url
    }

    private fun probeHttp(url: String, headers: Map<String, String>, gatewayStyleAccept: Boolean): Result {
        val accept = if (gatewayStyleAccept) {
            "text/html,application/xhtml+xml,application/xml;q=0.9,application/dash+xml,application/vnd.apple.mpegurl;q=0.8,*/*;q=0.7"
        } else {
            "application/dash+xml,application/vnd.apple.mpegurl,application/x-mpegURL,application/xml,text/xml,*/*;q=0.8"
        }
        val reqHeaders = HashMap(headers).apply { putIfAbsent("Accept", accept) }

        var conn = open(url, reqHeaders, withRange = true)
        var finalUrl = conn.url?.toString() ?: url
        var status = conn.responseCode
        if (status == 416) {
            conn.disconnect()
            conn = open(url, reqHeaders, withRange = false)
            finalUrl = conn.url?.toString() ?: url
            status = conn.responseCode
        }
        val ct = conn.contentType?.lowercase()?.split(";")?.firstOrNull()?.trim().orEmpty()
        val stream = try {
            if (status in 200..299 || status == 206) conn.inputStream else conn.errorStream
        } catch (_: Exception) {
            conn.disconnect()
            throw IllegalStateException("HTTP $status")
        }
        val body = readLimited(stream, 720896)
        stream.close()
        conn.disconnect()

        val headSample = if (body.length <= 32768) body else body.substring(0, 32768)
        val headTrim = headSample.trim()
        val headLower = headTrim.lowercase()

        when {
            ct.contains("dash") && ct.contains("xml") ->
                return Result(ResolvedKind.EXO_DASH, finalUrl, finalUrl, refererOverlay(url, headers))
            ct.contains("mpegurl") || ct.contains("m3u8") || ct.contains("x-mpegurl") ->
                return Result(ResolvedKind.EXO_HLS, finalUrl, finalUrl, refererOverlay(url, headers))
        }

        if (headTrim.startsWith("#EXTM3U")) {
            return Result(ResolvedKind.EXO_HLS, finalUrl, finalUrl, refererOverlay(url, headers))
        }
        if (headTrim.startsWith("<?xml") || "<mpd" in headLower || """xmlns="urn:mpeg:dash:schema:mpd:2011"""" in headLower) {
            return Result(ResolvedKind.EXO_DASH, finalUrl, finalUrl, refererOverlay(url, headers))
        }
        if (ct.startsWith("video/") || ct == "application/octet-stream") {
            if (headTrim.startsWith("#EXTM3U")) {
                return Result(ResolvedKind.EXO_HLS, finalUrl, finalUrl, refererOverlay(url, headers))
            }
            return Result(ResolvedKind.EXO_PROGRESSIVE, finalUrl, finalUrl, refererOverlay(url, headers))
        }

        val looksHtml = headTrim.startsWith("<!doctype", ignoreCase = true) ||
            "<html" in headLower ||
            "<head" in headLower ||
            (headTrim.startsWith("<") && ("<script" in headLower || "<iframe" in headLower))

        if (looksHtml) {
            val extracted = ManifestUrlExtractor.extract(body, finalUrl)
            if (extracted != null) {
                val kind = when (extracted.kind) {
                    ManifestUrlExtractor.StreamKind.HLS -> ResolvedKind.EXO_HLS
                    ManifestUrlExtractor.StreamKind.DASH -> ResolvedKind.EXO_DASH
                }
                val ref = refererOverlay(finalUrl, headers)
                return Result(kind, extracted.url, finalUrl, ref)
            }
            return Result(ResolvedKind.WEB_VIEW_PAGE, url, finalUrl, refererOverlay(url, headers))
        }

        if (StreamUrlClassifier.isLikelyGatewayUrl(url)) {
            return Result(ResolvedKind.WEB_VIEW_PAGE, url, finalUrl, refererOverlay(url, headers))
        }

        return Result(ResolvedKind.EXO_SNIFF, finalUrl, finalUrl, refererOverlay(url, headers))
    }

    private fun open(url: String, headers: Map<String, String>, withRange: Boolean): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = TIMEOUT_MS
        c.readTimeout = TIMEOUT_MS
        c.instanceFollowRedirects = true
        c.requestMethod = "GET"
        if (withRange) c.setRequestProperty("Range", "bytes=0-$RANGE_BYTES")
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        c.connect()
        return c
    }

    private fun readLimited(stream: InputStream?, maxBytes: Int): String {
        if (stream == null) return ""
        val buf = ByteArray(8192)
        var total = 0
        val out = ByteArrayOutputStream()
        while (total < maxBytes) {
            val n = stream.read(buf, 0, min(buf.size, maxBytes - total))
            if (n <= 0) break
            out.write(buf, 0, n)
            total += n
        }
        return out.toByteArray().decodeToString()
    }
}
