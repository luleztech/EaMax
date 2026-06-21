package com.eamax.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.media3.common.Player
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
    private var allSessions: List<StreamSession> = emptyList()
    private var sessionIndex: Int = 0
    private var isInitialized = false
    /** If Exo fails with HTML/manifest errors, try WebView once with the original session URL. */
    private var webViewFallbackAttempted = false
    /** After WebView decrypts a gateway page, promote to Exo once. */
    private var gatewayExoPromotionAttempted = false
    private val probeExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var errorRetryCount = 0
    private var pendingRetryRunnable: Runnable? = null

    companion object {
        private const val TAG = "PlayerManager"
    }

    /**
     * Resolves gateway URLs (e.g. *.php, /player/) via [StreamProbe], then starts ExoPlayer
     * or [WebViewEngine] when the page must play in-browser.
     */
    fun initialize(streamSession: StreamSession) {
        initializeWithFailover(listOf(streamSession))
    }

    /** Try primary stream first, then backup streams from v2 playback API on fatal errors. */
    fun initializeWithFailover(sessions: List<StreamSession>) {
        val valid = sessions.filter { it.mpdUrl.isNotBlank() }
        if (valid.isEmpty()) {
            onError("No stream URL")
            return
        }
        allSessions = valid
        sessionIndex = 0
        errorRetryCount = 0
        cancelPendingRetry()
        if (valid.size > 1) {
            Log.d(TAG, "Failover enabled: ${valid.size} streams")
        }
        startCurrentSession()
    }

    private fun cancelPendingRetry() {
        pendingRetryRunnable?.let { mainHandler.removeCallbacks(it) }
        pendingRetryRunnable = null
    }

    private fun launchExoPlayer(
        mergedSession: StreamSession,
        forced: ExoPlayerEngine.StreamFormat?,
        originalSession: StreamSession,
    ) {
        engine = ExoPlayerEngine(
            context = context,
            onPlaybackStateChanged = { state ->
                Log.d(TAG, "Playback state changed: $state")
                onStateChanged(state)
            },
            onError = { error ->
                Log.e(TAG, "Player error: $error")
                mainHandler.post {
                    if (!PlayerEnginePolicy.forceExo() &&
                        !webViewFallbackAttempted &&
                        webViewEngine == null &&
                        RemotePlayerConfigHolder.failoverToWebview &&
                        shouldFallbackExoToWebView(error)
                    ) {
                        webViewFallbackAttempted = true
                        Log.w(TAG, "Exo manifest/HTML-style error — trying WebView fallback")
                        try {
                            engine?.release()
                            engine = null
                            val session = currentSession ?: originalSession
                            webViewEngine = createWebViewEngine(session)
                            webViewEngine?.initialize(session)
                            if (webViewEngine?.getWebView() == null) {
                                dispatchFatalError(error)
                            } else {
                                isInitialized = true
                                notifyReady()
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "WebView fallback failed", e)
                            dispatchFatalError(error)
                        }
                    } else {
                        dispatchFatalError(error)
                    }
                }
            },
            onTracksChangedCallback = { tracks ->
                Log.d(TAG, "Tracks available: ${tracks.groups.size} groups")
                onTracksAvailable(tracks)
            },
        )
        engine?.initialize(mergedSession, forcedStreamFormat = forced)
        if (engine?.getPlayer() == null) {
            val gateway = StreamUrlClassifier.isLikelyGatewayUrl(originalSession.mpdUrl) ||
                StreamUrlClassifier.isPhpLikeUrl(originalSession.mpdUrl)
            if (gateway) {
                engine?.release()
                engine = null
                webViewEngine = createWebViewEngine(originalSession)
                webViewEngine?.initialize(originalSession)
                if (webViewEngine?.getWebView() == null) {
                    dispatchFatalError("Playback failed for this stream")
                    return
                }
            } else {
                dispatchFatalError("Player could not start")
                return
            }
        }
        isInitialized = true
        engine?.setAudioLanguage(mergedSession.preferredAudioLanguage)
        engine?.setQuality(RemotePlayerConfigHolder.defaultStreamQuality())
        notifyReady()
    }

    private fun notifyReady() {
        errorRetryCount = 0
        onReady()
    }

    private fun startCurrentSession() {
        val streamSession = allSessions.getOrNull(sessionIndex) ?: run {
            dispatchFatalError("Playback failed for this stream")
            return
        }
        Log.d(TAG, "Starting stream ${sessionIndex + 1}/${allSessions.size}: session=${streamSession.sessionId}, url=${streamSession.mpdUrl}")

        engine?.release()
        engine = null
        webViewEngine?.release()
        webViewEngine = null
        isInitialized = false
        webViewFallbackAttempted = false
        gatewayExoPromotionAttempted = false

        currentSession = streamSession

        if (PlayerEnginePolicy.forceWebView()) {
            Log.d(TAG, "Admin engine → force WebView: ${PlayerEnginePolicy.normalize(RemotePlayerConfigHolder.preferredEngine)}")
            mainHandler.post {
                try {
                    webViewEngine = createWebViewEngine(streamSession)
                    webViewEngine?.initialize(streamSession)
                    if (webViewEngine?.getWebView() == null) {
                        dispatchFatalError("WebView init failed")
                        return@post
                    }
                    isInitialized = true
                    notifyReady()
                } catch (e: Exception) {
                    dispatchFatalError("Player init failed: ${e.message}")
                }
            }
            return
        }

        // Gateway pages must use WebView — Exo cannot render PHP/HTML player pages.
        val gatewayUrl = streamSession.mpdUrl.trim()
        val isGateway = StreamUrlClassifier.isPhpLikeUrl(gatewayUrl) ||
            StreamUrlClassifier.isLikelyGatewayUrl(gatewayUrl)
        if (isGateway) {
            Log.d(TAG, "Fast-start WEB_VIEW (gateway): ${gatewayUrl.take(80)}")
            mainHandler.post {
                try {
                    webViewEngine = createWebViewEngine(streamSession)
                    webViewEngine?.initialize(streamSession)
                    if (webViewEngine?.getWebView() == null) {
                        dispatchFatalError("WebView init failed")
                        return@post
                    }
                    isInitialized = true
                    notifyReady()
                } catch (e: Exception) {
                    dispatchFatalError("Player init failed: ${e.message}")
                }
            }
            return
        }

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
                                dispatchFatalError("WebView init failed")
                                return@post
                            }
                            isInitialized = true
                            notifyReady()
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
                            launchExoPlayer(mergedSession, forced, streamSession)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "initialize failed", e)
                    dispatchFatalError("Player init failed: ${e.message}")
                }
            }
        }
    }

    private fun dispatchFatalError(message: String) {
        if (RemotePlayerConfigHolder.reconnectEnabled &&
            errorRetryCount < RemotePlayerConfigHolder.retryMax
        ) {
            errorRetryCount++
            Log.w(
                TAG,
                "Retry $errorRetryCount/${RemotePlayerConfigHolder.retryMax} in ${RemotePlayerConfigHolder.retryDelayMs}ms",
            )
            cancelPendingRetry()
            val retry = Runnable {
                pendingRetryRunnable = null
                startCurrentSession()
            }
            pendingRetryRunnable = retry
            mainHandler.postDelayed(retry, RemotePlayerConfigHolder.retryDelayMs)
            return
        }
        if (tryAdvanceToNextStream()) {
            Log.w(TAG, "Failover → stream ${sessionIndex + 1}/${allSessions.size}")
            return
        }
        onError(message)
    }

    private fun tryAdvanceToNextStream(): Boolean {
        if (sessionIndex + 1 >= allSessions.size) return false
        sessionIndex++
        errorRetryCount = 0
        cancelPendingRetry()
        startCurrentSession()
        return true
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
        cancelPendingRetry()
        errorRetryCount = 0
        engine?.release()
        engine = null
        webViewEngine?.release()
        webViewEngine = null
        isInitialized = false
        webViewFallbackAttempted = false
        gatewayExoPromotionAttempted = false
        currentSession = null
        allSessions = emptyList()
        sessionIndex = 0
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
                dispatchFatalError(err)
            },
            onStreamExtracted = { extracted ->
                mainHandler.post {
                    if (gatewayExoPromotionAttempted) {
                        if (extracted.licenseUrl.isNotEmpty() || extracted.clearKeys.isNotEmpty()) {
                            repromoteGatewayToExo(baseSession, extracted)
                        }
                        return@post
                    }
                    if (!StreamUrlClassifier.canPromoteGatewayToNativeExo(extracted) &&
                        webViewEngine?.wasPlaybackStarted() == true
                    ) {
                        gatewayExoPromotionAttempted = true
                        Log.d(TAG, "Gateway stream locked to WebView Shaka playback")
                        return@post
                    }
                    promoteGatewayToExo(baseSession, extracted)
                }
            },
            onShakaFailed = { extracted ->
                mainHandler.post {
                    if (shouldSuppressPlaybackError()) {
                        Log.d(TAG, "Ignoring Shaka failure — native playback active or starting")
                        return@post
                    }
                    if (!gatewayExoPromotionAttempted) {
                        if (StreamUrlClassifier.canPromoteGatewayToNativeExo(extracted)) {
                            promoteGatewayToExo(baseSession, extracted)
                        } else if (webViewEngine?.wasPlaybackStarted() == true) {
                            gatewayExoPromotionAttempted = true
                            Log.d(TAG, "Shaka failed native path — keeping WebView playback")
                        } else {
                            dispatchFatalError("unavailable")
                        }
                    } else if (!shouldSuppressPlaybackError()) {
                        dispatchFatalError("unavailable")
                    }
                }
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
        resolved.licenseHeaders.forEach { (k, v) -> if (v.isNotBlank()) out[k] = v }
        if (resolved.authToken.isNotEmpty()) {
            out["nv-authorizations"] = resolved.authToken
        }
        return out
    }

    private fun promoteGatewayToExo(
        baseSession: StreamSession,
        extracted: PhpGatewayExtractor.Extracted,
    ) {
        if (engine != null && gatewayExoPromotionAttempted) return
        doPromoteGatewayToExo(baseSession, extracted)
    }

    private fun repromoteGatewayToExo(
        baseSession: StreamSession,
        extracted: PhpGatewayExtractor.Extracted,
    ) {
        Log.d(TAG, "Upgrading Exo session with DRM from gateway extract")
        engine?.release()
        engine = null
        gatewayExoPromotionAttempted = false
        doPromoteGatewayToExo(baseSession, extracted)
    }

    private fun doPromoteGatewayToExo(
        baseSession: StreamSession,
        extracted: PhpGatewayExtractor.Extracted,
    ) {
        if (gatewayExoPromotionAttempted && engine != null) return
        if (extracted.clearKeys.isEmpty() &&
            extracted.licenseUrl.isEmpty() &&
            StreamUrlClassifier.likelyRequiresWidevine(extracted.streamUrl)
        ) {
            if (webViewEngine?.wasPlaybackStarted() == true) {
                gatewayExoPromotionAttempted = true
                Log.d(TAG, "Azam/Widevine gateway — keeping WebView playback (no native license)")
            } else {
                Log.w(TAG, "Encrypted gateway stream without license — waiting for DRM URL")
            }
            return
        }
        if (!StreamUrlClassifier.canPromoteGatewayToNativeExo(extracted)) {
            gatewayExoPromotionAttempted = true
            Log.d(
                TAG,
                "Keeping WebView playback — no native license URL (lic=${extracted.licenseUrl.take(80)})",
            )
            return
        }
        gatewayExoPromotionAttempted = true
        Log.d(TAG, "Gateway decrypted in WebView → promoting to native ExoPlayer")
        try {
            val resolved = StreamProbe.resultFromExtracted(extracted, baseSession.mpdUrl, baseSession.headers)
            var merged = mergeResolvedSession(baseSession, resolved)
            val gatewayUrl = baseSession.mpdUrl.trim()
            if (gatewayUrl.startsWith("http")) {
                val manifestHeaders = GatewayHttpHeaders.forManifest(
                    extracted.streamUrl,
                    gatewayUrl,
                    merged.headers,
                )
                merged = merged.copy(headers = manifestHeaders)
            }
            if (merged.licenseUrl.isNotEmpty()) {
                val licenseHeaders = GatewayHttpHeaders.forLicense(
                    licenseUrl = merged.licenseUrl,
                    gatewayUrl = gatewayUrl,
                    manifestUrl = extracted.streamUrl,
                    capturedHeaders = extracted.licenseHeaders,
                    drmHeaders = merged.drmData.headers.orEmpty(),
                )
                merged = merged.copy(drmData = merged.drmData.copy(headers = licenseHeaders))
                Log.d(TAG, "License POST headers: ${licenseHeaders.keys.joinToString()}")
            }
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
                    mainHandler.post {
                        if (tryRevertToWebViewPlayback()) {
                            Log.w(TAG, "Exo promotion failed — reverted to WebView playback")
                            onStateChanged(PlaybackState.PLAYING)
                            return@post
                        }
                        dispatchFatalError(error)
                    }
                },
                onTracksChangedCallback = { tracks ->
                    Log.d(TAG, "Tracks available: ${tracks.groups.size} groups")
                    onTracksAvailable(tracks)
                },
            )
            webViewEngine?.suspendPlayback()
            webViewEngine?.getWebView()?.let { w ->
                w.alpha = 0f
                (w.parent as? android.view.ViewGroup)?.removeView(w)
            }
            val licenseBridge = webViewEngine?.getLicenseBridge()
            engine?.initialize(
                merged,
                forcedStreamFormat = forced,
                webViewLicenseBridge = licenseBridge,
            )
            if (engine?.getPlayer() == null) {
                dispatchFatalError("Playback failed for this stream")
                return
            }
            engine?.setAudioLanguage(merged.preferredAudioLanguage)
            engine?.setQuality(RemotePlayerConfigHolder.defaultStreamQuality())
            isInitialized = true
            notifyReady()
            engine?.play()
        } catch (e: Exception) {
            Log.e(TAG, "promoteGatewayToExo failed", e)
            gatewayExoPromotionAttempted = false
            if (webViewEngine?.wasPlaybackStarted() == true) {
                onStateChanged(PlaybackState.PLAYING)
            } else {
                dispatchFatalError("Playback failed for this stream")
            }
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
        when {
            engine?.getPlayer() != null -> engine?.setQuality(quality)
            webViewEngine != null -> webViewEngine?.setQuality(quality, fromUser)
            else -> engine?.setQuality(quality)
        }
        Log.d(TAG, "Quality changed to: $quality (fromUser=$fromUser)")
    }

    /**
     * Set preferred audio language
     */
    fun setAudioLanguage(language: String) {
        val lang = AudioLanguageSupport.normalize(language)
        webViewEngine?.setAudioLanguage(lang)
        engine?.setAudioLanguage(lang)
        Log.d(TAG, "Audio language changed to: $lang")
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
        engine?.getCurrentPosition()?.takeIf { it > 0L }?.let { return it }
        return if (webViewEngine?.wasPlaybackStarted() == true) 0L else 0L
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
        if (engine?.isPlaying() == true) return true
        if (webViewEngine?.wasPlaybackStarted() == true) return true
        return false
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
     * True when playback is active or Exo is still starting after a WebView→Exo handoff.
     * Prevents false "channel unavailable" dialogs from stale WebView/Shaka errors.
     */
    fun shouldSuppressPlaybackError(): Boolean {
        if (engine?.isPlaying() == true) return true
        val p = engine?.getPlayer()
        if (p != null) {
            when (p.playbackState) {
                Player.STATE_BUFFERING, Player.STATE_READY -> return true
            }
        }
        if (webViewEngine?.wasPlaybackStarted() == true) return true
        if (gatewayExoPromotionAttempted && engine != null) return true
        return false
    }

    /**
     * After a failed Exo promotion, restore in-WebView Shaka playback if it was working.
     */
    fun tryRevertToWebViewPlayback(): Boolean {
        val wv = webViewEngine ?: return false
        if (!wv.wasPlaybackStarted()) return false
        engine?.release()
        engine = null
        wv.restoreWebViewVisibility()
        return true
    }

    /** Re-attach WebView after Exo promotion failure (view may have been removed from hierarchy). */
    fun getWebViewForReattach(): WebView? = webViewEngine?.getWebView()

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
