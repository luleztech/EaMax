package com.eamax.player

import android.content.Context
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.eamax.domain.model.StreamSession
import com.eamax.domain.model.StreamQuality
import com.eamax.domain.model.PlaybackState

/**
 * WebView Streaming Engine - Optimized for DRM and External Web Players
 * PATCHED: Shaka Player logic disabled in favor of ExoPlayer for DRM streams.
 */
class WebViewEngine(
    private val context: Context,
    private val onPlaybackStateChanged: (PlaybackState) -> Unit,
    private val onError: (String) -> Unit,
    private val onGatewayExtracted: ((PhpGatewayExtractor.Extracted) -> Unit)? = null,
) {
    private var webView: WebView? = null
    private var currentSession: StreamSession? = null
    private var jsInterface: WebViewJsInterface? = null

    fun initialize(streamSession: StreamSession) {
        currentSession = streamSession
        val url = streamSession.mpdUrl

        try {
            webView = WebView(context).apply {
                // Enable hardware acceleration for smooth video
                setLayerType(View.LAYER_TYPE_HARDWARE, null)
                
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = true
                    allowContentAccess = true
                    allowFileAccessFromFileURLs = true
                    allowUniversalAccessFromFileURLs = true
                    mediaPlaybackRequiresUserGesture = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    
                    // Essential for DRM / EME support in WebView
                    setSupportMultipleWindows(true)
                    javaScriptCanOpenWindowsAutomatically = true
                    loadWithOverviewMode = true
                    useWideViewPort = true
                    
                    userAgentString = PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT
                }

                // Enable Cookies
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                        super.onPageFinished(view, finishedUrl)
                        val w = view ?: return
                        w.evaluateJavascript(PhpWebViewSupport.eaMaxOkoaQualityApiScript(), null)
                        val injectRecovery = StreamUrlClassifier.isLikelyGatewayUrl(url) ||
                            StreamUrlClassifier.isPhpLikeUrl(url) ||
                            url.contains(".html", ignoreCase = true) ||
                            url.contains(".php", ignoreCase = true)
                        if (injectRecovery) {
                            w.evaluateJavascript(PhpWebViewSupport.gatewayPageRecoveryScript(), null)
                            w.postDelayed({
                                w.evaluateJavascript(PhpWebViewSupport.gatewayStreamExtractScript(), null)
                            }, 400)
                        }
                        applyDefaultOkoa360(w)
                    }

                    override fun onReceivedError(view: WebView?, request: android.webkit.WebResourceRequest?, error: android.webkit.WebResourceError?) {
                        if (request?.isForMainFrame == true) {
                            onError("WebView Error: ${error?.description}")
                        }
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                        android.util.Log.d("ShakaConsole", "[${consoleMessage?.messageLevel()}] ${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                        return true
                    }
                }

                jsInterface = WebViewJsInterface(
                    onPlaybackStateChanged,
                    onError,
                    onGatewayExtracted,
                )
                addJavascriptInterface(jsInterface!!, "ShakaPlayerBridge")
            }

            webView?.loadUrl(url)

        } catch (e: Exception) {
            onError("Failed to initialize WebView: ${e.message}")
        }
    }

    fun play() {
        webView?.evaluateJavascript(
            "(function(){var v=document.querySelector('video');if(v){var p=v.play();if(p&&p.catch)p.catch(function(){});}})();",
            null
        )
    }

    fun pause() {
        webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause();})();", null)
    }
    fun stop() { webView?.stopLoading(); webView?.loadUrl("about:blank") }

    fun setQuality(quality: StreamQuality) {
        val mode = when (quality) {
            StreamQuality.AUTO -> "auto"
            else -> quality.height.toString()
        }
        webView?.evaluateJavascript(
            "try{window.__eaMaxOkoaSetQuality&&window.__eaMaxOkoaSetQuality('$mode');}catch(e){}",
            null,
        )
    }

    /** Re-apply Okoa cap as hls.js/Shaka attach after first paint (360p default). */
    private fun applyDefaultOkoa360(target: WebView) {
        val js =
            "try{window.__eaMaxOkoaSetQuality&&window.__eaMaxOkoaSetQuality('360');}catch(e){}"
        target.postDelayed({ target.evaluateJavascript(js, null) }, 450)
        target.postDelayed({ target.evaluateJavascript(js, null) }, 2200)
        target.postDelayed({ target.evaluateJavascript(js, null) }, 5500)
    }

    fun setAudioLanguage(language: String) {
        // webView?.evaluateJavascript("if (window.ShakaPlayer) window.ShakaPlayer.setAudioLanguage('$language');", null)
    }

    fun release() {
        webView?.apply {
            stopLoading()
            clearHistory()
            clearCache(true)
            removeJavascriptInterface("ShakaPlayerBridge")
            destroy()
        }
        webView = null
    }

    fun getWebView(): WebView? = webView

    fun refreshSession(newSession: StreamSession) {
        currentSession = newSession
        webView?.loadUrl(newSession.mpdUrl)
    }
}

class WebViewJsInterface(
    private val onPlaybackStateChanged: (PlaybackState) -> Unit,
    private val onError: (String) -> Unit,
    private val onGatewayExtracted: ((PhpGatewayExtractor.Extracted) -> Unit)? = null,
) {
    @android.webkit.JavascriptInterface
    fun onPlaybackStarted() { onPlaybackStateChanged(PlaybackState.PLAYING) }
    @android.webkit.JavascriptInterface
    fun onPlaybackPaused() { onPlaybackStateChanged(PlaybackState.PAUSED) }
    @android.webkit.JavascriptInterface
    fun onPlaybackTick(seconds: Int) {}
    @android.webkit.JavascriptInterface
    fun onPlaybackError(errorMessage: String) { onError("WebView Playback Error: $errorMessage") }
    @android.webkit.JavascriptInterface
    fun onPlaybackEnded() { onPlaybackStateChanged(PlaybackState.ENDED) }

    @android.webkit.JavascriptInterface
    fun onGatewayStreamExtracted(json: String) {
        try {
            val o = org.json.JSONObject(json)
            val streamUrl = o.optString("streamUrl", "").trim()
            if (streamUrl.isEmpty()) return
            val clearKeyRaw = o.optString("clearKeyRaw", "").trim()
            val clearKeys = if (clearKeyRaw.contains(':')) {
                val parts = clearKeyRaw.split(':', limit = 2)
                listOf(
                    com.eamax.domain.model.ClearKey(
                        kid = parts.getOrElse(0) { "" }.trim(),
                        k = parts.getOrElse(1) { "" }.trim(),
                    )
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
            )
            onGatewayExtracted?.invoke(extracted)
        } catch (_: Exception) { }
    }
}
