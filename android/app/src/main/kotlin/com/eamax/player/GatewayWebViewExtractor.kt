package com.eamax.player

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.StreamSession
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Loads a PHP/HTML gateway in a **hidden** WebView (never attached to the UI), then:
 * 1) intercepts `.m3u8` / `.mpd` requests, and/or
 * 2) reads page HTML and decrypts `encryptedMpd` / `keyPart`,
 * so playback can continue in ExoPlayer without showing Google reCAPTCHA.
 */
object GatewayWebViewExtractor {
    private const val TAG = "GatewayWebExtract"
    private const val DEFAULT_TIMEOUT_MS = 10_000L
    private val mainHandler = Handler(Looper.getMainLooper())

    fun extractAsync(
        context: Context,
        session: StreamSession,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
        onResult: (GatewayPlaybackResolver.Resolved?) -> Unit,
    ) {
        val appCtx = context.applicationContext
        if (Looper.myLooper() == Looper.getMainLooper()) {
            start(appCtx, session, timeoutMs, onResult)
        } else {
            mainHandler.post { start(appCtx, session, timeoutMs, onResult) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun start(
        context: Context,
        session: StreamSession,
        timeoutMs: Long,
        onResult: (GatewayPlaybackResolver.Resolved?) -> Unit,
    ) {
        val gatewayUrl = session.mpdUrl.trim()
        if (gatewayUrl.isEmpty() || !StreamUrlClassifier.needsWebPlayer(gatewayUrl)) {
            onResult(null)
            return
        }

        val done = AtomicBoolean(false)
        var webView: WebView? = null
        var intercepted: GatewayPlaybackResolver.Resolved? = null
        var capturedLicenseUrl = session.licenseUrl.trim()
        var licenseWaitPosted = false
        val audioLang = session.preferredAudioLanguage.ifBlank { "sw" }
        val reqHeaders = PlaybackBrowserHeaders.buildForUrl(gatewayUrl, session.headers, audioLang)
        if (session.token.isNotBlank() &&
            !reqHeaders.keys.any { it.equals("Authorization", ignoreCase = true) }
        ) {
            reqHeaders["Authorization"] = "Bearer ${session.token}"
        }

        fun withDrm(resolved: GatewayPlaybackResolver.Resolved): GatewayPlaybackResolver.Resolved {
            val license = capturedLicenseUrl.ifBlank { resolved.licenseUrl }.trim()
            val drm = when {
                resolved.drmType != null -> resolved.drmType
                session.drmType != DrmType.NONE -> session.drmType
                resolved.clearKeyRaw.isNotBlank() -> DrmType.CLEARKEY
                // Only mark Widevine when we actually have a license URI for Exo.
                license.isNotBlank() -> DrmType.WIDEVINE_L3
                else -> null
            }
            return resolved.copy(
                licenseUrl = license.ifBlank { resolved.licenseUrl },
                drmType = drm,
            )
        }

        fun finish(result: GatewayPlaybackResolver.Resolved?) {
            if (!done.compareAndSet(false, true)) return
            try {
                webView?.stopLoading()
                webView?.loadUrl("about:blank")
                webView?.destroy()
            } catch (_: Exception) {
            }
            webView = null
            val out = result?.let { withDrm(it) }
            Log.i(
                TAG,
                if (out != null) {
                    "Extracted via hidden WebView drm=${out.drmType} license=${out.licenseUrl.isNotBlank()}"
                } else {
                    "Hidden WebView extract failed"
                },
            )
            onResult(out)
        }

        val timeoutRunnable = Runnable { finish(intercepted) }

        fun finishManifestSoon(manifest: GatewayPlaybackResolver.Resolved) {
            intercepted = manifest
            // Prefer waiting for HTML decrypt (license) when page still has keyPart payload.
            // Finishing on bare MPD caused Exo/WebView DRM failures (license=false).
            if (capturedLicenseUrl.isNotBlank() || manifest.licenseUrl.isNotBlank()) {
                mainHandler.removeCallbacks(timeoutRunnable)
                finish(manifest)
                return
            }
            if (licenseWaitPosted) return
            licenseWaitPosted = true
            // Longer window so onPageFinished HTML decrypt can win with license URL.
            mainHandler.postDelayed({
                if (done.get()) return@postDelayed
                mainHandler.removeCallbacks(timeoutRunnable)
                finish(intercepted)
            }, 4_500L)
        }

        mainHandler.postDelayed(timeoutRunnable, timeoutMs)

        try {
            webView = WebView(context).apply {
                // Never attach to a window — keeps reCAPTCHA off-screen.
                setWillNotDraw(true)
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    userAgentString = PlaybackBrowserHeaders.CHROME_MOBILE_UA
                    // Keep images on — blocking them can break gateway / captcha scripts.
                    blockNetworkImage = false
                }
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                try {
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                        WebViewCompat.addDocumentStartJavaScript(
                            this,
                            GatewayPlaybackJs.silentRecaptchaBypassScript(),
                            setOf("*"),
                        )
                    }
                } catch (_: Exception) {
                }

                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): WebResourceResponse? {
                        val u = request?.url?.toString().orEmpty()
                        if (u.isNotEmpty() && isRecaptchaAssetUrl(u)) {
                            // Don't load Google challenge UI in the hidden extractor.
                            return emptyJsResponse()
                        }
                        if (u.isNotEmpty() && looksLikeLicense(u)) {
                            Log.i(TAG, "Intercepted license ${u.take(96)}")
                            capturedLicenseUrl = u
                            val current = intercepted
                            if (current != null && !done.get()) {
                                mainHandler.post {
                                    mainHandler.removeCallbacks(timeoutRunnable)
                                    finish(current)
                                }
                            }
                        }
                        if (u.isNotEmpty() && looksLikeManifest(u) && !u.contains("recaptcha", ignoreCase = true)) {
                            val isHls = u.lowercase().contains(".m3u8")
                            Log.i(TAG, "Intercepted manifest ${u.take(96)}")
                            val manifest = GatewayPlaybackResolver.Resolved(
                                streamUrl = u,
                                isHls = isHls,
                                headers = LinkedHashMap(reqHeaders),
                                licenseUrl = capturedLicenseUrl.ifBlank { session.licenseUrl },
                                authToken = session.token,
                            )
                            mainHandler.post { finishManifestSoon(manifest) }
                        }
                        return super.shouldInterceptRequest(view, request)
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                        super.onPageStarted(view, url, favicon)
                        // Stub grecaptcha before host scripts gate the stream.
                        view?.evaluateJavascript(GatewayPlaybackJs.silentRecaptchaBypassScript(), null)
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        if (done.get()) return
                        view?.evaluateJavascript(GatewayPlaybackJs.silentRecaptchaBypassScript(), null)
                        // Poll — some gateways inject encryptedMpd after JS runs.
                        fun tryReadHtml(attempt: Int) {
                            if (done.get()) return
                            // Re-arm captcha unlock each poll — data-callback pages unlock late.
                            view?.evaluateJavascript(GatewayPlaybackJs.silentRecaptchaBypassScript(), null)
                            // Prefer runtime configData decrypt (object fields, not HTML quotes).
                            view?.evaluateJavascript(
                                GatewayPlaybackJs.gatewayConfigDataExtractScript(),
                            ) { cfgRaw ->
                                if (done.get()) return@evaluateJavascript
                                val fromJs = parseConfigDataExtract(
                                    cfgRaw,
                                    reqHeaders,
                                    session,
                                    interceptedStream = intercepted?.streamUrl.orEmpty(),
                                    capturedLicenseUrl = capturedLicenseUrl,
                                )
                                if (fromJs != null) {
                                    val hasDrm = fromJs.licenseUrl.isNotBlank() ||
                                        fromJs.clearKeyRaw.isNotBlank()
                                    if (fromJs.licenseUrl.isNotBlank()) {
                                        capturedLicenseUrl = fromJs.licenseUrl
                                    }
                                    if (fromJs.streamUrl.isNotBlank()) {
                                        intercepted = fromJs.copy(
                                            licenseUrl = capturedLicenseUrl.ifBlank {
                                                fromJs.licenseUrl
                                            },
                                        )
                                    }
                                    if (hasDrm) {
                                        Log.i(
                                            TAG,
                                            "configData extract stream=${fromJs.streamUrl.take(60)} " +
                                                "license=${fromJs.licenseUrl.isNotBlank()} " +
                                                "drm=${fromJs.drmType}",
                                        )
                                        mainHandler.removeCallbacks(timeoutRunnable)
                                        finish(
                                            fromJs.copy(
                                                streamUrl = fromJs.streamUrl.ifBlank {
                                                    intercepted?.streamUrl.orEmpty()
                                                },
                                                licenseUrl = capturedLicenseUrl.ifBlank {
                                                    fromJs.licenseUrl
                                                },
                                            ),
                                        )
                                        return@evaluateJavascript
                                    }
                                    Log.d(
                                        TAG,
                                        "configData partial stream=${fromJs.streamUrl.isNotBlank()} " +
                                            "license=false attempt=$attempt",
                                    )
                                }
                                view?.evaluateJavascript(
                                    "(function(){try{return document.documentElement.outerHTML;}catch(e){return '';}})();",
                                ) { raw ->
                                    if (done.get()) return@evaluateJavascript
                                    val html = unescapeJsString(raw)
                                    if (html.isBlank()) {
                                        if (attempt < 14) {
                                            mainHandler.postDelayed({ tryReadHtml(attempt + 1) }, 700L)
                                        }
                                        return@evaluateJavascript
                                    }
                                    val hasEncrypted = html.contains("encrypted", true)
                                    val hasKey = html.contains("keyPart", true) ||
                                        html.contains("xorKey", true) ||
                                        html.contains("decryptKey", true)
                                    Log.d(
                                        TAG,
                                        "Hidden page htmlLen=${html.length} encrypted=$hasEncrypted " +
                                            "keyPart=$hasKey attempt=$attempt",
                                    )
                                    if (!hasEncrypted && !hasKey && attempt == 0) {
                                        val preview = html.replace('\n', ' ').take(280)
                                        Log.w(TAG, "Hidden page preview: $preview")
                                    }
                                    if (!hasEncrypted && !hasKey &&
                                        GatewayStreamExtractor.looksLikeForbiddenPage(html) &&
                                        attempt == 0
                                    ) {
                                        Log.w(TAG, "Hidden extract got 403/Forbidden — reload once")
                                        mainHandler.postDelayed({
                                            if (done.get()) return@postDelayed
                                            try {
                                                webView?.evaluateJavascript(
                                                    GatewayPlaybackJs.silentRecaptchaBypassScript(),
                                                    null,
                                                )
                                                webView?.loadUrl(gatewayUrl, reqHeaders)
                                            } catch (_: Exception) {
                                            }
                                        }, 800L)
                                        mainHandler.postDelayed({ tryReadHtml(1) }, 1600L)
                                        return@evaluateJavascript
                                    }
                                    if (hasEncrypted && hasKey && attempt == 0) {
                                        logExtractDebug(html)
                                    }
                                    val resolved = resolveFromHtml(html, gatewayUrl, session, reqHeaders)
                                    if (resolved != null) {
                                        if (resolved.licenseUrl.isNotBlank()) {
                                            capturedLicenseUrl = resolved.licenseUrl
                                        }
                                        val htmlHasDrm = resolved.licenseUrl.isNotBlank() ||
                                            resolved.clearKeyRaw.isNotBlank() ||
                                            resolved.drmType != null
                                        if (htmlHasDrm || intercepted == null) {
                                            mainHandler.removeCallbacks(timeoutRunnable)
                                            finish(resolved)
                                            return@evaluateJavascript
                                        }
                                        intercepted = intercepted?.copy(streamUrl = resolved.streamUrl)
                                            ?: resolved
                                    } else if (intercepted != null) {
                                        val drmOnly = GatewayStreamExtractor.extractDrmFromHtml(
                                            html,
                                            fallbackStreamUrl = intercepted!!.streamUrl,
                                        )
                                        if (drmOnly != null && drmOnly.licenseUrl.isNotBlank()) {
                                            capturedLicenseUrl = drmOnly.licenseUrl
                                            mainHandler.removeCallbacks(timeoutRunnable)
                                            finish(
                                                intercepted!!.copy(
                                                    licenseUrl = drmOnly.licenseUrl,
                                                    authToken = drmOnly.authToken.ifBlank {
                                                        intercepted!!.authToken
                                                    },
                                                    clearKeyRaw = drmOnly.clearKeyRaw,
                                                    drmType = DrmType.WIDEVINE_L3,
                                                ),
                                            )
                                            return@evaluateJavascript
                                        }
                                    }
                                    if (attempt < 14) {
                                        mainHandler.postDelayed({ tryReadHtml(attempt + 1) }, 700L)
                                    }
                                }
                            }
                        }
                        tryReadHtml(0)
                    }
                }
            }
            Log.i(TAG, "Loading hidden gateway ${gatewayUrl.take(80)}")
            webView?.loadUrl(gatewayUrl, reqHeaders)
        } catch (e: Exception) {
            Log.w(TAG, "Hidden WebView start failed: ${e.message}")
            mainHandler.removeCallbacks(timeoutRunnable)
            finish(null)
        }
    }

    /** Parse JSON from [gatewayConfigDataExtractScript]. */
    private fun parseConfigDataExtract(
        raw: String?,
        reqHeaders: Map<String, String>,
        session: StreamSession,
        interceptedStream: String = "",
        capturedLicenseUrl: String = "",
    ): GatewayPlaybackResolver.Resolved? {
        val json = unescapeJsString(raw)
        if (json.isBlank() || json == "null" || !json.startsWith("{")) return null
        return try {
            fun field(key: String): String {
                val m = Regex(""""$key"\s*:\s*"((?:\\.|[^"\\])*)"""").find(json)
                return m?.groupValues?.get(1)
                    ?.replace("\\/", "/")
                    ?.replace("\\\"", "\"")
                    ?.replace("\\\\", "\\")
                    .orEmpty()
            }
            val stream = field("stream")
            val license = field("license")
            val token = field("token")
            val clearKey = field("clearKey")
            val finalStream = when {
                stream.lowercase().startsWith("http") -> stream
                interceptedStream.lowercase().startsWith("http") -> interceptedStream
                else -> ""
            }
            if (finalStream.isBlank() && license.isBlank() && clearKey.isBlank()) return null
            val drm = when {
                clearKey.isNotBlank() -> DrmType.CLEARKEY
                license.isNotBlank() -> DrmType.WIDEVINE_L3
                else -> null
            }
            val merged = LinkedHashMap(reqHeaders)
            if (token.isNotBlank() &&
                !merged.keys.any { it.equals("Authorization", ignoreCase = true) }
            ) {
                merged["Authorization"] = "Bearer $token"
            }
            GatewayPlaybackResolver.Resolved(
                streamUrl = finalStream.ifBlank { session.mpdUrl },
                licenseUrl = license.ifBlank { capturedLicenseUrl },
                authToken = token.ifBlank { session.token },
                clearKeyRaw = clearKey,
                isHls = finalStream.lowercase().contains(".m3u8"),
                headers = merged,
                drmType = drm,
            )
        } catch (e: Exception) {
            Log.w(TAG, "parseConfigDataExtract: ${e.message}")
            null
        }
    }

    private fun looksLikeManifest(url: String): Boolean {
        val u = url.lowercase()
        if (u.contains("recaptcha") || u.contains("google.com/recaptcha")) return false
        return u.contains(".m3u8") || u.contains(".mpd") ||
            (u.contains("/manifest") && (u.contains("dash") || u.contains("hls") || u.contains("mpeg")))
    }

    private fun looksLikeLicense(url: String): Boolean {
        val u = url.lowercase()
        if (u.contains("recaptcha") || u.contains("gstatic.com")) return false
        if (looksLikeManifest(u)) return false
        return u.contains("widevine") ||
            u.contains("playready") ||
            u.contains("acquirelicense") ||
            u.contains("rightsmanager") ||
            u.contains("/wv/") ||
            u.contains("/drm/") ||
            u.contains("license") && (u.contains("http") || u.startsWith("/")) ||
            u.contains("getlicense") ||
            u.contains("drmlicense")
    }

    private fun isRecaptchaAssetUrl(url: String): Boolean {
        val u = url.lowercase()
        return u.contains("google.com/recaptcha") ||
            u.contains("gstatic.com/recaptcha") ||
            u.contains("recaptcha.net") ||
            u.contains("www.google.com/js/bg/") ||
            (u.contains("recaptcha") && (u.contains(".js") || u.contains("anchor") || u.contains("bframe")))
    }

    /** Log nearby snippets so we can fix xor field parsing without guessing. */
    private fun logExtractDebug(html: String) {
        try {
            val names = listOf(
                "keyPart", "xorKey", "decryptKey", "encryptedMpd", "encryptedStream",
                "encryptedUrl", "encryptedLicense", "encryptedLicence", "encryptedDrm",
                "encryptedWidevine", "licenseUrl", "com.widevine.alpha",
            )
            for (name in names) {
                val idx = html.indexOf(name, ignoreCase = true)
                if (idx < 0) continue
                val start = (idx - 24).coerceAtLeast(0)
                val end = (idx + name.length + 64).coerceAtMost(html.length)
                val snip = html.substring(start, end).replace('\n', ' ').replace('\r', ' ')
                Log.d(TAG, "extract-debug [$name] …$snip…")
            }
            val extracted = GatewayStreamExtractor.extract(html)
            Log.d(
                TAG,
                "extract-debug result stream=${extracted?.streamUrl?.take(60)} " +
                    "license=${extracted?.licenseUrl?.isNotBlank()} clearKey=${extracted?.clearKeyRaw?.isNotBlank()}",
            )
        } catch (e: Exception) {
            Log.w(TAG, "extract-debug failed: ${e.message}")
        }
    }

    private fun emptyJsResponse(): WebResourceResponse {
        val bytes = "/* blocked */".toByteArray()
        return WebResourceResponse(
            "application/javascript",
            "utf-8",
            java.io.ByteArrayInputStream(bytes),
        )
    }

    private fun resolveFromHtml(
        html: String,
        gatewayUrl: String,
        session: StreamSession,
        reqHeaders: Map<String, String>,
    ): GatewayPlaybackResolver.Resolved? {
        val encrypted = GatewayStreamExtractor.extract(html)
            ?: GatewayStreamExtractor.extractDrmFromHtml(html)
        if (encrypted != null && encrypted.streamUrl.lowercase().startsWith("http")) {
            val merged = LinkedHashMap(reqHeaders)
            if (encrypted.authToken.isNotEmpty() &&
                !merged.keys.any { it.equals("Authorization", ignoreCase = true) }
            ) {
                merged["Authorization"] = "Bearer ${encrypted.authToken}"
            }
            val license = encrypted.licenseUrl.ifBlank { session.licenseUrl }
            var drm: DrmType? = null
            if (session.drmType != DrmType.NONE) {
                drm = session.drmType
            } else if (license.isNotBlank()) {
                drm = if (license.lowercase().contains("playready")) DrmType.PLAYREADY else DrmType.WIDEVINE_L3
            } else if (encrypted.clearKeyRaw.isNotBlank()) {
                drm = DrmType.CLEARKEY
            }
            return GatewayPlaybackResolver.Resolved(
                streamUrl = encrypted.streamUrl,
                licenseUrl = license,
                authToken = encrypted.authToken.ifBlank { session.token },
                clearKeyRaw = encrypted.clearKeyRaw,
                isHls = encrypted.isHls,
                headers = merged,
                drmType = drm,
            )
        }
        val manifest = ManifestUrlExtractor.extract(html, gatewayUrl) ?: return null
        return GatewayPlaybackResolver.Resolved(
            streamUrl = manifest.url,
            isHls = manifest.isHls,
            headers = LinkedHashMap(reqHeaders),
            licenseUrl = session.licenseUrl,
            authToken = session.token,
        )
    }

    /** evaluateJavascript returns a JSON-encoded string (quotes + escapes). */
    private fun unescapeJsString(raw: String?): String {
        if (raw.isNullOrBlank() || raw == "null") return ""
        var s = raw.trim()
        if (s.length >= 2 && s.first() == '"' && s.last() == '"') {
            s = s.substring(1, s.length - 1)
        }
        return s
            .replace("\\u003C", "<")
            .replace("\\u003c", "<")
            .replace("\\u003E", ">")
            .replace("\\u003e", ">")
            .replace("\\\"", "\"")
            .replace("\\'", "'")
            .replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace("\\\\", "\\")
    }
}
