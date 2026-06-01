package com.eamax.player

import android.net.Uri
import android.util.Log
import com.eamax.domain.model.StreamSession
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlin.math.min
import okhttp3.Request

/**
 * Resolves arbitrary stream entry URLs (e.g. https://bailatv.live/sp1.php) to a concrete
 * playback URI + format, or marks the URL as requiring full WebView embedding.
 * Ported from EaMax `StreamEngine.probePlaybackKind` + manifest extraction.
 */
object StreamProbe {

    private const val TAG = "StreamProbe"
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
            // Still probe once: some providers return HTML/login pages even for .m3u8 URLs.
            return safeProbeFirst(
                original = original,
                headers = headers,
                expectedKind = ResolvedKind.EXO_HLS,
            )
        }
        if (StreamUrlClassifier.hasObviousMpd(original)) {
            // Still probe once: many DRM gateways redirect .mpd requests to non-manifest content.
            return safeProbeFirst(
                original = original,
                headers = headers,
                expectedKind = ResolvedKind.EXO_DASH,
            )
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

    private fun safeProbeFirst(
        original: String,
        headers: Map<String, String>,
        expectedKind: ResolvedKind,
    ): Result {
        return try {
            val probed = probeHttp(original, headers, gatewayStyleAccept = false)
            when (probed.kind) {
                ResolvedKind.EXO_HLS,
                ResolvedKind.EXO_DASH,
                ResolvedKind.EXO_PROGRESSIVE,
                ResolvedKind.EXO_SNIFF,
                ResolvedKind.WEB_VIEW_PAGE -> probed
            }
        } catch (e: Exception) {
            // Prefer sniffing over forcing DASH/HLS when probe fails — wrong format → malformed manifest.
            Log.w(TAG, "probe failed for manifest URL, using EXO_SNIFF: ${e.message}")
            Result(ResolvedKind.EXO_SNIFF, original, original, refererOverlay(original, headers))
        }
    }

    private fun buildRequestHeaders(session: StreamSession): MutableMap<String, String> {
        val h = HashMap<String, String>()
        session.headers.forEach { (k, v) -> h[k] = v }
        if (session.token.isNotBlank() && !h.keys.any { it.equals("Authorization", true) }) {
            h["Authorization"] = "Bearer ${session.token}"
        }
        when {
            StreamUrlClassifier.isLikelyGatewayUrl(session.mpdUrl) ||
                StreamUrlClassifier.isYcnRedirectHost(session.mpdUrl) ->
                h["User-Agent"] = PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT
            else ->
                h.putIfAbsent("User-Agent", PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT)
        }
        // Always include a self-Referer + Origin so CDN/IPTV panels don’t 403 the probe.
        // This gives us the real content-type and final URL rather than an error page.
        if (!h.keys.any { it.equals("Referer", ignoreCase = true) }) {
            try {
                val u = Uri.parse(session.mpdUrl.trim())
                if (u.scheme != null && u.host != null) {
                    val portPart = when {
                        u.port <= 0 || u.port == 80 || u.port == 443 -> ""
                        else -> ":${u.port}"
                    }
                    h["Referer"] = "${u.scheme}://${u.host}$portPart/"
                    if (!h.keys.any { it.equals("Origin", ignoreCase = true) }) {
                        h["Origin"] = "${u.scheme}://${u.host}$portPart"
                    }
                }
            } catch (_: Exception) {}
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
        val client = EamaxHttpDataSource.probeClient()

        fun buildRequest(withRange: Boolean): Request {
            val b = Request.Builder().url(url)
            reqHeaders.forEach { (k, v) -> b.header(k, v) }
            if (withRange) b.header("Range", "bytes=0-$RANGE_BYTES")
            return b.get().build()
        }

        var response = client.newCall(buildRequest(true)).execute()
        var finalUrl = response.request.url.toString()
        var status = response.code
        // Some CDNs return 404/403 for ranged GET on manifests; retry full GET once.
        if (status == 404 || status == 403) {
            response.close()
            response = client.newCall(buildRequest(false)).execute()
            finalUrl = response.request.url.toString()
            status = response.code
        }
        if (status == 416) {
            response.close()
            response = client.newCall(buildRequest(false)).execute()
            finalUrl = response.request.url.toString()
            status = response.code
        }

        val (ct, body) = response.use { r ->
            val ctv = r.header("Content-Type")?.lowercase()?.split(";")?.firstOrNull()?.trim().orEmpty()
            val stream = try {
                r.body?.byteStream()
            } catch (_: Exception) {
                throw IllegalStateException("HTTP $status")
            }
            val bodyText = readLimited(stream, 720896)
            ctv to bodyText
        }

        val headSample = if (body.length <= 32768) body else body.substring(0, 32768)
        val headTrim = headSample.trim()
        val headLower = headTrim.lowercase()
        // MPD/XML can start after whitespace; peek more than the UI sample for classification.
        val manifestPeek = body.take(262144).trim()

        val okStatus = status in 200..299 || status == 206
        if (!okStatus) {
            Log.w(TAG, "probeHttp HTTP $status finalUrl=$finalUrl (original=$url)")
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
                    return Result(kind, extracted.url, finalUrl, refererOverlay(finalUrl, headers))
                }
            }
            if (StreamUrlClassifier.isLikelyGatewayUrl(url) ||
                StreamUrlClassifier.isPhpLikeUrl(url)
            ) {
                return Result(ResolvedKind.WEB_VIEW_PAGE, url, finalUrl, refererOverlay(url, headers))
            }
            // Let ExoPlayer surface the HTTP error (BAD_HTTP_STATUS) instead of mis-parsing as DASH.
            return Result(ResolvedKind.EXO_SNIFF, url, finalUrl, refererOverlay(url, headers))
        }

        // --- 200/206: classify by *body first* — wrong Content-Type is common; HTML login pages must not become DASH. ---
        val looksHtml = looksLikeHtmlDocument(manifestPeek)
        val looksLogin = looksLikeLoginOrAuthWall(manifestPeek)
        val isHlsBody = manifestPeek.startsWith("#EXTM3U")
        val isDashBody = looksLikeDashMpd(manifestPeek)

        if (isHlsBody) {
            return Result(ResolvedKind.EXO_HLS, finalUrl, finalUrl, refererOverlay(url, headers))
        }
        if (isDashBody) {
            return Result(ResolvedKind.EXO_DASH, finalUrl, finalUrl, refererOverlay(url, headers))
        }

        // Content-Type says DASH/HLS but body is not — do not hand Exo a bogus type (→ malformed manifest).
        if (ct.contains("dash") && ct.contains("xml")) {
            Log.w(TAG, "probe: Content-Type claims DASH but body is not MPD (login page or wrong file). Sniffing. url=$finalUrl")
            return Result(ResolvedKind.EXO_SNIFF, finalUrl, finalUrl, refererOverlay(url, headers))
        }
        if (ct.contains("mpegurl") || ct.contains("m3u8") || ct.contains("x-mpegurl")) {
            Log.w(TAG, "probe: Content-Type claims HLS but body is not #EXTM3U. Sniffing. url=$finalUrl")
            return Result(ResolvedKind.EXO_SNIFF, finalUrl, finalUrl, refererOverlay(url, headers))
        }

        // HTML / login without a real manifest → extract, WebView, or sniff (never force DASH on HTML)
        if (looksHtml || looksLogin) {
            val extracted = ManifestUrlExtractor.extract(body, finalUrl)
            if (extracted != null) {
                val kind = when (extracted.kind) {
                    ManifestUrlExtractor.StreamKind.HLS -> ResolvedKind.EXO_HLS
                    ManifestUrlExtractor.StreamKind.DASH -> ResolvedKind.EXO_DASH
                }
                return Result(kind, extracted.url, finalUrl, refererOverlay(finalUrl, headers))
            }
            if (StreamUrlClassifier.isLikelyGatewayUrl(url) || StreamUrlClassifier.isPhpLikeUrl(url)) {
                return Result(ResolvedKind.WEB_VIEW_PAGE, url, finalUrl, refererOverlay(url, headers))
            }
            Log.w(TAG, "probe: HTML/login body but no manifest link; sniffing. ct=$ct url=$finalUrl")
            return Result(ResolvedKind.EXO_SNIFF, finalUrl, finalUrl, refererOverlay(url, headers))
        }

        if (ct.startsWith("video/") || ct == "application/octet-stream") {
            if (headTrim.startsWith("#EXTM3U")) {
                return Result(ResolvedKind.EXO_HLS, finalUrl, finalUrl, refererOverlay(url, headers))
            }
            return Result(ResolvedKind.EXO_PROGRESSIVE, finalUrl, finalUrl, refererOverlay(url, headers))
        }

        if (StreamUrlClassifier.isLikelyGatewayUrl(url)) {
            return Result(ResolvedKind.WEB_VIEW_PAGE, url, finalUrl, refererOverlay(url, headers))
        }

        return Result(ResolvedKind.EXO_SNIFF, finalUrl, finalUrl, refererOverlay(url, headers))
    }

    private fun looksLikeHtmlDocument(s: String): Boolean {
        val t = s.trim().take(12288).lowercase()
        if (t.startsWith("#extm3u")) return false
        return t.startsWith("<!doctype") ||
            "<html" in t ||
            "<head" in t ||
            (t.startsWith("<") && ("<script" in t || "<iframe" in t || "<body" in t))
    }

    private fun looksLikeLoginOrAuthWall(s: String): Boolean {
        val t = s.take(24576).lowercase()
        if (t.contains("type=\"password\"") || t.contains("type='password'")) return true
        if (t.contains("name=\"password\"") || t.contains("name='password'")) return true
        if (t.contains(">sign in<") || t.contains("sign in to") || t.contains("please log in")) return true
        if (t.contains("unauthorized") || t.contains("access denied") || t.contains("forbidden")) return true
        if (t.contains("session expired") || t.contains("authentication required")) return true
        // Avoid matching "login" inside unrelated words (e.g. "blog").
        return Regex("""(?i)(^|[^a-z])login([^a-z]|$)""").containsMatchIn(t)
    }

    /** True if the response body looks like an MPD (not HTML with a random `<mpd` string). */
    private fun looksLikeDashMpd(s: String): Boolean {
        val t = s.trim().take(98304)
        val tl = t.lowercase()
        if (t.startsWith("#EXTM3U")) return false
        if (looksLikeHtmlDocument(t)) return false
        if (t.startsWith("<?xml")) {
            return "<mpd" in tl || "mpeg:dash:schema:mpd" in tl
        }
        val idx = tl.indexOf("<mpd")
        if (idx in 0..4096) return true
        return "urn:mpeg:dash:schema:mpd" in tl
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
