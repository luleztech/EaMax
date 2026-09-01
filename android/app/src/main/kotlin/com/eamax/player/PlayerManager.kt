package com.eamax.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.media3.common.Tracks
import com.eamax.domain.model.DrmData
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.PlayerMode
import com.eamax.domain.model.StreamQuality
import com.eamax.domain.model.StreamSession
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Routes direct manifests to ExoPlayer; PHP / gateway pages to WebView.
 *
 * Gateways: race HTTP extract + hidden WebView extract (first success → Exo).
 * Visible WebView is last resort. Exo failures on gateway origins fall back to WebView.
 */
class PlayerManager(
    private val context: Context,
    private val onStateChanged: (PlaybackState) -> Unit = {},
    private val onError: (String) -> Unit = {},
    private val onTracksAvailable: (Tracks) -> Unit = {},
    private val onHumanCheck: (Boolean) -> Unit = {},
) {
    private var engine: ExoPlayerEngine? = null
    private var webViewEngine: WebViewEngine? = null
    private var currentSession: StreamSession? = null
    /** Original gateway page — used if Exo fails after extract. */
    private var gatewayFallbackSession: StreamSession? = null
    private var isInitialized = false
    private var initGeneration = 0
    private var exoFailoverUsed = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var sessionQueue: List<StreamSession> = emptyList()
    private var sessionQueueIndex = 0
    private var initialQuality: StreamQuality = StreamQuality.QUALITY_480P

    private enum class ActiveEngine { NONE, EXO, WEBVIEW }
    private var activeEngine = ActiveEngine.NONE

    companion object {
        private const val TAG = "PlayerManager"
        private const val WEB_EXTRACT_TIMEOUT_MS = 6_000L
        private const val HTTP_EXTRACT_LEAD_MS = 1_500L
    }

    fun setInitialQuality(quality: StreamQuality) {
        initialQuality = quality
    }

    fun initialize(streamSession: StreamSession, fallbacks: List<StreamSession> = emptyList()) {
        Log.d(TAG, "Initializing player: ${streamSession.sessionId} url=${streamSession.mpdUrl.take(80)}")
        if (isInitialized) release()

        sessionQueue = listOf(streamSession) + fallbacks.filter { it.mpdUrl.isNotEmpty() }
        sessionQueueIndex = 0
        startSession(sessionQueue.first())
    }

    private fun startSession(streamSession: StreamSession) {
        val gatewayCandidate = streamSession.playerMode == PlayerMode.WEB ||
            StreamUrlClassifier.needsWebPlayer(streamSession.mpdUrl)

        if (!gatewayCandidate) {
            currentSession = streamSession
            gatewayFallbackSession = null
            startExoEngine(streamSession)
            isInitialized = true
            return
        }

        // PHP/HTML gateways (sp1.php, zetu.php, …) — play in-page Shaka like Supasoka/WashaTV.
        // Racing HTTP extract → Exo often fails on ClearKey + tokenized CDNs; WebView is reliable.
        if (streamSession.playerMode == PlayerMode.WEB) {
            currentSession = streamSession
            gatewayFallbackSession = streamSession
            exoFailoverUsed = false
            startWebViewEngine(streamSession)
            isInitialized = true
            return
        }

        onStateChanged(PlaybackState.BUFFERING)
        val gen = ++initGeneration
        currentSession = streamSession
        gatewayFallbackSession = streamSession
        exoFailoverUsed = false

        val decided = AtomicBoolean(false)
        val httpDone = AtomicBoolean(false)
        val webDone = AtomicBoolean(false)
        val webExtractStarted = AtomicBoolean(false)
        val httpResult = AtomicReference<GatewayPlaybackResolver.Resolved?>(null)
        val webResult = AtomicReference<GatewayPlaybackResolver.Resolved?>(null)

        fun tryDecide() {
            if (gen != initGeneration) return
            if (decided.get()) return

            val resolved = httpResult.get() ?: webResult.get()
            if (resolved != null) {
                if (!decided.compareAndSet(false, true)) return
                val session = applyResolvedSession(streamSession, resolved)
                currentSession = session
                // Encrypted DASH without a license URI cannot play in Exo (error 6001 /
                // Shaka 4012 on WebView). Prefer the gateway page which already wires DRM.
                val needsPageDrm = session.mpdUrl.contains(".mpd", ignoreCase = true) &&
                    session.licenseUrl.isBlank() &&
                    session.drmType != DrmType.CLEARKEY &&
                    (session.drmData.keys.isNullOrEmpty())
                if (needsPageDrm) {
                    Log.i(TAG, "Gateway MPD has no license — WebView DRM path")
                    startWebViewEngine(streamSession)
                } else {
                    startExoEngine(session)
                    val via = if (httpResult.get() === resolved) "HTTP" else "hidden WebView"
                    Log.i(TAG, "Gateway resolved via $via → ExoPlayer drm=${session.drmType}")
                }
                isInitialized = true
                return
            }

            if (httpDone.get() && webDone.get()) {
                if (!decided.compareAndSet(false, true)) return
                Log.d(TAG, "Gateway extract race failed — visible WebView last resort")
                currentSession = streamSession
                startWebViewEngine(streamSession)
                isInitialized = true
            }
        }

        fun startWebExtractIfNeeded() {
            if (gen != initGeneration || decided.get()) return
            if (!webExtractStarted.compareAndSet(false, true)) return
            GatewayWebViewExtractor.extractAsync(
                context,
                streamSession,
                timeoutMs = WEB_EXTRACT_TIMEOUT_MS,
            ) { webResolved ->
                if (gen != initGeneration) return@extractAsync
                webResult.set(webResolved)
                webDone.set(true)
                tryDecide()
            }
        }

        Thread({
            val resolved = try {
                GatewayPlaybackResolver.resolve(streamSession)
            } catch (e: Exception) {
                Log.w(TAG, "HTTP gateway resolve error: ${e.message}")
                null
            }
            httpResult.set(resolved)
            httpDone.set(true)
            if (resolved == null) {
                mainHandler.post { startWebExtractIfNeeded() }
            } else {
                mainHandler.post { tryDecide() }
            }
        }, "gateway-http-resolve").start()

        // Backup: start hidden WebView if HTTP is still pending after lead time.
        mainHandler.postDelayed({
            if (gen != initGeneration || decided.get()) return@postDelayed
            startWebExtractIfNeeded()
        }, HTTP_EXTRACT_LEAD_MS)
    }

    fun isExoPlayback(): Boolean = activeEngine == ActiveEngine.EXO
    fun isWebViewPlayback(): Boolean = activeEngine == ActiveEngine.WEBVIEW

    private fun applyResolvedSession(
        base: StreamSession,
        resolved: GatewayPlaybackResolver.Resolved,
    ): StreamSession {
        var drmType = resolved.drmType ?: base.drmType
        var drmData = base.drmData
        if (resolved.clearKeyRaw.isNotBlank()) {
            val keys = StreamSessionBuilder.parseClearKeysFromGateway(resolved.clearKeyRaw)
            if (keys.isNotEmpty()) {
                drmType = DrmType.CLEARKEY
                drmData = DrmData(keys = keys, headers = null)
            }
        }
        return base.copy(
            mpdUrl = normalizeStreamUrl(resolved.streamUrl),
            licenseUrl = resolved.licenseUrl.ifBlank { base.licenseUrl },
            token = resolved.authToken.ifBlank { base.token },
            headers = resolved.headers,
            drmType = drmType,
            drmData = drmData,
            playerMode = PlayerMode.EXO,
        )
    }

    /** ExoPlayer rejects some `https://host:443/...` URLs — strip default port. */
    private fun normalizeStreamUrl(url: String): String =
        url.trim().replace(Regex("(?i)^https://([^/:]+):443/"), "https://$1/")

    private fun startExoEngine(streamSession: StreamSession) {
        Log.d(TAG, "Engine → ExoPlayer (autoplay)")
        engine?.release()
        engine = null
        engine = ExoPlayerEngine(
            context = context,
            onPlaybackStateChanged = { state ->
                Log.d(TAG, "Exo state: $state")
                onStateChanged(state)
            },
            onError = { error ->
                Log.e(TAG, "Exo error: $error")
                if (!tryNextFallbackSession()) {
                    maybeFailoverToWebView(error)
                }
            },
            onTracksChangedCallback = { tracks -> onTracksAvailable(tracks) },
        )
        engine?.initialize(streamSession, initialQuality)
        activeEngine = ActiveEngine.EXO
        if (PlayerRuntimeConfig.autoPlay) engine?.play()
    }

    private fun tryNextFallbackSession(): Boolean {
        if (sessionQueueIndex + 1 >= sessionQueue.size) return false
        sessionQueueIndex++
        val next = sessionQueue[sessionQueueIndex]
        Log.w(TAG, "Trying fallback stream ${sessionQueueIndex + 1}/${sessionQueue.size}")
        mainHandler.post {
            engine?.release()
            engine = null
            exoFailoverUsed = false
            currentSession = next
            if (StreamUrlClassifier.needsWebPlayer(next.mpdUrl) || next.playerMode == PlayerMode.WEB) {
                startWebViewEngine(next)
            } else {
                startExoEngine(next)
            }
            isInitialized = true
            onStateChanged(PlaybackState.BUFFERING)
        }
        return true
    }

    private fun maybeFailoverToWebView(error: String) {
        val fallback = gatewayFallbackSession
        if (!PlayerRuntimeConfig.failoverToWebview ||
            fallback == null ||
            exoFailoverUsed ||
            activeEngine != ActiveEngine.EXO
        ) {
            onError(error)
            return
        }
        if (!StreamUrlClassifier.needsWebPlayer(fallback.mpdUrl) &&
            fallback.playerMode != PlayerMode.WEB
        ) {
            onError(error)
            return
        }
        exoFailoverUsed = true
        Log.w(TAG, "Exo failed — falling back to gateway WebView")
        mainHandler.post {
            engine?.release()
            engine = null
            currentSession = fallback
            startWebViewEngine(fallback)
            isInitialized = true
            onStateChanged(PlaybackState.BUFFERING)
            play()
        }
    }

    private fun startWebViewEngine(streamSession: StreamSession) {
        Log.d(TAG, "Engine → WebView (gateway page, autoplay)")
        webViewEngine?.release()
        webViewEngine = null
        webViewEngine = WebViewEngine(
            context = context,
            onPlaybackStateChanged = { state ->
                Log.d(TAG, "WebView state: $state")
                onStateChanged(state)
            },
            onError = { err ->
                Log.e(TAG, "WebView error: $err")
                if (!tryNextFallbackSession()) onError(err)
            },
            onHumanCheck = { needed ->
                Log.i(TAG, "Human check needed=$needed")
                onHumanCheck(needed)
            },
        )
        webViewEngine?.initialize(streamSession)
        activeEngine = ActiveEngine.WEBVIEW
        if (PlayerRuntimeConfig.autoPlay) {
            webViewEngine?.play()
            mainHandler.postDelayed({ webViewEngine?.play() }, 600)
        }
    }

    fun play() {
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.play()
            ActiveEngine.EXO -> engine?.play()
            ActiveEngine.NONE -> { }
        }
    }

    fun pause() {
        if (!isInitialized) return
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.pause()
            ActiveEngine.EXO -> engine?.pause()
            ActiveEngine.NONE -> { }
        }
    }

    fun stop() {
        if (!isInitialized) return
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.stop()
            ActiveEngine.EXO -> engine?.stop()
            ActiveEngine.NONE -> { }
        }
    }

    fun release() {
        Log.d(TAG, "Releasing player")
        initGeneration++
        engine?.release()
        engine = null
        webViewEngine?.release()
        webViewEngine = null
        isInitialized = false
        activeEngine = ActiveEngine.NONE
        currentSession = null
        gatewayFallbackSession = null
        exoFailoverUsed = false
        sessionQueue = emptyList()
        sessionQueueIndex = 0
    }

    fun seekTo(positionMs: Long) {
        if (activeEngine != ActiveEngine.EXO) return
        engine?.getPlayer()?.seekTo(positionMs)
    }

    fun setQuality(quality: StreamQuality, fromUser: Boolean = true) {
        try {
            when (activeEngine) {
                ActiveEngine.WEBVIEW -> webViewEngine?.setQuality(quality, fromUser)
                ActiveEngine.EXO -> engine?.setQuality(quality)
                ActiveEngine.NONE -> Log.w(TAG, "setQuality ignored — no active engine")
            }
            Log.d(TAG, "Quality → $quality (fromUser=$fromUser, engine=$activeEngine)")
        } catch (e: Exception) {
            Log.e(TAG, "setQuality error: ${e.message}", e)
        }
    }

    fun setAudioLanguage(language: String) {
        try {
            when (activeEngine) {
                ActiveEngine.WEBVIEW -> webViewEngine?.setAudioLanguage(language)
                ActiveEngine.EXO -> engine?.setAudioLanguage(language)
                ActiveEngine.NONE -> Log.w(TAG, "setAudioLanguage ignored — no active engine")
            }
            Log.d(TAG, "Audio language → $language (engine=$activeEngine)")
        } catch (e: Exception) {
            Log.e(TAG, "setAudioLanguage error: ${e.message}", e)
        }
    }

    fun setTrack(group: Tracks.Group, trackIndex: Int) {
        engine?.setTrack(group, trackIndex)
    }

    fun getCurrentPosition(): Long = engine?.getCurrentPosition() ?: 0L
    fun getDuration(): Long = engine?.getDuration() ?: 0L

    fun isPlaying(): Boolean = when (activeEngine) {
        ActiveEngine.WEBVIEW -> webViewEngine?.isPlaying() == true
        ActiveEngine.EXO -> engine?.isPlaying() == true
        ActiveEngine.NONE -> false
    }

    fun getAvailableTracks(): Tracks = engine?.getAvailableTracks() ?: Tracks.EMPTY
    fun getExoPlayer() = engine?.getPlayer()
    fun getWebView(): WebView? = webViewEngine?.getWebView()

    fun refreshSession(newSession: StreamSession) {
        currentSession = newSession
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.refreshSession(newSession)
            ActiveEngine.EXO -> engine?.refreshSession(newSession)
            ActiveEngine.NONE -> { }
        }
    }

    fun isInitialized(): Boolean = isInitialized
    fun getCurrentSession(): StreamSession? = currentSession
}
