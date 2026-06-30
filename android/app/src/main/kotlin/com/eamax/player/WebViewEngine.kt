package com.eamax.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.StreamQuality
import com.eamax.domain.model.StreamSession

/**
 * WebView engine for PHP / gateway pages. Quality and audio are applied via
 * [GatewayPlaybackJs] against in-page Shaka / hls.js players.
 */
class WebViewEngine(
    private val context: Context,
    private val onPlaybackStateChanged: (PlaybackState) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var webView: WebView? = null
    private var currentSession: StreamSession? = null
    private var jsInterface: WebViewJsInterface? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private var playbackStarted = false
    private var playbackApisInjected = false
    private var userPickedQuality = false
    private var selectedQuality: StreamQuality = StreamQuality.QUALITY_360P
    private var preferredAudioLanguage = "sw"
    private var lastLoadedAudioLanguage = ""
    private var audioLanguageConfirmed = false
    private var pageLoadGeneration = 0
    private var pageFinishRunnable: Runnable? = null
    private val pendingRunnables = mutableListOf<Runnable>()

    private val DESKTOP_USER_AGENT =
        "ReactNativeVideo/3.0 (Linux;Android 11) ExoPlayerLib/2.10.4"

    companion object {
        private const val TAG = "EaMaxAudio"
        private const val QUALITY_TAG = "EaMaxQuality"
    }

    private fun shouldUseWebView(url: String): Boolean {
        val u = url.trim().lowercase()
        return u.contains(".php") || u.contains(".html") ||
            (u.startsWith("http") && !u.contains(".mpd") && !u.contains(".m3u8"))
    }

    private fun acceptLanguageFor(lang: String): String =
        if (lang == "en") "en-US,en;q=0.9,sw;q=0.8" else "sw-TZ,sw;q=0.9,en;q=0.8"

    private fun buildLoadHeaders(
        session: StreamSession,
        audioLang: String = preferredAudioLanguage,
    ): Map<String, String> {
        val lang = normalizeAudioLanguage(audioLang)
        val h = LinkedHashMap(session.headers)
        if (session.token.isNotBlank() &&
            !h.keys.any { it.equals("Authorization", ignoreCase = true) }
        ) {
            h["Authorization"] = "Bearer ${session.token}"
        }
        h["Accept"] = "text/html,application/xhtml+xml,*/*;q=0.8"
        h["Accept-Language"] = acceptLanguageFor(lang)
        return h
    }

    fun initialize(streamSession: StreamSession) {
        currentSession = streamSession
        playbackStarted = false
        playbackApisInjected = false
        userPickedQuality = false
        preferredAudioLanguage = normalizeAudioLanguage(streamSession.preferredAudioLanguage)
        lastLoadedAudioLanguage = preferredAudioLanguage
        cancelPendingRunnables()

        val url = streamSession.mpdUrl
        val headers = buildLoadHeaders(streamSession, preferredAudioLanguage)
        val isExternalWebPage = shouldUseWebView(url)

        Log.d(TAG, "initialize url=${url.take(60)} audio=$preferredAudioLanguage " +
            "Accept-Language=${headers["Accept-Language"]}")

        try {
            webView = WebView(context).apply {
                setLayerType(View.LAYER_TYPE_HARDWARE, null)

                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
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
                    userAgentString = DESKTOP_USER_AGENT
                }

                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                webViewClient = object : WebViewClient() {
                    override fun onPageStarted(
                        view: WebView?,
                        startedUrl: String?,
                        favicon: android.graphics.Bitmap?,
                    ) {
                        pageLoadGeneration++
                        pageFinishRunnable?.let { mainHandler.removeCallbacks(it) }
                        pageFinishRunnable = null
                        playbackStarted = false
                        playbackApisInjected = false
                        audioLanguageConfirmed = false
                        onPlaybackStateChanged(PlaybackState.BUFFERING)
                    }

                    override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                        super.onPageFinished(view, finishedUrl)
                        if (!isExternalWebPage) return
                        val gen = pageLoadGeneration
                        pageFinishRunnable?.let { mainHandler.removeCallbacks(it) }
                        val r = Runnable {
                            if (gen != pageLoadGeneration) return@Runnable
                            handlePageReady()
                        }
                        pageFinishRunnable = r
                        mainHandler.postDelayed(r, 600)
                    }

                    override fun onReceivedError(
                        view: WebView?,
                        request: android.webkit.WebResourceRequest?,
                        error: android.webkit.WebResourceError?,
                    ) {
                        if (request?.isForMainFrame == true) {
                            onError("WebView Error: ${error?.description}")
                        }
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(
                        consoleMessage: android.webkit.ConsoleMessage?,
                    ): Boolean {
                        Log.d(
                            "ShakaConsole",
                            "[${consoleMessage?.messageLevel()}] ${consoleMessage?.message()}",
                        )
                        return true
                    }
                }

                jsInterface = WebViewJsInterface(
                    onPlaybackStateChanged = onPlaybackStateChanged,
                    onError = onError,
                    onAudioProbe = { wanted, applied ->
                        if (applied && wanted == preferredAudioLanguage) {
                            audioLanguageConfirmed = true
                        }
                    },
                    onQualityProbe = { wanted, maxH, activeH, applied ->
                        if (applied) {
                            Log.d(QUALITY_TAG, "quality confirmed wanted=$wanted maxH=$maxH activeH=$activeH")
                        }
                    },
                )
                addJavascriptInterface(jsInterface!!, "ShakaPlayerBridge")
            }

            val wv = webView ?: return
            headers["User-Agent"]?.let { wv.settings.userAgentString = it }
            if (isExternalWebPage) {
                wv.loadUrl(url, headers)
                onPlaybackStateChanged(PlaybackState.BUFFERING)
            } else {
                wv.loadUrl("about:blank")
            }
        } catch (e: Exception) {
            onError("Failed to initialize WebView: ${e.message}")
        }
    }

    private fun handlePageReady() {
        Log.d(TAG, "page ready audio=$preferredAudioLanguage")
        ensurePlaybackApisInjected()
        nudgeVideoPlay()
        applyQualityAfterPageLoad()
        audioLanguageConfirmed = false
        applyAudioLanguageJs(preferredAudioLanguage, scheduleRetries = true)
        onPlaybackStateChanged(PlaybackState.PLAYING)
        playbackStarted = true
    }

    fun play() = nudgeVideoPlay()

    fun pause() {
        webView?.evaluateJavascript(
            "(function(){try{var v=document.querySelector('video');if(v)v.pause();}catch(e){}})();",
            null,
        )
    }

    fun isPlaying(): Boolean = playbackStarted

    private fun nudgeVideoPlay() {
        webView?.evaluateJavascript(
            "(function(){" +
                "function playIn(doc){" +
                "try{var v=doc.querySelector('video');if(v){var p=v.play();if(p&&p.catch)p.catch(function(){});return true;}}catch(e){}" +
                "var iframes=doc.querySelectorAll('iframe');" +
                "for(var i=0;i<iframes.length;i++){try{var d=iframes[i].contentDocument||iframes[i].contentWindow.document;if(d&&playIn(d))return true;}catch(e){}}" +
                "return false;" +
                "}" +
                "playIn(document);" +
                "})();",
            null,
        )
    }

    fun stop() {
        webView?.stopLoading()
        webView?.loadUrl("about:blank")
    }

    fun setQuality(quality: StreamQuality, fromUser: Boolean = true) {
        if (!fromUser && userPickedQuality) return
        selectedQuality = quality
        if (fromUser) {
            userPickedQuality = true
        }
        val mode = qualityModeFor(quality)
        Log.d(QUALITY_TAG, "setQuality $quality mode=$mode fromUser=$fromUser")
        applyQualityJs(mode, fromUser, scheduleRetries = true)
    }

    private fun qualityModeFor(quality: StreamQuality): String = when (quality) {
        StreamQuality.AUTO -> "auto"
        else -> quality.height.toString()
    }

    private fun applyQualityAfterPageLoad() {
        val mode = if (userPickedQuality) qualityModeFor(selectedQuality) else "360"
        val fromUser = userPickedQuality
        Log.d(QUALITY_TAG, "applyQualityAfterPageLoad mode=$mode fromUser=$fromUser")
        applyQualityJs(mode, fromUser, scheduleRetries = true)
    }

    private fun applyQualityJs(mode: String, fromUser: Boolean, scheduleRetries: Boolean) {
        injectQuality(mode, fromUser)
        if (scheduleRetries) {
            val delays = if (fromUser) {
                listOf(400L, 1000L, 2000L, 4000L, 7000L)
            } else {
                listOf(400L, 1200L, 2500L, 5000L)
            }
            delays.forEach { delayMs ->
                postDelayed({
                    if (!fromUser && userPickedQuality) return@postDelayed
                    injectQuality(mode, fromUser)
                }, delayMs)
            }
        }
    }

    fun setAudioLanguage(language: String) {
        val lang = normalizeAudioLanguage(language)
        val session = currentSession
        val w = webView
        if (session == null || w == null) {
            Log.w(TAG, "setAudioLanguage($lang) ignored — no session/webView")
            return
        }

        Log.d(TAG, "setAudioLanguage request=$lang (loaded=$lastLoadedAudioLanguage)")
        preferredAudioLanguage = lang

        if (shouldUseWebView(session.mpdUrl) && lang != lastLoadedAudioLanguage) {
            cancelPendingRunnables()
            playbackStarted = false
            playbackApisInjected = false
            audioLanguageConfirmed = false
            lastLoadedAudioLanguage = lang
            val headers = buildLoadHeaders(session, lang)
            headers["User-Agent"]?.let { w.settings.userAgentString = it }
            Log.d(TAG, "Reloading gateway for audio=$lang Accept-Language=${headers["Accept-Language"]}")
            w.loadUrl(session.mpdUrl, headers)
            return
        }

        applyAudioLanguageJs(lang, scheduleRetries = true)
    }

    fun release() {
        cancelPendingRunnables()
        pageFinishRunnable?.let { mainHandler.removeCallbacks(it) }
        pageFinishRunnable = null
        webView?.apply {
            stopLoading()
            clearHistory()
            clearCache(true)
            removeJavascriptInterface("ShakaPlayerBridge")
            destroy()
        }
        webView = null
        playbackApisInjected = false
    }

    fun getWebView(): WebView? = webView

    fun refreshSession(newSession: StreamSession) {
        currentSession = newSession
        playbackStarted = false
        playbackApisInjected = false
        preferredAudioLanguage = normalizeAudioLanguage(newSession.preferredAudioLanguage)
        lastLoadedAudioLanguage = preferredAudioLanguage
        val wv = webView ?: return
        val headers = buildLoadHeaders(newSession, preferredAudioLanguage)
        headers["User-Agent"]?.let { wv.settings.userAgentString = it }
        if (shouldUseWebView(newSession.mpdUrl)) {
            wv.loadUrl(newSession.mpdUrl, headers)
        }
    }

    private fun ensurePlaybackApisInjected() {
        val w = webView ?: return
        if (playbackApisInjected) return
        playbackApisInjected = true
        w.evaluateJavascript(GatewayPlaybackJs.eaMaxOkoaQualityApiScript(), null)
        w.evaluateJavascript(GatewayPlaybackJs.eaMaxAudioLanguageApiScript(), null)
    }

    private fun injectQuality(mode: String, fromUser: Boolean) {
        val w = webView ?: return
        ensurePlaybackApisInjected()
        val safeMode = mode.filter { it.isDigit() || it == 'a' || it == 'u' || it == 't' || it == 'o' }
        w.evaluateJavascript(GatewayPlaybackJs.eaMaxOkoaQualityApiScript(), null)
        w.evaluateJavascript(
            "try{window.__eaMaxPreferredAudioLang='${normalizeAudioLanguage(preferredAudioLanguage)}';" +
                "window.__eaMaxOkoaSetQuality&&window.__eaMaxOkoaSetQuality('$safeMode',${if (fromUser) "true" else "false"});}catch(e){}",
            null,
        )
    }

    private fun applyAudioLanguageJs(language: String, scheduleRetries: Boolean) {
        val w = webView ?: return
        val lang = normalizeAudioLanguage(language)
        if (audioLanguageConfirmed && lang == preferredAudioLanguage) return
        ensurePlaybackApisInjected()
        Log.d(TAG, "applyAudioLanguageJs lang=$lang scheduleRetries=$scheduleRetries")
        w.evaluateJavascript(GatewayPlaybackJs.eaMaxAudioLanguageApiScript(), null)
        w.evaluateJavascript(
            "(function(){" +
                "try{" +
                "window.__eaMaxPreferredAudioLang='$lang';" +
                "if(window.__eaMaxSetAudioLanguage){window.__eaMaxSetAudioLanguage('$lang');}" +
                "}catch(e){}" +
                "})();",
            null,
        )
        if (scheduleRetries) {
            listOf(800L, 2000L, 4000L, 7000L).forEach { delayMs ->
                postDelayed({
                    if (audioLanguageConfirmed) return@postDelayed
                    applyAudioLanguageJs(lang, scheduleRetries = false)
                }, delayMs)
            }
        }
    }

    private fun postDelayed(block: () -> Unit, delayMs: Long) {
        val r = Runnable { block() }
        pendingRunnables.add(r)
        mainHandler.postDelayed(r, delayMs)
    }

    private fun cancelPendingRunnables() {
        pendingRunnables.forEach { mainHandler.removeCallbacks(it) }
        pendingRunnables.clear()
    }

    private fun normalizeAudioLanguage(raw: String): String {
        val v = raw.trim().lowercase()
        return if (v == "en" || v.startsWith("en-") || v == "eng") "en" else "sw"
    }
}

class WebViewJsInterface(
    private val onPlaybackStateChanged: (PlaybackState) -> Unit,
    private val onError: (String) -> Unit,
    private val onAudioProbe: (wanted: String, applied: Boolean) -> Unit = { _, _ -> },
    private val onQualityProbe: (wanted: String, maxH: Int, activeH: Int, applied: Boolean) -> Unit =
        { _, _, _, _ -> },
) {
    @android.webkit.JavascriptInterface
    fun onPlaybackStarted() { onPlaybackStateChanged(PlaybackState.PLAYING) }

    @android.webkit.JavascriptInterface
    fun onPlaybackPaused() { onPlaybackStateChanged(PlaybackState.PAUSED) }

    @android.webkit.JavascriptInterface
    fun onPlaybackTick(seconds: Int) {}

    @android.webkit.JavascriptInterface
    fun onPlaybackError(errorMessage: String) {
        onError("WebView Playback Error: $errorMessage")
    }

    @android.webkit.JavascriptInterface
    fun onPlaybackEnded() { onPlaybackStateChanged(PlaybackState.ENDED) }

    @android.webkit.JavascriptInterface
    fun onAudioLanguageProbe(json: String) {
        Log.d("EaMaxAudio", "probe: $json")
        try {
            val wanted = Regex(""""wanted"\s*:\s*"([^"]+)"""").find(json)?.groupValues?.get(1) ?: ""
            val applied = """"applied"\s*:\s*true""".toRegex().containsMatchIn(json)
            onAudioProbe(wanted, applied)
        } catch (_: Exception) { }
    }

    @android.webkit.JavascriptInterface
    fun onQualityProbe(json: String) {
        Log.d("EaMaxQuality", "probe: $json")
        try {
            fun num(key: String) =
                Regex(""""$key"\s*:\s*(\d+)""").find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 0
            val wanted = Regex(""""wanted"\s*:\s*"([^"]+)"""").find(json)?.groupValues?.get(1) ?: ""
            val applied = """"applied"\s*:\s*true""".toRegex().containsMatchIn(json)
            onQualityProbe(wanted, num("maxH"), num("activeH"), applied)
        } catch (_: Exception) { }
    }
}
