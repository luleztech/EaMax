package com.eamax.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.media3.common.Tracks
import com.eamax.domain.model.DrmData
import com.eamax.domain.model.StreamSession
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.StreamQuality
import android.util.Log
import java.util.concurrent.Executors

/**
 * ========================================================================
 * PLAYER MANAGER v2.0
 * ========================================================================
 * 
 * High-level abstraction for the ExoPlayer engine.
 * Handles:
 * - Player lifecycle management
 * - Session management
 * - Error handling and recovery
 * - State callbacks
 * 
 * ========================================================================
 */
class PlayerManager(
    private val context: Context,
    private val onStateChanged: (PlaybackState) -> Unit = {},
    private val onError: (String) -> Unit = {},
    private val onTracksAvailable: (Tracks) -> Unit = {},
    /** Called on main thread after Exo or WebView engine is created and initialized. */
    private val onReady: () -> Unit = {},
) {
    private var engine: ExoPlayerEngine? = null
    private var webViewEngine: WebViewEngine? = null
    private var currentSession: StreamSession? = null
    private var isInitialized = false
    /** If Exo fails with HTML/manifest errors, try WebView once with the original session URL. */
    private var webViewFallbackAttempted = false
    /** After WebView decrypts a gateway page, promote to Exo once. */
    private var gatewayExoPromotionAttempted = false
    private val probeExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val TAG = "PlayerManager"
    }

    /**
     * Resolves gateway URLs (e.g. *.php, /player/) via [StreamProbe], then starts ExoPlayer
     * or [WebViewEngine] when the page must play in-browser.
     */
    fun initialize(streamSession: StreamSession) {
        Log.d(TAG, "Initializing player with session: ${streamSession.sessionId}, url=${streamSession.mpdUrl}")
        
        if (isInitialized) {
            release()
        }

        currentSession = streamSession
        webViewFallbackAttempted = false
        gatewayExoPromotionAttempted = false

        probeExecutor.execute {
            val resolved = StreamProbe.resolveForSession(streamSession)
            Log.d(TAG, "StreamProbe → ${resolved.kind} playbackUri=${resolved.playbackUri.take(80)}")

            mainHandler.post {
                try {
                    when (resolved.kind) {
                        StreamProbe.ResolvedKind.WEB_VIEW_PAGE -> {
                            webViewEngine = createWebViewEngine(streamSession)
                            webViewEngine?.initialize(streamSession)
                            if (webViewEngine?.getWebView() == null) {
                                onError("WebView init failed")
                                return@post
                            }
                            isInitialized = true
                            // Wait for JS decrypt → native Exo promotion before showing WebView.
                            mainHandler.postDelayed({
                                if (!gatewayExoPromotionAttempted && engine == null) {
                                    onReady()
                                }
                            }, 2500)
                        }
                        else -> {
                            val forced = when (resolved.kind) {
                                StreamProbe.ResolvedKind.EXO_HLS -> ExoPlayerEngine.StreamFormat.HLS
                                StreamProbe.ResolvedKind.EXO_DASH -> ExoPlayerEngine.StreamFormat.DASH
                                StreamProbe.ResolvedKind.EXO_PROGRESSIVE -> ExoPlayerEngine.StreamFormat.PROGRESSIVE
                                StreamProbe.ResolvedKind.EXO_SNIFF -> ExoPlayerEngine.StreamFormat.SNIFFING
                                else -> null
                            }
                            val mergedSession = mergeResolvedSession(streamSession, resolved)
                            engine = ExoPlayerEngine(
                                context = context,
                                onPlaybackStateChanged = { state ->
                                    Log.d(TAG, "Playback state changed: $state")
                                    onStateChanged(state)
                                },
                                onError = { error ->
                                    Log.e(TAG, "Player error: $error")
                                    mainHandler.post {
                                        if (!webViewFallbackAttempted &&
                                            webViewEngine == null &&
                                            shouldFallbackExoToWebView(error)
                                        ) {
                                            webViewFallbackAttempted = true
                                            Log.w(TAG, "Exo manifest/HTML-style error — trying WebView fallback")
                                            try {
                                                engine?.release()
                                                engine = null
                                                val session = currentSession ?: streamSession
                                                webViewEngine = createWebViewEngine(session)
                                                webViewEngine?.initialize(session)
                                                if (webViewEngine?.getWebView() == null) {
                                                    onError(error)
                                                } else {
                                                    isInitialized = true
                                                    onReady()
                                                }
                                            } catch (e: Exception) {
                                                Log.e(TAG, "WebView fallback failed", e)
                                                onError(error)
                                            }
                                        } else {
                                            onError(error)
                                        }
                                    }
                                },
                                onTracksChangedCallback = { tracks ->
                                    Log.d(TAG, "Tracks available: ${tracks.groups.size} groups")
                                    onTracksAvailable(tracks)
                                }
                            )
                            engine?.initialize(mergedSession, forcedStreamFormat = forced)
                            if (engine?.getPlayer() == null) {
                                val gateway = StreamUrlClassifier.isLikelyGatewayUrl(streamSession.mpdUrl) ||
                                    StreamUrlClassifier.isPhpLikeUrl(streamSession.mpdUrl)
                                if (gateway) {
                                    engine?.release()
                                    engine = null
                                    webViewEngine = createWebViewEngine(streamSession)
                                    webViewEngine?.initialize(streamSession)
                                    if (webViewEngine?.getWebView() == null) {
                                        onError("Playback failed for this stream")
                                        return@post
                                    }
                                } else {
                                    onError("Player could not start")
                                    return@post
                                }
                            }
                            isInitialized = true
                            onReady()
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "initialize failed", e)
                    onError("Player init failed: ${e.message}")
                }
            }
        }
    }

    /**
     * Play the current stream
     */
    fun play() {
        if (!isInitialized) {
            Log.w(TAG, "Player not initialized")
            return
        }
        webViewEngine?.play()
        engine?.play()
    }

    /**
     * Pause the current stream
     */
    fun pause() {
        if (!isInitialized) {
            Log.w(TAG, "Player not initialized")
            return
        }
        webViewEngine?.pause()
        engine?.pause()
    }

    /**
     * Stop playback
     */
    fun stop() {
        if (!isInitialized) {
            Log.w(TAG, "Player not initialized")
            return
        }
        webViewEngine?.stop()
        engine?.stop()
    }

    /**
     * Release the player and free resources
     */
    fun release() {
        Log.d(TAG, "Releasing player")
        webViewEngine?.release()
        webViewEngine = null
        engine?.release()
        engine = null
        isInitialized = false
        webViewFallbackAttempted = false
        gatewayExoPromotionAttempted = false
        currentSession = null
    }

    private fun createWebViewEngine(baseSession: StreamSession): WebViewEngine {
        return WebViewEngine(
            context = context,
            onPlaybackStateChanged = { state ->
                Log.d(TAG, "WebView state: $state")
                onStateChanged(state)
            },
            onError = { err ->
                Log.e(TAG, "WebView error: $err")
                onError(err)
            },
            onGatewayExtracted = { extracted ->
                mainHandler.post { promoteGatewayToExo(baseSession, extracted) }
            },
        )
    }

    private fun mergeResolvedSession(
        base: StreamSession,
        resolved: StreamProbe.Result,
    ): StreamSession {
        val mergedHeaders = LinkedHashMap(base.headers).apply {
            resolved.headerOverlay.forEach { (k, v) -> put(k, v) }
        }
        val drmType = resolved.drmType ?: base.drmType
        val licenseUrl = resolved.licenseUrl.ifEmpty { base.licenseUrl }
        val drmHeaders = buildDrmHeaders(resolved, base)
        val drmData = when {
            drmHeaders.isNotEmpty() -> base.drmData.copy(headers = drmHeaders)
            resolved.clearKeys.isNotEmpty() -> DrmData(keys = resolved.clearKeys, headers = base.drmData.headers)
            else -> base.drmData
        }
        return base.copy(
            mpdUrl = resolved.playbackUri,
            headers = mergedHeaders,
            licenseUrl = licenseUrl,
            drmType = drmType,
            drmData = drmData,
        )
    }

    private fun buildDrmHeaders(
        resolved: StreamProbe.Result,
        base: StreamSession,
    ): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        base.drmData.headers?.let { out.putAll(it) }
        if (resolved.authToken.isNotEmpty()) {
            out["nv-authorizations"] = resolved.authToken
        }
        return out
    }

    private fun promoteGatewayToExo(
        baseSession: StreamSession,
        extracted: PhpGatewayExtractor.Extracted,
    ) {
        if (gatewayExoPromotionAttempted || engine != null) return
        gatewayExoPromotionAttempted = true
        Log.d(TAG, "Gateway decrypted in WebView → promoting to native ExoPlayer")
        try {
            webViewEngine?.release()
            webViewEngine = null
            val resolved = StreamProbe.resultFromExtracted(extracted, baseSession.mpdUrl, baseSession.headers)
            val merged = mergeResolvedSession(baseSession, resolved)
            currentSession = merged
            val forced = when (extracted.resolvedKind()) {
                StreamProbe.ResolvedKind.EXO_HLS -> ExoPlayerEngine.StreamFormat.HLS
                StreamProbe.ResolvedKind.EXO_DASH -> ExoPlayerEngine.StreamFormat.DASH
                else -> if (extracted.isHls) ExoPlayerEngine.StreamFormat.HLS else ExoPlayerEngine.StreamFormat.DASH
            }
            engine = ExoPlayerEngine(
                context = context,
                onPlaybackStateChanged = { state ->
                    Log.d(TAG, "Playback state changed: $state")
                    onStateChanged(state)
                },
                onError = { error ->
                    Log.e(TAG, "Player error: $error")
                    onError(error)
                },
                onTracksChangedCallback = { tracks ->
                    Log.d(TAG, "Tracks available: ${tracks.groups.size} groups")
                    onTracksAvailable(tracks)
                },
            )
            engine?.initialize(merged, forcedStreamFormat = forced)
            if (engine?.getPlayer() == null) {
                onError("Playback failed for this stream")
                return
            }
            isInitialized = true
            onReady()
        } catch (e: Exception) {
            Log.e(TAG, "promoteGatewayToExo failed", e)
            gatewayExoPromotionAttempted = false
        }
    }

    /**
     * Seek to a specific position (in milliseconds)
     */
    fun seekTo(positionMs: Long) {
        if (webViewEngine != null) {
            Log.w(TAG, "seekTo not supported for WebView gateway playback")
            return
        }
        engine?.getPlayer()?.seekTo(positionMs)
        Log.d(TAG, "Seeking to: ${positionMs}ms")
    }

    /**
     * Set video quality
     * @param fromUser false when applying the default 360p cap on startup
     */
    fun setQuality(quality: StreamQuality, fromUser: Boolean = true) {
        webViewEngine?.setQuality(quality, fromUser)
        engine?.setQuality(quality)
        Log.d(TAG, "Quality changed to: $quality (fromUser=$fromUser)")
    }

    /**
     * Set preferred audio language
     */
    fun setAudioLanguage(language: String) {
        webViewEngine?.setAudioLanguage(language)
        engine?.setAudioLanguage(language)
        Log.d(TAG, "Audio language changed to: $language")
    }

    /**
     * Set specific track
     */
    fun setTrack(group: Tracks.Group, trackIndex: Int) {
        engine?.setTrack(group, trackIndex)
        Log.d(TAG, "Track changed")
    }

    /**
     * Get current playback position (in milliseconds)
     */
    fun getCurrentPosition(): Long {
        return engine?.getCurrentPosition() ?: 0L
    }

    /**
     * Get stream duration (in milliseconds)
     */
    fun getDuration(): Long {
        return engine?.getDuration() ?: 0L
    }

    /**
     * Check if player is currently playing
     */
    fun isPlaying(): Boolean {
        return engine?.isPlaying() ?: false
    }

    /**
     * Get available tracks
     */
    fun getAvailableTracks(): Tracks {
        return engine?.getAvailableTracks() ?: Tracks.EMPTY
    }

    /**
     * Get the underlying ExoPlayer instance
     */
    fun getExoPlayer() = engine?.getPlayer()

    /** Embed gateway playback — add this [WebView] to your layout when non-null. */
    fun getWebView(): WebView? = webViewEngine?.getWebView()

    fun isWebViewPlayback(): Boolean = webViewEngine != null

    /**
     * Refresh stream session (e.g., when token expires)
     */
    fun refreshSession(newSession: StreamSession) {
        Log.d(TAG, "Refreshing session")
        currentSession = newSession
        when {
            webViewEngine != null -> webViewEngine?.refreshSession(newSession)
            engine != null -> engine?.refreshSession(newSession)
        }
    }

    /**
     * Check if player is initialized
     */
    fun isInitialized(): Boolean = isInitialized

    /**
     * Get current session
     */
    fun getCurrentSession(): StreamSession? = currentSession

    /** Exo returned HTML/login or manifest parse errors — try in-app WebView once. */
    private fun shouldFallbackExoToWebView(message: String): Boolean {
        val m = message.lowercase()
        // Do not route transport/network failures to WebView.
        // Allow 403/401/forbidden to fallback — WebView may have browser session/cookies.
        if (m.contains("could not connect") ||
            m.contains("connection failed") ||
            m.contains("timed out") ||
            m.contains("timeout") ||
            m.contains("dns") ||
            m.contains("no route") ||
            m.contains("unreachable") ||
            m.contains("refused connection")
        ) {
            return false
        }
        return m.contains("manifest") ||
            m.contains("malformed") ||
            m.contains("login page") ||
            m.contains("wrong file") ||
            m.contains("parsing") ||
            m.contains("not found") ||
            m.contains("403") ||
            m.contains("401") ||
            m.contains("forbidden") ||
            m.contains("unauthorized") ||
            m.contains("access denied")
    }
}
