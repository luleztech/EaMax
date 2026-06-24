package com.eamax.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.eamax.domain.model.ClearKey
import com.eamax.domain.model.StreamSession
import com.eamax.domain.model.StreamQuality
import com.eamax.domain.model.PlaybackState
import java.util.concurrent.Executors

/**
 * WebView engine — plays streams via embedded **Shaka Player** (HLS + DASH), not raw gateway pages.
 */
class WebViewEngine(
    private val context: Context,
    private val onPlaybackStateChanged: (PlaybackState) -> Unit,
    private val onError: (String) -> Unit,
    private val onStreamExtracted: ((PhpGatewayExtractor.Extracted) -> Unit)? = null,
    private val onShakaFailed: ((PhpGatewayExtractor.Extracted) -> Unit)? = null,
) {
    companion object {
        private const val TAG = "WebViewEngine"
        /** Detects active <video> playback when the JS bridge never fires onPlaybackStarted. */
        private const val VIDEO_PLAYING_PROBE_JS =
            "(function(){var v=document.querySelector('video');" +
                "if(v&&!v.paused&&!v.ended&&v.readyState>=2&&(v.currentTime>0||v.videoWidth>0))return'playing';" +
                "return'';})()"
    }

    private var webView: WebView? = null
    private var currentSession: StreamSession? = null
    private var jsInterface: WebViewJsInterface? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val defaultOkoaRunnables = mutableListOf<Runnable>()
    private val uiInjectRunnables = mutableListOf<Runnable>()
    private var playbackWatchdog: Runnable? = null
    private var playbackStarted = false
    private var webViewPaused = false
    private var userPickedOkoaQuality = false
    private var preferredAudioLanguage: String = AudioLanguageSupport.DEFAULT
    private val audioLanguageRunnables = mutableListOf<Runnable>()
    private var lastExtracted: PhpGatewayExtractor.Extracted? = null
    private var usingShakaEmbed = false
    private var released = false
    private var errorReported = false
    private var okoaApiInjected = false
    private var capturedManifestUrl: String? = null
    private var capturedLicenseUrl: String? = null
    private var manifestFallbackRunnable: Runnable? = null
    private var manifestExtendedFallbackRunnable: Runnable? = null
    private var streamDelivered = false
    private var manifestRequiresDrm = false
    private var shakaDrmSignaled = false
    private var capturedManifestHeaders: Map<String, String> = emptyMap()
    private var licenseHeadersWaitRunnable: Runnable? = null
    private var licenseHeadersWaitExpired = false
    private var licenseBridge: WebViewLicenseBridge? = null
    /** Encrypted gateway playing in WebView — stop JS extract/probe loops (main-thread jank). */
    private var gatewayExtractLocked = false
    /** No native license URL — keep Shaka/Widevine inside WebView instead of Exo promotion. */
    private var exoPromotionDeferred = false
    private val gatewayExtractRunnables = mutableListOf<Runnable>()
    private var playbackMonitorRunnable: Runnable? = null

    fun initialize(streamSession: StreamSession) {
        released = false
        errorReported = false
        okoaApiInjected = false
        capturedManifestUrl = null
        capturedLicenseUrl = null
        streamDelivered = false
        manifestRequiresDrm = false
        shakaDrmSignaled = false
        capturedManifestHeaders = emptyMap()
        licenseHeadersWaitExpired = false
        gatewayExtractLocked = false
        exoPromotionDeferred = false
        cancelGatewayExtractRunnables()
        cancelPlaybackMonitor()
        cancelLicenseHeadersWait()
        cancelManifestFallback()
        currentSession = streamSession
        preferredAudioLanguage = AudioLanguageSupport.normalize(streamSession.preferredAudioLanguage)
        playbackStarted = false
        userPickedOkoaQuality = false
        usingShakaEmbed = false
        lastExtracted = null

        try {
            ensureWebView()
            val url = streamSession.mpdUrl.trim()
            if (url.isEmpty()) {
                onError("unavailable")
                return
            }

            val directStream = StreamUrlClassifier.hasObviousM3u8(url) ||
                StreamUrlClassifier.hasObviousMpd(url) ||
                (!StreamUrlClassifier.isLikelyGatewayUrl(url) &&
                    !StreamUrlClassifier.isPhpLikeUrl(url) &&
                    url.startsWith("http", ignoreCase = true))

            if (directStream) {
                loadShakaPlayback(url, streamSession, null)
                return
            }

            // Load gateway page immediately; HTML decrypt after page load (WebView cookies available).
            loadGatewayFallback(url)
        } catch (e: Exception) {
            onError("unavailable")
        }
    }

    /** Load HLS/DASH via Shaka inside WebView (primary playback path). */
    fun loadShakaPlayback(
        streamUrl: String,
        session: StreamSession,
        extracted: PhpGatewayExtractor.Extracted?,
    ) {
        val w = webView ?: return
        cancelUiInjectionRunnables()
        usingShakaEmbed = true
        playbackStarted = false
        w.alpha = 0f
        cancelPlaybackWatchdog()

        val headers = buildHeaders(session, extracted)
        val license = extracted?.licenseUrl?.takeIf { it.isNotEmpty() } ?: session.licenseUrl
        val html = PhpWebViewSupport.buildShakaPlayerHtml(
            streamUrl = streamUrl,
            headers = headers,
            clearKeys = clearKeysForShaka(session, extracted),
            licenseUrl = license,
            maxHeight = 360,
            preferredAudioLanguage = preferredAudioLanguage,
        )
        w.loadDataWithBaseURL(
            "https://player.eamax.local/",
            html,
            "text/html",
            "UTF-8",
            null,
        )
        schedulePlaybackWatchdog()
        webView?.let { applyDefaultOkoa360(it) }
    }

    private fun loadGatewayFallback(gatewayUrl: String) {
        cancelUiInjectionRunnables()
        usingShakaEmbed = false
        playbackStarted = false
        webView?.alpha = 0f
        webView?.loadUrl(gatewayUrl)
        schedulePlaybackWatchdog()
    }

    private fun ensureWebView() {
        if (webView != null) return
        webView = WebView(context).apply {
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            alpha = 0f

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                allowFileAccessFromFileURLs = true
                allowUniversalAccessFromFileURLs = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                setSupportMultipleWindows(true)
                javaScriptCanOpenWindowsAutomatically = true
                loadWithOverviewMode = true
                useWideViewPort = true
                userAgentString = PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT
            }

            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            installDocumentStartHooks(this)

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, startedUrl: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, startedUrl, favicon)
                    if (!usingShakaEmbed && !playbackStarted) {
                        view?.alpha = 0f
                        view?.evaluateJavascript(PhpWebViewSupport.gatewayShakaConfigureHookScript(), null)
                        view?.evaluateJavascript(PhpWebViewSupport.gatewayShakaHookScript(), null)
                    }
                }

                override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                    super.onPageFinished(view, finishedUrl)
                    val w = view ?: return
                    if (usingShakaEmbed) return
                    ensureGatewayPageReady(w)
                    if (!gatewayExtractLocked) {
                        w.evaluateJavascript(PhpWebViewSupport.gatewayHtmlProbeScript(), null)
                        w.evaluateJavascript(PhpWebViewSupport.gatewayStreamExtractScript(), null)
                        scheduleGatewayHtmlPrefetch(currentSession?.mpdUrl ?: finishedUrl.orEmpty())
                        scheduleGatewayExtractRetries(w)
                    }
                    applyDefaultOkoa360(w)
                    scheduleUiInjection(w)
                    if (!exoPromotionDeferred) {
                        scheduleManifestFallback()
                    }
                    scheduleWebViewPlaybackMonitor()
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: android.webkit.WebResourceRequest?,
                    error: android.webkit.WebResourceError?,
                ) {
                    if (request?.isForMainFrame == true && !released) {
                        if (usingShakaEmbed) {
                            handleJsPlaybackError()
                        }
                    }
                }

                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: android.webkit.WebResourceRequest?,
                ): android.webkit.WebResourceResponse? {
                    if (!released && !usingShakaEmbed) {
                        val url = request?.url?.toString().orEmpty()
                        if (StreamUrlClassifier.hasObviousM3u8(url) ||
                            StreamUrlClassifier.hasObviousMpd(url)
                        ) {
                            request?.requestHeaders?.let { rh ->
                                val captured = LinkedHashMap<String, String>()
                                rh.forEach { (k, v) ->
                                    if (k.isNotBlank() && v.isNotBlank()) captured[k] = v
                                }
                                if (captured.isNotEmpty()) {
                                    capturedManifestHeaders = captured
                                }
                            }
                            if (capturedManifestUrl == null) {
                                capturedManifestUrl = url
                                Log.d(TAG, "Captured gateway manifest (awaiting DRM): ${url.take(100)}")
                                scheduleManifestDrmProbe(url)
                            }
                        } else if (url.startsWith("http", ignoreCase = true) &&
                            StreamUrlClassifier.isLikelyLicenseServerUrl(url)
                        ) {
                            onLicenseUrlCaptured(url)
                        }
                    }
                    return super.shouldInterceptRequest(view, request)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                    val msg = consoleMessage?.message().orEmpty()
                    if (msg.contains("EncryptionScheme", ignoreCase = true) ||
                        msg.contains("Shaka Player Load Error", ignoreCase = true) ||
                        msg.contains("widevine", ignoreCase = true)
                    ) {
                        shakaDrmSignaled = true
                    }
                    Log.d(TAG, "[WebView] $msg")
                    return true
                }
            }
            jsInterface = WebViewJsInterface(
                onPlaybackStateChanged = { state ->
                    mainHandler.post {
                        when (state) {
                            PlaybackState.PLAYING -> notifyWebViewPlaybackStarted()
                            PlaybackState.PAUSED -> {
                                webViewPaused = true
                                onPlaybackStateChanged(state)
                            }
                            else -> onPlaybackStateChanged(state)
                        }
                    }
                },
                onError = { mainHandler.post { if (usingShakaEmbed) handleJsPlaybackError() } },
                onStreamExtracted = { extracted ->
                    mainHandler.post { deliverExtractedStream(extracted) }
                },
                onHtmlProbe = { html ->
                    mainHandler.post { probeHtmlForGatewayExtract(html) }
                },
            )
            addJavascriptInterface(jsInterface!!, "ShakaPlayerBridge")
            licenseBridge = WebViewLicenseBridge(this)
        }
    }

    fun getLicenseBridge(): WebViewLicenseBridge? = licenseBridge

    fun wasPlaybackStarted(): Boolean = playbackStarted && !released

    fun isPlaying(): Boolean = playbackStarted && !webViewPaused && !released

    fun restoreWebViewVisibility() {
        webView?.alpha = 1f
    }

    private fun scheduleGatewayHtmlPrefetch(gatewayUrl: String) {
        if (!gatewayUrl.startsWith("http") || gatewayExtractLocked) return
        worker.execute {
            try {
                val session = currentSession ?: return@execute
                val headers = buildHeaders(session)
                val html = fetchGatewayHtml(gatewayUrl, headers)
                val manifest = capturedManifestUrl.orEmpty()
                val extracted = PhpGatewayExtractor.extractFromHtml(html, manifest)
                if (extracted == null) return@execute
                mainHandler.post {
                    if (released) return@post
                    if (extracted.licenseUrl.isNotEmpty()) shakaDrmSignaled = true
                    Log.d(
                        TAG,
                        "Gateway HTML prefetch widevine=${extracted.licenseUrl.isNotEmpty()}",
                    )
                    deliverExtractedStream(extracted)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Gateway HTML prefetch: ${e.message}")
            }
        }
    }

    private fun probeHtmlForGatewayExtract(html: String) {
        if (released || gatewayExtractLocked ||
            (streamDelivered && lastExtracted?.licenseUrl?.isNotEmpty() == true)
        ) return
        worker.execute {
            val manifest = capturedManifestUrl.orEmpty()
            val extracted = PhpGatewayExtractor.extractFromHtml(html, manifest)
                ?: PhpGatewayExtractor.extractDrmFromHtml(html)?.let { drm ->
                    if (manifest.startsWith("http")) {
                        drm.copy(
                            streamUrl = manifest,
                            isHls = manifest.contains(".m3u8", ignoreCase = true),
                        )
                    } else null
                }
            if (extracted == null || !extracted.streamUrl.startsWith("http")) return@execute
            mainHandler.post {
                if (released) return@post
                if (extracted.licenseUrl.isNotEmpty()) shakaDrmSignaled = true
                Log.d(
                    TAG,
                    "HTML probe extracted stream widevine=${extracted.licenseUrl.isNotEmpty()}",
                )
                deliverExtractedStream(extracted)
            }
        }
    }

    private fun deliverExtractedStream(extracted: PhpGatewayExtractor.Extracted) {
        if (released) return
        if (extracted.streamUrl.isBlank() && extracted.licenseHeaders.isEmpty()) return

        val enriched = enrichExtracted(extracted)
        if (enriched.streamUrl.isBlank()) return

        if (gatewayExtractLocked) {
            val upgrade = enriched.licenseUrl.isNotEmpty() || enriched.licenseHeaders.isNotEmpty()
            if (!upgrade) return
        }

        if (enriched.licenseUrl.isEmpty() &&
            shouldWaitForLicense(enriched.streamUrl) &&
            !streamDelivered
        ) {
            lastExtracted = enriched
            deferExoPromotionToWebView()
            return
        }

        if (shouldWaitForLicenseHeaders(enriched) && !streamDelivered && !licenseHeadersWaitExpired) {
            Log.d(TAG, "Nagra license — waiting for gateway license POST headers")
            lastExtracted = enriched
            scheduleLicenseHeadersWait()
            return
        }

        val existing = lastExtracted
        if (existing != null &&
            extractionScore(enriched) <= extractionScore(existing) &&
            !(licenseHeadersWaitExpired && !streamDelivered)
        ) {
            return
        }

        val upgrading = streamDelivered
        lastExtracted = enriched
        if (!streamDelivered) {
            streamDelivered = true
            cancelManifestFallback()
            cancelExtendedManifestFallback()
            cancelLicenseHeadersWait()
            cancelPlaybackWatchdog()
            cancelUiInjectionRunnables()
        }
        Log.d(
            TAG,
            "Gateway stream extracted → native ExoPlayer (widevine=${enriched.licenseUrl.isNotEmpty()}, licHdrs=${enriched.licenseHeaders.size}, upgrade=$upgrading)",
        )
        onStreamExtracted?.invoke(enriched)
    }

    private fun enrichExtracted(extracted: PhpGatewayExtractor.Extracted): PhpGatewayExtractor.Extracted {
        val session = currentSession
        var streamUrl = extracted.streamUrl
        var licenseUrl = extracted.licenseUrl
        var authToken = extracted.authToken
        val clearKeys = extracted.clearKeys
        var licenseHeaders = extracted.licenseHeaders

        if (licenseUrl.isEmpty()) {
            licenseUrl = capturedLicenseUrl.orEmpty()
        }
        if (!StreamUrlClassifier.isLikelyLicenseServerUrl(licenseUrl)) {
            licenseUrl = ""
        }
        if (licenseUrl.isEmpty() && session != null) {
            licenseUrl = session.licenseUrl
        }
        if (authToken.isEmpty() && session != null) {
            authToken = session.token
        }
        if (streamUrl.isEmpty()) {
            streamUrl = capturedManifestUrl.orEmpty()
        }
        if (licenseHeaders.isEmpty() && lastExtracted?.licenseHeaders?.isNotEmpty() == true) {
            licenseHeaders = lastExtracted!!.licenseHeaders
        }

        return extracted.copy(
            streamUrl = streamUrl,
            licenseUrl = licenseUrl,
            authToken = authToken,
            clearKeys = clearKeys,
            licenseHeaders = licenseHeaders,
            isHls = streamUrl.contains(".m3u8", ignoreCase = true),
        )
    }

    private fun shouldWaitForLicenseHeaders(extracted: PhpGatewayExtractor.Extracted): Boolean {
        if (licenseBridge != null) return false
        return StreamUrlClassifier.isNagraLicense(extracted.licenseUrl) &&
            extracted.licenseHeaders.isEmpty()
    }

    private fun scheduleLicenseHeadersWait() {
        if (licenseHeadersWaitRunnable != null) return
        licenseHeadersWaitRunnable = Runnable {
            licenseHeadersWaitRunnable = null
            if (released || streamDelivered) return@Runnable
            licenseHeadersWaitExpired = true
            Log.d(TAG, "License header wait timeout — promoting with CDN Origin/Referer defaults")
            lastExtracted?.let { deliverExtractedStream(it) }
        }.also { mainHandler.postDelayed(it, 700L) }
    }

    private fun cancelLicenseHeadersWait() {
        licenseHeadersWaitRunnable?.let { mainHandler.removeCallbacks(it) }
        licenseHeadersWaitRunnable = null
    }

    private fun extractionScore(extracted: PhpGatewayExtractor.Extracted): Int {
        var score = 0
        if (extracted.streamUrl.startsWith("http")) score += 1
        if (extracted.licenseUrl.isNotEmpty()) score += 4
        if (extracted.licenseHeaders.isNotEmpty()) score += 5
        if (extracted.authToken.isNotEmpty()) score += 2
        if (extracted.clearKeys.isNotEmpty()) score += 3
        return score
    }

    private fun scheduleManifestFallback() {
        if (gatewayExtractLocked || exoPromotionDeferred) return
        cancelManifestFallback()
        manifestFallbackRunnable = Runnable {
            if (released || streamDelivered) return@Runnable
            tryManifestFallback(extended = false)
        }.also { mainHandler.postDelayed(it, 1_800L) }
    }

    private fun scheduleExtendedManifestFallback() {
        cancelExtendedManifestFallback()
        manifestExtendedFallbackRunnable = Runnable {
            if (released || streamDelivered) return@Runnable
            tryManifestFallback(extended = true)
        }.also { mainHandler.postDelayed(it, 5_500L) }
    }

    private fun shouldWaitForLicense(streamUrl: String): Boolean {
        if (shakaDrmSignaled || manifestRequiresDrm) return true
        return StreamUrlClassifier.likelyRequiresWidevine(streamUrl)
    }

    private fun installDocumentStartHooks(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        try {
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                PhpWebViewSupport.gatewayDocumentStartScript(),
                setOf("*"),
            )
            Log.d(TAG, "Document-start Shaka/DRM hooks installed")
        } catch (e: Exception) {
            Log.w(TAG, "Document-start hooks unavailable: ${e.message}")
        }
    }

    private fun scheduleManifestDrmProbe(manifestUrl: String) {
        mainHandler.postDelayed({
            if (!released) probeManifestDrmAsync(manifestUrl)
        }, 120L)
    }

    private fun manifestProbeHeaders(session: StreamSession, manifestUrl: String): Map<String, String> {
        val gateway = session.mpdUrl.trim()
        val base = if (gateway.startsWith("http")) {
            GatewayHttpHeaders.forManifest(manifestUrl, gateway, buildHeaders(session))
        } else {
            buildHeaders(session)
        }
        if (capturedManifestHeaders.isEmpty()) return base
        val merged = LinkedHashMap(base)
        capturedManifestHeaders.forEach { (k, v) ->
            if (!merged.containsKey(k)) merged[k] = v
        }
        return merged
    }

    private fun tryManifestFallback(extended: Boolean) {
        val manifest = capturedManifestUrl?.takeIf { it.startsWith("http") } ?: return
        val gateway = currentSession?.mpdUrl.orEmpty()
        worker.execute {
            val session = currentSession
            val headers = when {
                session != null && gateway.startsWith("http") ->
                    manifestProbeHeaders(session, manifest)
                session != null -> buildHeaders(session)
                else -> emptyMap()
            }
            val probe = DashDrmProbe.probe(manifest, headers)
            val license = when {
                capturedLicenseUrl?.isNotEmpty() == true -> capturedLicenseUrl!!
                probe.licenseUrl.isNotEmpty() -> probe.licenseUrl
                else -> ""
            }
            mainHandler.post {
                if (released) return@post
                if (playbackStarted || exoPromotionDeferred) {
                    Log.d(TAG, "Manifest fallback skipped — WebView playback active")
                    return@post
                }
                if (streamDelivered && lastExtracted?.licenseUrl?.isNotEmpty() == true) return@post
                manifestRequiresDrm = manifestRequiresDrm || probe.hasWidevine || shakaDrmSignaled
                if (license.isEmpty() && shouldWaitForLicense(manifest) && !extended) {
                    Log.d(TAG, "Encrypted MPD — waiting for gateway license")
                    scheduleExtendedManifestFallback()
                    return@post
                }
                if (license.isEmpty() && shouldWaitForLicense(manifest) && extended) {
                    if (playbackStarted || exoPromotionDeferred) {
                        Log.d(TAG, "No native license URL — keeping in-WebView Widevine playback")
                        return@post
                    }
                    webView?.evaluateJavascript(PhpWebViewSupport.gatewayHtmlProbeScript(), null)
                    webView?.evaluateJavascript(PhpWebViewSupport.gatewayStreamExtractScript(), null)
                    Log.w(TAG, "No license after extended wait — cannot play encrypted stream")
                    reportErrorOnce("unavailable")
                    return@post
                }
                Log.d(
                    TAG,
                    "JS extract timeout — manifest fallback (widevine=${license.isNotEmpty()}, extended=$extended)",
                )
                deliverExtractedStream(
                    PhpGatewayExtractor.Extracted(
                        streamUrl = manifest,
                        isHls = manifest.contains(".m3u8", ignoreCase = true),
                        licenseUrl = license,
                    ),
                )
            }
        }
    }

    private fun probeManifestDrmAsync(manifestUrl: String) {
        val session = currentSession ?: return
        worker.execute {
            var headers = manifestProbeHeaders(session, manifestUrl)
            var probe = DashDrmProbe.probe(manifestUrl, headers)
            if (!probe.hasWidevine && probe.licenseUrl.isEmpty()) {
                try {
                    Thread.sleep(900)
                    CookieManager.getInstance().flush()
                } catch (_: InterruptedException) {
                }
                headers = manifestProbeHeaders(session, manifestUrl)
                probe = DashDrmProbe.probe(manifestUrl, headers)
            }
            mainHandler.post {
                if (released) return@post
                manifestRequiresDrm = manifestRequiresDrm || probe.hasWidevine
                if (probe.licenseUrl.isNotEmpty()) {
                    onLicenseUrlCaptured(probe.licenseUrl, fromProbe = true)
                } else if (probe.hasWidevine) {
                    Log.d(TAG, "MPD is Widevine-encrypted — holding for gateway license URL")
                }
            }
        }
    }

    private fun onLicenseUrlCaptured(url: String, fromProbe: Boolean = false) {
        if (url.isBlank()) return
        if (!StreamUrlClassifier.isLikelyLicenseServerUrl(url)) {
            Log.d(TAG, "Ignoring non-license URL: ${url.take(100)}")
            return
        }
        capturedLicenseUrl = url
        Log.d(TAG, if (fromProbe) "MPD probe captured license URL" else "Captured license URL: ${url.take(100)}")
        val manifest = capturedManifestUrl?.takeIf { it.startsWith("http") } ?: return
        if (!streamDelivered) {
            cancelManifestFallback()
            cancelExtendedManifestFallback()
            deliverExtractedStream(
                PhpGatewayExtractor.Extracted(
                    streamUrl = manifest,
                    isHls = manifest.contains(".m3u8", ignoreCase = true),
                    licenseUrl = url,
                ),
            )
        } else if (lastExtracted?.licenseUrl.isNullOrEmpty()) {
            lastExtracted?.let { prev ->
                deliverExtractedStream(prev.copy(licenseUrl = url))
            }
        }
    }

    private fun cancelManifestFallback() {
        manifestFallbackRunnable?.let { mainHandler.removeCallbacks(it) }
        manifestFallbackRunnable = null
    }

    private fun cancelExtendedManifestFallback() {
        manifestExtendedFallbackRunnable?.let { mainHandler.removeCallbacks(it) }
        manifestExtendedFallbackRunnable = null
    }

    private fun buildHeaders(
        session: StreamSession,
        extracted: PhpGatewayExtractor.Extracted? = null,
    ): Map<String, String> {
        val gateway = session.mpdUrl.trim()
        val base = if (StreamUrlClassifier.isLikelyGatewayUrl(gateway) ||
            StreamUrlClassifier.isPhpLikeUrl(gateway)
        ) {
            GatewayHttpHeaders.forGateway(gateway, session.headers)
        } else {
            LinkedHashMap(session.headers)
        }
        val h = LinkedHashMap(base)
        val token = extracted?.authToken?.takeIf { it.isNotEmpty() } ?: session.token
        if (token.isNotEmpty() && !h.keys.any { it.equals("Authorization", true) }) {
            h["Authorization"] = "Bearer $token"
        }
        if (extracted?.authToken?.isNotEmpty() == true) {
            h["nv-authorizations"] = extracted.authToken
        }
        h.putIfAbsent("User-Agent", PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT)
        capturedManifestHeaders.forEach { (k, v) ->
            if (!h.containsKey(k)) h[k] = v
        }
        return h
    }

    private fun clearKeysForShaka(
        session: StreamSession,
        extracted: PhpGatewayExtractor.Extracted?,
    ): Map<String, String> {
        val keys: List<ClearKey> = when {
            extracted?.clearKeys?.isNotEmpty() == true -> extracted.clearKeys
            !session.drmData.keys.isNullOrEmpty() -> session.drmData.keys!!
            else -> emptyList()
        }
        val map = linkedMapOf<String, String>()
        keys.forEach { ck ->
            val kid = hexToBase64Url(ck.kid)
            val k = hexToBase64Url(ck.k)
            if (kid.isNotEmpty() && k.isNotEmpty()) map[kid] = k
        }
        return map
    }

    private fun hexToBase64Url(hex: String): String {
        val clean = hex.replace(Regex("[^0-9a-fA-F]"), "")
        if (clean.length < 2 || clean.length % 2 != 0) return hex.trim()
        val bytes = ByteArray(clean.length / 2)
        for (i in bytes.indices) {
            bytes[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
            .replace('+', '-').replace('/', '_').trimEnd('=')
    }

    private fun fetchGatewayHtml(url: String, headers: Map<String, String>): String {
        val reqHeaders = HashMap(headers).apply {
            putIfAbsent("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
            putIfAbsent("User-Agent", PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT)
        }
        val client = EamaxHttpDataSource.gatewayFastClient()
        val b = okhttp3.Request.Builder().url(url)
        reqHeaders.forEach { (k, v) -> b.header(k, v) }
        return client.newCall(b.get().build()).execute().use { r ->
            if (!r.isSuccessful) throw IllegalStateException("HTTP ${r.code}")
            r.body?.string() ?: throw IllegalStateException("empty body")
        }
    }

    private fun injectPlayerOnlyUi(view: WebView?) {
        if (released || usingShakaEmbed || view == null) return
        view.evaluateJavascript(PhpWebViewSupport.playerOnlyUiScript(), null)
    }

    private fun handleJsPlaybackError() {
        if (released || errorReported) return
        if (!usingShakaEmbed) return
        if (lastExtracted != null) {
            onShakaFailed?.invoke(lastExtracted!!)
        } else {
            reportErrorOnce("unavailable")
        }
    }

    private fun reportErrorOnce(message: String) {
        if (released || errorReported) return
        errorReported = true
        onError(message)
    }

    private fun ensureGatewayPageReady(w: WebView) {
        if (released || usingShakaEmbed || playbackStarted) return
        injectPlayerOnlyUi(w)
        if (!okoaApiInjected) {
            okoaApiInjected = true
            w.evaluateJavascript(PhpWebViewSupport.eaMaxOkoaQualityApiScript(), null)
            w.evaluateJavascript(PhpWebViewSupport.eaMaxAudioLanguageApiScript(), null)
            w.evaluateJavascript(
                "try{window.__eaMaxSetAudioLanguage&&window.__eaMaxSetAudioLanguage('$preferredAudioLanguage');}catch(e){}",
                null,
            )
        }
        w.evaluateJavascript(PhpWebViewSupport.gatewayPageRecoveryScript(), null)
        w.evaluateJavascript(PhpWebViewSupport.gatewayShakaConfigureHookScript(), null)
        w.evaluateJavascript(PhpWebViewSupport.gatewayShakaHookScript(), null)
        licenseBridge?.injectScript()
        w.alpha = 1f
    }

    /** Widevine gateway with no extractable license URL — play inside WebView, never spam Exo promotion. */
    private fun deferExoPromotionToWebView() {
        if (!exoPromotionDeferred) {
            exoPromotionDeferred = true
            Log.d(TAG, "Encrypted stream without license — staying on in-WebView Widevine")
        }
        stopGatewayExtractLoop()
        webView?.let { ensureGatewayPageReady(it) }
        scheduleWebViewPlaybackMonitor()
    }

    private fun notifyWebViewPlaybackStarted() {
        if (playbackStarted || released) return
        playbackStarted = true
        webViewPaused = false
        cancelPlaybackWatchdog()
        cancelManifestFallback()
        cancelExtendedManifestFallback()
        cancelLicenseHeadersWait()
        cancelPlaybackMonitor()
        cancelUiInjectionRunnables()
        stopGatewayExtractLoop()
        webView?.alpha = 1f
        applyPreferredAudioLanguage()
        if (!userPickedOkoaQuality) {
            applyDefaultOkoa360PostPlayback()
        }
        onPlaybackStateChanged(PlaybackState.PLAYING)
    }

    /** Apply 360p default once the gateway player is actually playing (Shaka/hls ready). */
    private fun applyDefaultOkoa360PostPlayback() {
        val w = webView ?: return
        injectOkoaQuality("360", fromUser = false)
        scheduleOkoaQualityRetries("360", onlyIfDefault = true)
        listOf(400L, 1200L, 2500L).forEach { delayMs ->
            val r = Runnable {
                if (released || userPickedOkoaQuality) return@Runnable
                w.evaluateJavascript(PhpWebViewSupport.eaMaxOkoaQualityApiScript(), null)
                w.evaluateJavascript(
                    "try{window.__eaMaxOkoaApplyStartup360&&window.__eaMaxOkoaApplyStartup360();}catch(e){}",
                    null,
                )
            }
            defaultOkoaRunnables.add(r)
            mainHandler.postDelayed(r, delayMs)
        }
    }

    private fun scheduleWebViewPlaybackMonitor() {
        cancelPlaybackMonitor()
        var attempts = 0
        val monitor = object : Runnable {
            override fun run() {
                if (released || playbackStarted) return
                val w = webView ?: return
                w.evaluateJavascript(VIDEO_PLAYING_PROBE_JS) { result ->
                    if (released || playbackStarted) return@evaluateJavascript
                    if (result?.contains("playing") == true) {
                        mainHandler.post { notifyWebViewPlaybackStarted() }
                    } else if (++attempts < 80) {
                        mainHandler.postDelayed(this, 400L)
                    }
                }
            }
        }
        playbackMonitorRunnable = monitor
        mainHandler.postDelayed(monitor, 350L)
    }

    private fun cancelPlaybackMonitor() {
        playbackMonitorRunnable?.let { mainHandler.removeCallbacks(it) }
        playbackMonitorRunnable = null
    }

    private fun stopGatewayExtractLoop() {
        if (gatewayExtractLocked) return
        gatewayExtractLocked = true
        cancelGatewayExtractRunnables()
        cancelManifestFallback()
        cancelExtendedManifestFallback()
        cancelLicenseHeadersWait()
        webView?.evaluateJavascript(
            "try{window.__eaMaxExtractSent=true;window.__eaMaxPlaybackLocked=true;" +
                "if(window.__eaMaxOkoaRetryId){clearInterval(window.__eaMaxOkoaRetryId);window.__eaMaxOkoaRetryId=null;}" +
                "}catch(e){}",
            null,
        )
    }

    /** At most 3 lightweight retries — first extract usually succeeds or triggers lock. */
    private fun scheduleGatewayExtractRetries(w: WebView) {
        cancelGatewayExtractRunnables()
        listOf(400L, 1200L).forEach { delayMs ->
            val r = Runnable {
                if (released || usingShakaEmbed || gatewayExtractLocked || streamDelivered) return@Runnable
                w.evaluateJavascript(PhpWebViewSupport.gatewayStreamExtractScript(), null)
            }
            gatewayExtractRunnables.add(r)
            w.postDelayed(r, delayMs)
        }
    }

    private fun cancelGatewayExtractRunnables() {
        gatewayExtractRunnables.forEach { mainHandler.removeCallbacks(it) }
        gatewayExtractRunnables.clear()
    }

    private fun scheduleUiInjection(target: WebView) {
        if (playbackStarted || gatewayExtractLocked) return
        cancelUiInjectionRunnables()
        listOf(100L, 600L).forEach { delayMs ->
            val r = Runnable {
                if (playbackStarted || gatewayExtractLocked) return@Runnable
                injectPlayerOnlyUi(target)
            }
            uiInjectRunnables.add(r)
            target.postDelayed(r, delayMs)
        }
    }

    private fun cancelUiInjectionRunnables() {
        uiInjectRunnables.forEach { mainHandler.removeCallbacks(it) }
        uiInjectRunnables.clear()
    }

    private fun schedulePlaybackWatchdog() {
        cancelPlaybackWatchdog()
        playbackWatchdog = Runnable {
            if (released || playbackStarted) return@Runnable
            val w = webView
            if (w != null && !usingShakaEmbed) {
                w.evaluateJavascript(VIDEO_PLAYING_PROBE_JS) { result ->
                    if (released || playbackStarted) return@evaluateJavascript
                    if (result?.contains("playing") == true) {
                        mainHandler.post { notifyWebViewPlaybackStarted() }
                    } else if (exoPromotionDeferred) {
                        scheduleWebViewPlaybackMonitor()
                    } else {
                        reportErrorOnce("unavailable")
                    }
                }
                return@Runnable
            }
            if (usingShakaEmbed && lastExtracted != null) {
                onShakaFailed?.invoke(lastExtracted!!)
            } else {
                reportErrorOnce("unavailable")
            }
        }.also { mainHandler.postDelayed(it, 22_000L) }
    }

    private fun cancelPlaybackWatchdog() {
        playbackWatchdog?.let { mainHandler.removeCallbacks(it) }
        playbackWatchdog = null
    }

    fun play() {
        webView?.evaluateJavascript(
            "(function(){var v=document.querySelector('video');if(v){var p=v.play();if(p&&p.catch)p.catch(function(){});}})();",
            null,
        )
    }

    fun pause() {
        webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause();})();", null)
    }

    fun stop() {
        webView?.stopLoading()
        webView?.loadUrl("about:blank")
    }

    fun setQuality(quality: StreamQuality, fromUser: Boolean = true) {
        if (!fromUser && userPickedOkoaQuality) return
        if (fromUser) {
            userPickedOkoaQuality = true
            cancelDefaultOkoaRunnables()
        }
        val mode = when (quality) {
            StreamQuality.AUTO -> "auto"
            else -> quality.height.toString()
        }
        injectOkoaQuality(mode, fromUser)
        scheduleOkoaQualityRetries(mode, onlyIfDefault = !fromUser)
    }

    private fun injectOkoaQuality(mode: String, fromUser: Boolean = false) {
        val w = webView ?: return
        w.evaluateJavascript(PhpWebViewSupport.eaMaxOkoaQualityApiScript(), null)
        w.evaluateJavascript(
            "try{window.__eaMaxOkoaSetQuality&&window.__eaMaxOkoaSetQuality('$mode',${if (fromUser) "true" else "false"});}catch(e){}",
            null,
        )
    }

    private fun scheduleOkoaQualityRetries(mode: String, onlyIfDefault: Boolean = false) {
        val delays = if (onlyIfDefault) {
            listOf(600L, 1500L, 3000L)
        } else {
            listOf(0L, 400L, 800L, 1600L, 3200L, 5000L)
        }
        delays.forEach { delayMs ->
            mainHandler.postDelayed({
                if (released) return@postDelayed
                if (onlyIfDefault && userPickedOkoaQuality) return@postDelayed
                if (!onlyIfDefault && !userPickedOkoaQuality) return@postDelayed
                injectOkoaQuality(mode, fromUser = !onlyIfDefault)
            }, delayMs)
        }
    }

    private fun cancelDefaultOkoaRunnables() {
        defaultOkoaRunnables.forEach { mainHandler.removeCallbacks(it) }
        defaultOkoaRunnables.clear()
    }

    private fun applyDefaultOkoa360(target: WebView) {
        if (userPickedOkoaQuality || released) return
        val startupJs =
            "try{window.__eaMaxOkoaApplyStartup360&&window.__eaMaxOkoaApplyStartup360();}catch(e){}"
        listOf(300L, 900L, 1800L).forEach { delayMs ->
            val r = Runnable {
                if (userPickedOkoaQuality || released) return@Runnable
                target.evaluateJavascript(PhpWebViewSupport.eaMaxOkoaQualityApiScript(), null)
                target.evaluateJavascript(startupJs, null)
            }
            defaultOkoaRunnables.add(r)
            target.postDelayed(r, delayMs)
        }
    }

    fun setAudioLanguage(language: String) {
        preferredAudioLanguage = AudioLanguageSupport.normalize(language)
        applyPreferredAudioLanguage()
    }

    private fun applyPreferredAudioLanguage() {
        val w = webView ?: return
        val lang = preferredAudioLanguage
        w.evaluateJavascript(PhpWebViewSupport.eaMaxAudioLanguageApiScript(), null)
        w.evaluateJavascript(
            "try{window.__eaMaxSetAudioLanguage&&window.__eaMaxSetAudioLanguage('$lang');}catch(e){}",
            null,
        )
        scheduleAudioLanguageRetries(lang)
    }

    private fun scheduleAudioLanguageRetries(lang: String) {
        cancelAudioLanguageRunnables()
        listOf(800L, 1600L, 3200L).forEach { delayMs ->
            val r = Runnable {
                if (released) return@Runnable
                val target = webView ?: return@Runnable
                target.evaluateJavascript(PhpWebViewSupport.eaMaxAudioLanguageApiScript(), null)
                target.evaluateJavascript(
                    "try{window.__eaMaxSetAudioLanguage&&window.__eaMaxSetAudioLanguage('$lang');}catch(e){}",
                    null,
                )
            }
            audioLanguageRunnables.add(r)
            mainHandler.postDelayed(r, delayMs)
        }
    }

    private fun cancelAudioLanguageRunnables() {
        audioLanguageRunnables.forEach { mainHandler.removeCallbacks(it) }
        audioLanguageRunnables.clear()
    }

    fun release() {
        released = true
        cancelManifestFallback()
        cancelExtendedManifestFallback()
        cancelGatewayExtractRunnables()
        cancelPlaybackMonitor()
        cancelDefaultOkoaRunnables()
        cancelUiInjectionRunnables()
        cancelPlaybackWatchdog()
        cancelAudioLanguageRunnables()
        webView?.apply {
            stopLoading()
            clearHistory()
            clearCache(true)
            removeJavascriptInterface("ShakaPlayerBridge")
            removeJavascriptInterface(WebViewLicenseBridge.JS_INTERFACE_NAME)
            destroy()
        }
        webView = null
        licenseBridge = null
    }

    fun getWebView(): WebView? = webView

    fun refreshSession(newSession: StreamSession) {
        currentSession = newSession
        initialize(newSession)
    }
}

class WebViewJsInterface(
    private val onPlaybackStateChanged: (PlaybackState) -> Unit,
    private val onError: (String) -> Unit,
    private val onStreamExtracted: ((PhpGatewayExtractor.Extracted) -> Unit)? = null,
    private val onHtmlProbe: ((String) -> Unit)? = null,
) {
    @android.webkit.JavascriptInterface
    fun onPlaybackStarted() {
        onPlaybackStateChanged(PlaybackState.PLAYING)
    }

    @android.webkit.JavascriptInterface
    fun onPlaybackPaused() {
        onPlaybackStateChanged(PlaybackState.PAUSED)
    }

    @android.webkit.JavascriptInterface
    fun onPlaybackTick(seconds: Int) {}

    @android.webkit.JavascriptInterface
    fun onPlaybackError(@Suppress("UNUSED_PARAMETER") errorMessage: String) {
        onError("unavailable")
    }

    @android.webkit.JavascriptInterface
    fun onPlaybackEnded() {
        onPlaybackStateChanged(PlaybackState.ENDED)
    }

    @android.webkit.JavascriptInterface
    fun onGatewayHtmlProbe(html: String) {
        if (html.isBlank()) return
        onHtmlProbe?.invoke(html)
    }

    @android.webkit.JavascriptInterface
    fun onGatewayStreamExtracted(json: String) {
        try {
            val o = org.json.JSONObject(json)
            val streamUrl = o.optString("streamUrl", "").trim()
            val licenseHeaders = parseLicenseHeadersJson(o.optJSONObject("licenseHeaders"))
            if (streamUrl.isEmpty() && licenseHeaders.isEmpty()) return
            val extracted = PhpGatewayExtractor.Extracted(
                streamUrl = streamUrl,
                isHls = o.optBoolean("isHls", streamUrl.contains(".m3u8", ignoreCase = true)),
                licenseUrl = o.optString("licenseUrl", "").trim(),
                authToken = o.optString("authToken", "").trim(),
                clearKeys = parseClearKeys(o.optString("clearKeyRaw", "").trim()),
                licenseHeaders = licenseHeaders,
            )
            onStreamExtracted?.invoke(extracted)
        } catch (_: Exception) {
        }
    }

    private fun parseClearKeys(clearKeyRaw: String): List<ClearKey> {
        if (!clearKeyRaw.contains(':')) return emptyList()
        val parts = clearKeyRaw.split(':', limit = 2)
        return listOf(
            ClearKey(
                kid = parts.getOrElse(0) { "" }.trim(),
                k = parts.getOrElse(1) { "" }.trim(),
            ),
        )
    }

    private fun parseLicenseHeadersJson(obj: org.json.JSONObject?): Map<String, String> {
        if (obj == null) return emptyMap()
        val out = linkedMapOf<String, String>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val v = obj.optString(k, "").trim()
            if (k.isNotBlank() && v.isNotBlank()) out[k] = v
        }
        return out
    }
}
