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
    }

    private var webView: WebView? = null
    private var currentSession: StreamSession? = null
    private var jsInterface: WebViewJsInterface? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val uiInjectRunnables = mutableListOf<Runnable>()
    private var playbackWatchdog: Runnable? = null
    private var playbackStarted = false
    private var userPickedOkoaQuality = false
    private var lastExtracted: PhpGatewayExtractor.Extracted? = null
    private var usingShakaEmbed = false
    private var released = false
    private var errorReported = false
    private var okoaApiInjected = false
    private var audioLangApiInjected = false
    private var preferredAudioLanguage: String? = null
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
    private var gatewayWatchdogExtensions = 0
    private var widevineWebViewLocked = false
    private var widevineDeferLogged = false

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
        gatewayWatchdogExtensions = 0
        widevineWebViewLocked = false
        widevineDeferLogged = false
        cancelLicenseHeadersWait()
        cancelManifestFallback()
        currentSession = streamSession
        playbackStarted = false
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
                StreamUrlClassifier.isLikelyIptvLiveUrl(url) ||
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
        w.alpha = 1f
        cancelPlaybackWatchdog()

        val headers = buildHeaders(session, extracted)
        val license = extracted?.licenseUrl?.takeIf { it.isNotEmpty() } ?: session.licenseUrl
        val html = PhpWebViewSupport.buildShakaPlayerHtml(
            streamUrl = streamUrl,
            headers = headers,
            clearKeys = clearKeysForShaka(session, extracted),
            licenseUrl = license,
            maxHeight = defaultOkoaMaxHeight(),
        )
        w.loadDataWithBaseURL(
            "https://player.eamax.local/",
            html,
            "text/html",
            "UTF-8",
            null,
        )
        schedulePlaybackWatchdog()
    }

    private fun loadGatewayFallback(gatewayUrl: String) {
        cancelUiInjectionRunnables()
        usingShakaEmbed = false
        playbackStarted = false
        scheduleGatewayHtmlPrefetch(gatewayUrl)
        webView?.loadUrl(gatewayUrl)
        schedulePlaybackWatchdog()
    }

    /** Fire stream/DRM extract scripts ASAP (gateway pages). */
    private fun fireGatewayExtractBurst(webView: WebView, includeHtmlProbe: Boolean = true) {
        if (released || usingShakaEmbed) return
        webView.evaluateJavascript(PhpWebViewSupport.gatewayShakaPolyfillScript(), null)
        webView.evaluateJavascript(PhpWebViewSupport.gatewayShakaConfigureHookScript(), null)
        webView.evaluateJavascript(PhpWebViewSupport.gatewayShakaHookScript(), null)
        webView.evaluateJavascript(PhpWebViewSupport.gatewayStreamExtractScript(), null)
        webView.evaluateJavascript(PhpWebViewSupport.readGatewayShakaDrmScript(), null)
        if (includeHtmlProbe) {
            webView.evaluateJavascript(PhpWebViewSupport.gatewayHtmlProbeScript(), null)
        }
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

            setDownloadListener { url, _, _, _, _ ->
                Log.d(TAG, "Blocked WebView download (in-app playback only): $url")
            }

            installDocumentStartHooks(this)

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: android.webkit.WebResourceRequest?,
                ): Boolean {
                    val url = request?.url?.toString().orEmpty()
                    if (url.isEmpty()) return false
                    val lower = url.lowercase()
                    if (lower.startsWith("intent:") ||
                        lower.startsWith("market:") ||
                        lower.startsWith("vlc:") ||
                        lower.startsWith("mx:") ||
                        lower.startsWith("file:") ||
                        lower.startsWith("content:")
                    ) {
                        Log.d(TAG, "Blocked external navigation: $url")
                        return true
                    }
                    return false
                }

                override fun onPageStarted(view: WebView?, startedUrl: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, startedUrl, favicon)
                    if (!usingShakaEmbed) {
                        view?.alpha = 0f
                        view?.evaluateJavascript(PhpWebViewSupport.gatewayShakaPolyfillScript(), null)
                        view?.evaluateJavascript(PhpWebViewSupport.gatewayShakaConfigureHookScript(), null)
                        view?.evaluateJavascript(PhpWebViewSupport.gatewayShakaHookScript(), null)
                        val startedView = view
                        startedView?.post {
                            if (!released && !usingShakaEmbed && startedView != null) {
                                fireGatewayExtractBurst(startedView, includeHtmlProbe = false)
                            }
                        }
                    }
                }

                override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                    super.onPageFinished(view, finishedUrl)
                    val w = view ?: return
                    if (usingShakaEmbed) return
                    val gateway = currentSession?.mpdUrl ?: finishedUrl.orEmpty()
                    w.evaluateJavascript(PhpWebViewSupport.gatewayCdnRefererFixScript(gateway), null)
                    injectPlayerOnlyUi(w)
                    if (!okoaApiInjected) {
                        okoaApiInjected = true
                        w.evaluateJavascript(PhpWebViewSupport.eaMaxOkoaQualityApiScript(), null)
                    }
                    w.evaluateJavascript(PhpWebViewSupport.gatewayPageRecoveryScript(), null)
                    fireGatewayExtractBurst(w)
                    licenseBridge?.injectScript()
                    listOf(0L, 80L, 200L, 500L).forEach { delayMs ->
                        w.postDelayed({
                            if (!released && !usingShakaEmbed && !streamDelivered) {
                                fireGatewayExtractBurst(w, includeHtmlProbe = delayMs >= 200L)
                            }
                        }, delayMs)
                    }
                    scheduleUiInjection(w)
                    scheduleManifestFallback()
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
                                if (!StreamUrlClassifier.likelyRequiresWidevine(url)) {
                                    mainHandler.post {
                                        deliverExtractedStream(
                                            PhpGatewayExtractor.Extracted(
                                                streamUrl = url,
                                                isHls = url.contains(".m3u8", ignoreCase = true),
                                            ),
                                        )
                                    }
                                }
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
                    if (msg.contains("isBrowserSupported", ignoreCase = true) &&
                        !usingShakaEmbed && !released
                    ) {
                        webView?.evaluateJavascript(PhpWebViewSupport.gatewayShakaPolyfillScript(), null)
                        webView?.evaluateJavascript(
                            """
                            (function(){
                              try {
                                if (window.shaka && window.shaka.Player &&
                                    typeof window.shaka.Player.isBrowserSupported !== 'function') {
                                  window.shaka.Player.isBrowserSupported = function(){
                                    try { return Promise.resolve(true); } catch(e) { return true; }
                                  };
                                }
                                ['initPlayer','startPlayer','initShaka','loadStream'].forEach(function(fn){
                                  try { if (typeof window[fn]==='function') window[fn](); } catch(e){}
                                });
                              } catch(e) {}
                              true;
                            })();
                            """.trimIndent(),
                            null,
                        )
                        val recoveryView = webView
                        recoveryView?.post {
                            if (!released && !usingShakaEmbed && recoveryView != null) {
                                fireGatewayExtractBurst(recoveryView)
                            }
                        }
                    }
                    Log.d(TAG, "[WebView] $msg")
                    return true
                }
            }
            jsInterface = WebViewJsInterface(
                onPlaybackStateChanged = { state ->
                    if (state == PlaybackState.BUFFERING && usingShakaEmbed) {
                        webView?.alpha = 1f
                    }
                    notifyPlaybackState(state)
                },
                onError = { handleJsPlaybackError() },
                onStreamExtracted = { extracted ->
                    deliverExtractedStream(extracted)
                },
                onHtmlProbe = { html ->
                    probeHtmlForGatewayExtract(html)
                },
            )
            addJavascriptInterface(jsInterface!!, "ShakaPlayerBridge")
            licenseBridge = WebViewLicenseBridge(this)
        }
    }

    fun getLicenseBridge(): WebViewLicenseBridge? = licenseBridge

    fun wasPlaybackStarted(): Boolean = playbackStarted && !released

    fun restoreWebViewVisibility() {
        webView?.alpha = 1f
    }

    /** Shaka/HLS fire PLAYING on every quality switch — notify native only once per load. */
    private fun notifyPlaybackState(state: PlaybackState) {
        if (state == PlaybackState.PLAYING) {
            if (playbackStarted) return
            playbackStarted = true
            cancelPlaybackWatchdog()
            webView?.alpha = 1f
        }
        onPlaybackStateChanged(state)
    }

    private fun defaultOkoaMaxHeight(): Int = 360

    /** Stop WebView/Shaka audio before native Exo takes over (prevents doubled sound). */
    fun suspendPlayback() {
        val w = webView ?: return
        w.onPause()
        w.evaluateJavascript(PhpWebViewSupport.suspendWebViewPlaybackScript(), null)
    }

    private fun scheduleGatewayHtmlPrefetch(gatewayUrl: String) {
        if (!gatewayUrl.startsWith("http")) return
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
        if (released || (streamDelivered && lastExtracted?.licenseUrl?.isNotEmpty() == true)) return
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

        if (enriched.licenseUrl.isEmpty() &&
            shouldWaitForLicense(enriched.streamUrl) &&
            !streamDelivered
        ) {
            val sameStream = lastExtracted?.streamUrl == enriched.streamUrl
            lastExtracted = enriched

            if (widevineWebViewLocked || (sameStream && playbackStarted)) {
                return
            }

            if (playbackStarted) {
                widevineWebViewLocked = true
                streamDelivered = true
                cancelManifestFallback()
                cancelExtendedManifestFallback()
                cancelLicenseHeadersWait()
                cancelPlaybackWatchdog()
                if (!widevineDeferLogged) {
                    widevineDeferLogged = true
                    Log.d(TAG, "Azam/Widevine playing in WebView — native Exo skipped")
                }
                return
            }

            if (!widevineDeferLogged) {
                widevineDeferLogged = true
                Log.d(TAG, "Encrypted stream without license — waiting for WebView Shaka DRM")
            }
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
        if (!StreamUrlClassifier.isLikelyLicenseServerUrl(licenseUrl) &&
            !StreamUrlClassifier.isGatewayCapturedLicenseUrl(licenseUrl)
        ) {
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
        }.also { mainHandler.postDelayed(it, 200L) }
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
        cancelManifestFallback()
        manifestFallbackRunnable = Runnable {
            if (released || streamDelivered) return@Runnable
            tryManifestFallback(extended = false)
        }.also { mainHandler.postDelayed(it, 400L) }
    }

    private fun scheduleExtendedManifestFallback() {
        cancelExtendedManifestFallback()
        manifestExtendedFallbackRunnable = Runnable {
            if (released || streamDelivered) return@Runnable
            tryManifestFallback(extended = true)
        }.also { mainHandler.postDelayed(it, 900L) }
    }

    private fun shouldWaitForLicense(streamUrl: String): Boolean {
        if (shakaDrmSignaled || manifestRequiresDrm) return true
        return StreamUrlClassifier.likelyRequiresWidevine(streamUrl)
    }

    private fun installDocumentStartHooks(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        try {
            val gateway = currentSession?.mpdUrl.orEmpty()
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                PhpWebViewSupport.gatewayDocumentStartScript(
                    gatewayUrl = gateway,
                    defaultMaxHeight = defaultOkoaMaxHeight(),
                ),
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
        }, 40L)
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
                if (streamDelivered && lastExtracted?.licenseUrl?.isNotEmpty() == true) return@post
                manifestRequiresDrm = manifestRequiresDrm || probe.hasWidevine || shakaDrmSignaled
                if (license.isEmpty() && shouldWaitForLicense(manifest) && !extended) {
                    Log.d(TAG, "Encrypted MPD — waiting for gateway license")
                    scheduleExtendedManifestFallback()
                    return@post
                }
                if (license.isEmpty() && shouldWaitForLicense(manifest) && extended) {
                    attemptReadDrmFromGatewayPage(gateway, manifest)
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
                    Thread.sleep(100)
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
        if (!StreamUrlClassifier.isLikelyLicenseServerUrl(url) &&
            !StreamUrlClassifier.isGatewayCapturedLicenseUrl(url)
        ) {
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
        val reqHeaders = GatewayHttpHeaders.forGateway(url, headers).toMutableMap().apply {
            putIfAbsent("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
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
        if (playbackStarted || streamDelivered) {
            Log.d(TAG, "Ignoring Shaka error — playback started or stream handed to Exo")
            return
        }
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

    private fun scheduleUiInjection(target: WebView) {
        cancelUiInjectionRunnables()
        listOf(100L, 400L, 900L, 1800L, 3500L, 6000L).forEach { delayMs ->
            val r = Runnable { injectPlayerOnlyUi(target) }
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
        gatewayWatchdogExtensions = 0
        schedulePlaybackWatchdogInternal(initial = true)
    }

    private fun schedulePlaybackWatchdogInternal(initial: Boolean) {
        val delayMs = if (initial) 12_000L else 10_000L
        playbackWatchdog = Runnable {
            if (released || playbackStarted) return@Runnable
            if (streamDelivered) {
                Log.d(TAG, "Watchdog: stream extracted — waiting for native Exo handoff")
                return@Runnable
            }
            if (!usingShakaEmbed && isGatewayDrmPending()) {
                if (gatewayWatchdogExtensions < 3) {
                    gatewayWatchdogExtensions++
                    Log.d(TAG, "Watchdog: gateway DRM pending — extension $gatewayWatchdogExtensions/3")
                    reinjectGatewayPlaybackHelpers()
                    schedulePlaybackWatchdogInternal(initial = false)
                    return@Runnable
                }
            }
            if (usingShakaEmbed && lastExtracted != null) {
                onShakaFailed?.invoke(lastExtracted!!)
            } else if (!usingShakaEmbed && isGatewayDrmPending()) {
                scheduleFinalGatewayPlaybackWatchdog()
            } else {
                reportErrorOnce("unavailable")
            }
        }.also { mainHandler.postDelayed(it, delayMs) }
    }

    private fun isGatewayDrmPending(): Boolean =
        lastExtracted != null ||
            capturedManifestUrl != null ||
            shakaDrmSignaled ||
            manifestRequiresDrm

    private fun reinjectGatewayPlaybackHelpers() {
        val w = webView ?: return
        val gateway = currentSession?.mpdUrl.orEmpty()
        w.evaluateJavascript(PhpWebViewSupport.gatewayShakaPolyfillScript(), null)
        w.evaluateJavascript(PhpWebViewSupport.gatewayCdnRefererFixScript(gateway), null)
        w.evaluateJavascript(PhpWebViewSupport.gatewayPageRecoveryScript(), null)
        w.evaluateJavascript(PhpWebViewSupport.gatewayStreamExtractScript(), null)
        w.evaluateJavascript(PhpWebViewSupport.gatewayShakaHookScript(), null)
        injectPlayerOnlyUi(w)
    }

    private fun attemptReadDrmFromGatewayPage(gateway: String, manifest: String) {
        reinjectGatewayPlaybackHelpers()
        webView?.evaluateJavascript(PhpWebViewSupport.readGatewayShakaDrmScript()) { raw ->
            if (released || playbackStarted) return@evaluateJavascript
            val license = parseDrmJsonField(raw, "licenseUrl")
            val stream = parseDrmJsonField(raw, "streamUrl").ifEmpty { manifest }
            if (license.isNotEmpty()) {
                Log.d(TAG, "Live Shaka DRM read — license captured from gateway page")
                onLicenseUrlCaptured(license)
                return@evaluateJavascript
            }
            Log.w(TAG, "No license after extended wait — keeping gateway WebView playback")
            scheduleFinalGatewayPlaybackWatchdog()
        }
    }

    private fun parseDrmJsonField(raw: String?, key: String): String {
        if (raw.isNullOrBlank() || raw == "null") return ""
        return try {
            var s = raw.trim()
            if (s.length >= 2 && s.first() == '"' && s.last() == '"') {
                s = s.substring(1, s.length - 1)
                    .replace("\\\"", "\"")
                    .replace("\\\\", "\\")
            }
            org.json.JSONObject(s).optString(key, "").trim()
        } catch (_: Exception) {
            Regex("""\"$key\"\s*:\s*\"([^\"]*)\"""")
                .find(raw ?: "")?.groupValues?.getOrNull(1)?.trim().orEmpty()
        }
    }

    private fun scheduleFinalGatewayPlaybackWatchdog() {
        mainHandler.postDelayed({
            if (released || playbackStarted || errorReported) return@postDelayed
            reinjectGatewayPlaybackHelpers()
            webView?.evaluateJavascript(PhpWebViewSupport.readGatewayShakaDrmScript()) { raw ->
                if (released || playbackStarted || errorReported) return@evaluateJavascript
                val license = parseDrmJsonField(raw, "licenseUrl")
                if (license.isNotEmpty()) {
                    onLicenseUrlCaptured(license)
                    return@evaluateJavascript
                }
                mainHandler.postDelayed({
                    if (released || playbackStarted || errorReported) return@postDelayed
                    if (isAzamGatewayPlayback()) {
                        Log.d(TAG, "Azam gateway — extending playback wait")
                        reinjectGatewayPlaybackHelpers()
                        mainHandler.postDelayed({
                            if (!released && !playbackStarted && !errorReported) {
                                reportErrorOnce("unavailable")
                            }
                        }, 20_000L)
                    } else {
                        reportErrorOnce("unavailable")
                    }
                }, 15_000L)
            }
        }, 3_000L)
    }

    private fun isAzamGatewayPlayback(): Boolean {
        val url = currentSession?.mpdUrl.orEmpty()
        val manifest = capturedManifestUrl.orEmpty()
        return StreamUrlClassifier.likelyRequiresWidevine(manifest) ||
            url.contains("mpilalivetv", ignoreCase = true) ||
            url.contains("azamtvltd", ignoreCase = true)
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
        if (fromUser) {
            userPickedOkoaQuality = true
        }
        val mode = when (quality) {
            StreamQuality.AUTO -> "auto"
            else -> quality.height.toString()
        }
        injectOkoaQuality(mode, fromUser)
    }

    private fun injectOkoaQuality(mode: String, fromUser: Boolean = false) {
        val w = webView ?: return
        if (!okoaApiInjected) {
            okoaApiInjected = true
            w.evaluateJavascript(PhpWebViewSupport.eaMaxOkoaQualityApiScript(), null)
        }
        val fromUserJs = if (fromUser) "true" else "false"
        w.evaluateJavascript(
            "try{window.__eaMaxDefaultMaxH=${defaultOkoaMaxHeight()};window.__eaMaxOkoaSetQuality&&window.__eaMaxOkoaSetQuality('$mode',$fromUserJs);}catch(e){}",
            null,
        )
    }

    fun setAudioLanguage(language: String) {
        val lang = AudioLanguageSupport.normalize(language)
        preferredAudioLanguage = lang
        injectAudioLanguage(lang)
    }

    private fun injectAudioLanguage(lang: String) {
        val w = webView ?: return
        if (!audioLangApiInjected) {
            audioLangApiInjected = true
            w.evaluateJavascript(PhpWebViewSupport.eaMaxAudioLanguageApiScript(), null)
        }
        val safeLang = lang.replace("\\", "\\\\").replace("'", "\\'")
        w.evaluateJavascript(
            "try{window.__eaMaxSetAudioLanguage&&window.__eaMaxSetAudioLanguage('$safeLang');}catch(e){}",
            null,
        )
    }

    fun release() {
        released = true
        cancelManifestFallback()
        cancelExtendedManifestFallback()
        cancelUiInjectionRunnables()
        cancelPlaybackWatchdog()
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
    private var gatewayExtractLogged = false

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
            if (streamUrl.isNotEmpty() && licenseHeaders.isEmpty()) {
                val lic = o.optString("licenseUrl", "").trim()
                if (lic.isNotEmpty() || o.optString("clearKeyRaw", "").isNotBlank()) {
                    gatewayExtractLogged = false
                } else if (StreamUrlClassifier.likelyRequiresWidevine(streamUrl)) {
                    if (gatewayExtractLogged) return
                    gatewayExtractLogged = true
                }
            }
            if (streamUrl.isNotEmpty()) {
                Log.d("WebViewEngine", "JS gateway extract: ${streamUrl.take(80)}...")
            } else if (licenseHeaders.isNotEmpty()) {
                Log.d("WebViewEngine", "JS captured license headers: ${licenseHeaders.keys.joinToString()}")
            }
            val clearKeyRaw = o.optString("clearKeyRaw", "").trim()
            val clearKeys = if (clearKeyRaw.contains(':')) {
                val parts = clearKeyRaw.split(':', limit = 2)
                listOf(
                    ClearKey(
                        kid = parts.getOrElse(0) { "" }.trim(),
                        k = parts.getOrElse(1) { "" }.trim(),
                    ),
                )
            } else {
                emptyList()
            }
            val extracted = PhpGatewayExtractor.Extracted(
                streamUrl = streamUrl,
                isHls = o.optBoolean("isHls", streamUrl.contains(".m3u8", ignoreCase = true)),
                licenseUrl = o.optString("licenseUrl", "").trim(),
                authToken = o.optString("authToken", "").trim(),
                clearKeys = clearKeys,
                licenseHeaders = licenseHeaders,
            )
            onStreamExtracted?.invoke(extracted)
        } catch (_: Exception) {
        }
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
