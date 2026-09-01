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
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
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
    private val onHumanCheck: (Boolean) -> Unit = {},
) {
    private var webView: WebView? = null
    private var currentSession: StreamSession? = null
    private var jsInterface: WebViewJsInterface? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private var playbackStarted = false
    private var playbackApisInjected = false
    private var userPickedQuality = false
    private var qualityConfirmed = false
    private var qualityRetryGeneration = 0
    private var selectedQuality: StreamQuality = StreamQuality.QUALITY_480P
    private var preferredAudioLanguage = "sw"
    private var lastLoadedAudioLanguage = ""
    private var audioLanguageConfirmed = false
    private var pageLoadGeneration = 0
    private var pageFinishRunnable: Runnable? = null
    private var captchaPollRunnable: Runnable? = null
    private var humanCheckActive = false
    private var forbiddenRetryCount = 0
    private val pendingRunnables = mutableListOf<Runnable>()

    companion object {
        private const val TAG = "EaMaxAudio"
        private const val QUALITY_TAG = "EaMaxQuality"
        private const val MAX_FORBIDDEN_RETRIES = 2
    }

    private fun shouldUseWebView(url: String): Boolean =
        StreamUrlClassifier.needsWebPlayer(url)

    private fun buildLoadHeaders(
        session: StreamSession,
        audioLang: String = preferredAudioLanguage,
    ): Map<String, String> {
        val lang = normalizeAudioLanguage(audioLang)
        val h = PlaybackBrowserHeaders.buildForUrl(session.mpdUrl, session.headers, lang)
        if (session.token.isNotBlank() &&
            !h.keys.any { it.equals("Authorization", ignoreCase = true) }
        ) {
            h["Authorization"] = "Bearer ${session.token}"
        }
        return h
    }

    fun initialize(streamSession: StreamSession) {
        currentSession = streamSession
        playbackStarted = false
        playbackApisInjected = false
        userPickedQuality = false
        qualityConfirmed = false
        qualityRetryGeneration++
        preferredAudioLanguage = normalizeAudioLanguage(streamSession.preferredAudioLanguage)
        lastLoadedAudioLanguage = preferredAudioLanguage
        forbiddenRetryCount = 0
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
                    userAgentString = PlaybackBrowserHeaders.CHROME_MOBILE_UA
                }

                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                // Install captcha stub before any page script runs (Android 8+ with feature support).
                installDocumentStartBypass(this)

                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: android.webkit.WebResourceRequest?,
                    ): android.webkit.WebResourceResponse? {
                        // Do NOT hard-block reCAPTCHA assets here.
                        // Blocking them makes some gateways (WAF) return a visible
                        // "403 Forbidden" shell instead of the player page.
                        // Silent stub + hide in GatewayPlaybackJs still prevents the UI.
                        return super.shouldInterceptRequest(view, request)
                    }

                    override fun onPageStarted(
                        view: WebView?,
                        startedUrl: String?,
                        favicon: android.graphics.Bitmap?,
                    ) {
                        pageLoadGeneration++
                        pageFinishRunnable?.let { mainHandler.removeCallbacks(it) }
                        pageFinishRunnable = null
                        stopCaptchaPoll()
                        if (humanCheckActive) {
                            humanCheckActive = false
                            onHumanCheck(false)
                        }
                        playbackStarted = false
                        playbackApisInjected = false
                        audioLanguageConfirmed = false
                        drm4012Handled = false
                        // Install silent captcha stub + player capture as early as possible.
                        injectRecaptchaUnlockHelper()
                        injectPlayerCaptureHook()
                        injectWidevineL3Fallback()
                        onPlaybackStateChanged(PlaybackState.BUFFERING)
                    }

                    override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                        super.onPageFinished(view, finishedUrl)
                        if (!isExternalWebPage) return
                        // Install captcha patch ASAP (before delayed ready), so early execute() calls work.
                        injectRecaptchaUnlockHelper()
                        val gen = pageLoadGeneration
                        pageFinishRunnable?.let { mainHandler.removeCallbacks(it) }
                        val r = Runnable {
                            if (gen != pageLoadGeneration) return@Runnable
                            sniffForbiddenThenReady(gen)
                        }
                        pageFinishRunnable = r
                        mainHandler.postDelayed(r, 450)
                    }

                    override fun onReceivedHttpError(
                        view: WebView?,
                        request: android.webkit.WebResourceRequest?,
                        errorResponse: android.webkit.WebResourceResponse?,
                    ) {
                        if (request?.isForMainFrame != true) return
                        val code = errorResponse?.statusCode ?: 0
                        if (code == 403 || code == 401 || code == 429 || code == 503) {
                            Log.w(TAG, "Gateway HTTP $code on main frame — hide + retry")
                            injectRecaptchaUnlockHelper()
                            mainHandler.post { handleForbiddenResponse("HTTP $code") }
                        }
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
                        val msg = consoleMessage?.message().orEmpty()
                        Log.d(
                            "ShakaConsole",
                            "[${consoleMessage?.messageLevel()}] $msg",
                        )
                        // Shaka 4012 = RESTRICTIONS_CANNOT_BE_MET (often HDCP / L1-only video).
                        if (msg.contains("4012") && msg.contains("Shaka", ignoreCase = true)) {
                            mainHandler.post { handleDrmRestrictedError() }
                        }
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
                        val expected = qualityModeFor(selectedQuality)
                        // Ignore stale probes from a previous quality pick.
                        if (applied && wanted == expected) {
                            qualityConfirmed = true
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

    /**
     * Soft host reCAPTCHA: auto-resolve client checks, hide the widget, autoplay.
     * Users never see or tick a captcha — channels just play.
     */
    private fun injectRecaptchaUnlockHelper() {
        webView?.evaluateJavascript(GatewayPlaybackJs.silentRecaptchaBypassScript(), null)
    }

    private fun installDocumentStartBypass(wv: WebView) {
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                // Captcha stub + player constructor capture must run before page scripts.
                WebViewCompat.addDocumentStartJavaScript(
                    wv,
                    GatewayPlaybackJs.silentRecaptchaBypassScript() + "\n" +
                        GatewayPlaybackJs.playerCaptureHookScript() + "\n" +
                        GatewayPlaybackJs.widevineL3FallbackScript(),
                    setOf("*"),
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "document-start captcha bypass unavailable: ${e.message}")
        }
    }

    private fun injectPlayerCaptureHook() {
        webView?.evaluateJavascript(GatewayPlaybackJs.playerCaptureHookScript(), null)
    }

    private fun classifyPageThenReady(gen: Int) {
        if (gen != pageLoadGeneration) return
        injectRecaptchaUnlockHelper()
        // Never show a captcha UI — stub unlocks host scripts, then autoplay.
        mainHandler.postDelayed({
            if (gen != pageLoadGeneration) return@postDelayed
            exitCaptchaModeIfNeeded()
            handlePageReady()
        }, 250)
    }

    /** Detect WAF/reCAPTCHA "403 Forbidden" shells and retry instead of leaving that text on screen. */
    private fun sniffForbiddenThenReady(gen: Int) {
        if (gen != pageLoadGeneration) return
        webView?.evaluateJavascript(
            "(function(){try{return document.documentElement.outerHTML||'';}catch(e){return '';}})();",
        ) { raw ->
            if (gen != pageLoadGeneration) return@evaluateJavascript
            val html = unescapeEvaluateJsString(raw)
            if (html.isNotBlank() && GatewayStreamExtractor.looksLikeForbiddenPage(html)) {
                Log.w(TAG, "Gateway HTML is 403/Forbidden (len=${html.length}) — retry")
                handleForbiddenResponse("HTML 403")
                return@evaluateJavascript
            }
            classifyPageThenReady(gen)
        }
    }

    private fun handleForbiddenResponse(reason: String) {
        injectRecaptchaUnlockHelper()
        val session = currentSession
        if (session == null) {
            onError("Channel unavailable")
            return
        }
        if (forbiddenRetryCount < MAX_FORBIDDEN_RETRIES) {
            forbiddenRetryCount++
            Log.i(TAG, "Retrying gateway after $reason (attempt=$forbiddenRetryCount)")
            onPlaybackStateChanged(PlaybackState.BUFFERING)
            // Blank first so the Forbidden page is never left visible.
            webView?.loadUrl("about:blank")
            mainHandler.postDelayed({
                val s = currentSession ?: return@postDelayed
                val headers = buildLoadHeaders(s, preferredAudioLanguage)
                webView?.loadUrl(s.mpdUrl, headers)
            }, 700L * forbiddenRetryCount)
            return
        }
        Log.e(TAG, "Gateway still blocked after retries ($reason)")
        onError("Channel unavailable")
    }

    private fun unescapeEvaluateJsString(raw: String?): String {
        if (raw.isNullOrBlank() || raw == "null") return ""
        var s = raw.trim()
        if (s.length >= 2 && s.first() == '"' && s.last() == '"') {
            s = s.substring(1, s.length - 1)
        }
        return s
            .replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace("\\\"", "\"")
            .replace("\\/", "/")
            .replace("\\\\", "\\")
    }

    private fun exitCaptchaModeIfNeeded() {
        humanCheckActive = false
        onHumanCheck(false)
    }

    private fun stopCaptchaPoll() {
        captchaPollRunnable?.let { mainHandler.removeCallbacks(it) }
        captchaPollRunnable = null
    }

    private fun handlePageReady() {
        Log.d(TAG, "page ready — autoplay (no captcha UI) audio=$preferredAudioLanguage")
        injectRecaptchaUnlockHelper()
        injectPlayerCaptureHook()
        injectWidevineL3Fallback()
        ensurePlaybackApisInjected()
        nudgeVideoPlay()
        applyQualityAfterPageLoad()
        audioLanguageConfirmed = false
        applyAudioLanguageJs(preferredAudioLanguage, scheduleRetries = true)
        onPlaybackStateChanged(PlaybackState.PLAYING)
        playbackStarted = true
        scheduleForceAutoplay(pageLoadGeneration, 0)
    }

    private fun injectWidevineL3Fallback() {
        webView?.evaluateJavascript(GatewayPlaybackJs.widevineL3FallbackScript(), null)
    }

    private var drm4012Handled = false

    private fun handleDrmRestrictedError() {
        if (drm4012Handled) return
        drm4012Handled = true
        Log.w(QUALITY_TAG, "Shaka 4012 DRM restricted — clearing app restrictions + L3")
        injectWidevineL3Fallback()
        webView?.evaluateJavascript(
            "try{window.__eamaxHandleDrm4012&&window.__eamaxHandleDrm4012();}catch(e){}",
            null,
        )
        postDelayed({
            injectWidevineL3Fallback()
            play()
        }, 500)
    }

    /** Keep forcing play until the video is actually running (no user gesture needed). */
    private fun scheduleForceAutoplay(gen: Int, attempt: Int) {
        if (gen != pageLoadGeneration) return
        if (attempt > 30) return
        postDelayed({
            if (gen != pageLoadGeneration) return@postDelayed
            injectRecaptchaUnlockHelper()
            webView?.evaluateJavascript(GatewayPlaybackJs.forceAutoplayScript()) { raw ->
                val status = raw?.trim()?.trim('"')?.lowercase().orEmpty()
                if (status != "playing" && attempt < 30) {
                    scheduleForceAutoplay(gen, attempt + 1)
                }
            }
        }, if (attempt == 0) 300L else 700L)
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
            """
            (function(){
              function muteExtras(doc){
                try{
                  var vids=doc.querySelectorAll('video');
                  if(!vids||vids.length<=1)return;
                  var primary=null,best=-1;
                  for(var i=0;i<vids.length;i++){
                    var v=vids[i];
                    var score=(v.clientWidth||0)*(v.clientHeight||0);
                    if(!v.paused&&!v.ended)score+=1e9;
                    if(score>best){best=score;primary=v;}
                  }
                  for(var j=0;j<vids.length;j++){
                    if(vids[j]===primary){try{vids[j].muted=false;}catch(e){}}
                    else{try{vids[j].muted=true;vids[j].pause();}catch(e){}}
                  }
                }catch(e){}
              }
              function playIn(doc){
                muteExtras(doc);
                try{
                  var v=doc.querySelector('video');
                  if(v && v.paused && !v.ended && v.readyState>=2){
                    var p=v.play();
                    if(p&&p.catch)p.catch(function(){});
                    return true;
                  }
                }catch(e){}
                var iframes=doc.querySelectorAll('iframe');
                for(var i=0;i<iframes.length;i++){
                  try{
                    var d=iframes[i].contentDocument||iframes[i].contentWindow.document;
                    if(d&&playIn(d))return true;
                  }catch(e){}
                }
                return false;
              }
              playIn(document);
            })();
            """.trimIndent(),
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
        qualityConfirmed = false
        qualityRetryGeneration++
        val mode = qualityModeFor(quality)
        Log.d(QUALITY_TAG, "setQuality $quality mode=$mode fromUser=$fromUser")
        try {
            ensurePlaybackApisInjected()
            applyQualityJs(mode, fromUser, scheduleRetries = true)
            // Keep playback going after quality change.
            postDelayed({ play() }, 400)
        } catch (e: Exception) {
            Log.e(QUALITY_TAG, "setQuality failed: ${e.message}")
        }
    }

    private fun qualityModeFor(quality: StreamQuality): String = when (quality) {
        StreamQuality.AUTO -> "auto"
        else -> quality.height.toString()
    }

    private fun applyQualityAfterPageLoad() {
        // Startup default: 480p — select track, not maxHeight restrictions (avoids Shaka 4012).
        val mode = if (userPickedQuality) qualityModeFor(selectedQuality) else "480"
        val fromUser = userPickedQuality
        Log.d(QUALITY_TAG, "applyQualityAfterPageLoad mode=$mode fromUser=$fromUser")
        applyQualityJs(mode, fromUser, scheduleRetries = true)
    }

    private fun applyQualityJs(mode: String, fromUser: Boolean, scheduleRetries: Boolean) {
        val gen = qualityRetryGeneration
        injectQuality(mode, fromUser)
        if (!scheduleRetries) return
        // Keep retries light — re-selecting every few hundred ms causes scratch/pause loops.
        val delays = if (fromUser) {
            listOf(400L, 1200L, 2500L, 4500L)
        } else {
            listOf(800L, 2000L, 4500L)
        }
        delays.forEach { delayMs ->
            postDelayed({
                if (gen != qualityRetryGeneration) return@postDelayed
                if (qualityConfirmed) return@postDelayed
                if (!fromUser && userPickedQuality) return@postDelayed
                injectQuality(mode, fromUser)
            }, delayMs)
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
        audioLanguageConfirmed = false
        lastLoadedAudioLanguage = lang

        // Prefer in-page Shaka/hls.js switch — full reload often breaks playback / shows captcha.
        try {
            ensurePlaybackApisInjected()
            applyAudioLanguageJs(lang, scheduleRetries = true)
            postDelayed({ play() }, 500)
            postDelayed({
                if (!audioLanguageConfirmed) {
                    applyAudioLanguageJs(lang, scheduleRetries = false)
                    play()
                }
            }, 2000)
        } catch (e: Exception) {
            Log.e(TAG, "setAudioLanguage JS failed: ${e.message}")
        }
    }

    fun release() {
        cancelPendingRunnables()
        stopCaptchaPoll()
        pageFinishRunnable?.let { mainHandler.removeCallbacks(it) }
        pageFinishRunnable = null
        if (humanCheckActive) {
            humanCheckActive = false
            onHumanCheck(false)
        }
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
        // Always re-arm capture — Shaka may load after first inject.
        injectPlayerCaptureHook()
        injectWidevineL3Fallback()
        if (playbackApisInjected) return
        playbackApisInjected = true
        w.evaluateJavascript(GatewayPlaybackJs.eaMaxOkoaQualityApiScript(), null)
        w.evaluateJavascript(GatewayPlaybackJs.eaMaxAudioLanguageApiScript(), null)
    }

    private fun injectQuality(mode: String, fromUser: Boolean) {
        val w = webView ?: return
        ensurePlaybackApisInjected()
        val safeMode = mode.filter { it.isDigit() || it == 'a' || it == 'u' || it == 't' || it == 'o' }
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
            // Fewer retries — aggressive re-apply was causing scratch + double audio.
            listOf(1500L, 4500L).forEach { delayMs ->
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
