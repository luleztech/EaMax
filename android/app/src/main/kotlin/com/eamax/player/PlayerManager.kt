package com.eamax.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import com.eamax.domain.model.PlayerMode
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.StreamQuality
import com.eamax.domain.model.StreamSession

/**
 * Washa-style player router: classify URL → ExoPlayer (direct) or WebView (gateway).
 * Format retry + fallback URLs + WebView failover — no slow gateway extract race.
 */
@OptIn(UnstableApi::class)
class PlayerManager(
    private val context: Context,
    private val onStateChanged: (PlaybackState) -> Unit = {},
    private val onError: (String) -> Unit = {},
    private val onTracksAvailable: (Tracks) -> Unit = {},
    private val onHumanCheck: (Boolean) -> Unit = {},
) {
    private val factory = OrizonPlayerFactory(context)
    private var exoPlayer: ExoPlayer? = null
    private var webViewEngine: WebViewEngine? = null
    private var currentSession: StreamSession? = null
    private var isInitialized = false
    private var initialQuality: StreamQuality = StreamQuality.QUALITY_480P
    private var preferences = PlaybackPreferences.fromQuality(StreamQuality.QUALITY_480P)
    private val mainHandler = Handler(Looper.getMainLooper())

    private val formatQueue = ArrayDeque<OrizonPlayerFactory.Format>()
    private var sessionQueue: List<StreamSession> = emptyList()
    private var sessionQueueIndex = 0
    private var handlingError = false
    private var webViewFailoverUsed = false
    private var sameFormatRetries = 0
    private var playlistResetReloads = 0
    private var networkRetries = 0

    private enum class ActiveEngine { NONE, EXO, WEBVIEW }
    private var activeEngine = ActiveEngine.NONE

    companion object {
        private const val TAG = "PlayerManager"
        private const val MAX_SAME_FORMAT_RETRIES = 4
        private const val MAX_PLAYLIST_RESET_RELOADS = 8
        private const val MAX_NETWORK_RETRIES = 8
    }

    fun setInitialQuality(quality: StreamQuality) {
        initialQuality = quality
        preferences = PlaybackPreferences.fromQuality(quality)
        PlaybackPreferences.update(
            dataSaver = false,
            defaultQuality = preferences.defaultQuality,
            videoZoomMode = "zoom",
        )
    }

    fun initialize(streamSession: StreamSession, fallbacks: List<StreamSession> = emptyList()) {
        Log.i(TAG, "init session=${streamSession.sessionId} url=${streamSession.mpdUrl.take(120)}")
        if (isInitialized) release()

        sessionQueue = listOf(streamSession) + fallbacks.filter { it.mpdUrl.isNotEmpty() }
        sessionQueueIndex = 0
        webViewFailoverUsed = false
        startSession(sessionQueue.first())
    }

    private fun startSession(session: StreamSession) {
        currentSession = session
        handlingError = false
        formatQueue.clear()
        webViewFailoverUsed = false

        val useWeb = session.playerMode == PlayerMode.WEB ||
            factory.classify(session.mpdUrl) == OrizonPlayerFactory.Format.GATEWAY ||
            StreamUrlClassifier.needsWebPlayer(session.mpdUrl)

        if (useWeb) {
            Log.i(TAG, "route → WebView gateway")
            startWebViewEngine(session)
            isInitialized = true
            return
        }

        val classified = factory.lockedFormat(session.mpdUrl) ?: factory.classify(session.mpdUrl)
        Log.i(TAG, "route → ExoPlayer format=$classified")
        enqueueFormats(classified)
        startExo(classified)
        isInitialized = true
    }

    private fun enqueueFormats(first: OrizonPlayerFactory.Format) {
        formatQueue.clear()
        sameFormatRetries = 0
        val url = currentSession?.mpdUrl.orEmpty()
        if (factory.lockedFormat(url) != null) return
        val rest = listOf(
            OrizonPlayerFactory.Format.HLS,
            OrizonPlayerFactory.Format.DASH,
            OrizonPlayerFactory.Format.PROGRESSIVE,
        ).filter { it != first }
        formatQueue.addAll(rest)
    }

    private fun startExo(format: OrizonPlayerFactory.Format, soft: Boolean = false) {
        val session = currentSession ?: return
        handlingError = false
        onStateChanged(PlaybackState.BUFFERING)
        try {
            webViewEngine?.release()
            webViewEngine = null
            activeEngine = ActiveEngine.EXO

            val exo = exoPlayer ?: factory.createPlayer(
                session.preferredAudioLanguage,
                preferences,
            ).also { created ->
                created.addListener(exoListener)
                exoPlayer = created
            }
            if (!soft && exo.mediaItemCount > 0) {
                exo.stop()
                exo.clearMediaItems()
            }
            factory.play(exo, session, format)
            if (PlayerRuntimeConfig.autoPlay) exo.playWhenReady = true
        } catch (e: Exception) {
            Log.e(TAG, "startExo failed format=$format", e)
            retryOrFail()
        }
    }

    private val exoListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_BUFFERING) {
                onStateChanged(PlaybackState.BUFFERING)
            } else if (playbackState == Player.STATE_READY) {
                sameFormatRetries = 0
                playlistResetReloads = 0
                networkRetries = 0
                onStateChanged(PlaybackState.READY)
            } else if (playbackState == Player.STATE_ENDED) {
                onStateChanged(PlaybackState.ENDED)
            }
        }

        override fun onTracksChanged(tracks: Tracks) {
            onTracksAvailable(tracks)
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) onStateChanged(PlaybackState.PLAYING)
        }

        override fun onPlayerError(error: PlaybackException) {
            handlePlaybackError(error)
        }
    }

    private fun handlePlaybackError(error: PlaybackException) {
        if (handlingError) return
        if (factory.isHlsPlaylistReset(error) && playlistResetReloads < MAX_PLAYLIST_RESET_RELOADS) {
            playlistResetReloads += 1
            handlingError = true
            val format = currentSession?.let { factory.lockedFormat(it.mpdUrl) }
                ?: OrizonPlayerFactory.Format.HLS
            Log.w(TAG, "Live HLS playlist restarted — reloading ($playlistResetReloads)")
            mainHandler.post { startExo(format, soft = true) }
            return
        }
        if (isNetworkFailure(error) && networkRetries < MAX_NETWORK_RETRIES) {
            networkRetries += 1
            val delayMs = (1_500L * networkRetries).coerceAtMost(10_000L)
            handlingError = true
            Log.w(TAG, "No network — retry $networkRetries in ${delayMs}ms")
            mainHandler.postDelayed({
                val format = currentSession?.let { factory.lockedFormat(it.mpdUrl) }
                    ?: OrizonPlayerFactory.Format.HLS
                startExo(format, soft = true)
            }, delayMs)
            return
        }
        handlingError = true
        Log.e(TAG, "Exo error ${error.errorCode}: ${error.message}")
        val httpAccess = error.errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ||
            (error.cause?.message?.contains("403", ignoreCase = true) == true) ||
            (error.cause?.message?.contains("401", ignoreCase = true) == true)
        retryOrFail(httpAccess)
    }

    private fun isNetworkFailure(error: PlaybackException): Boolean {
        if (error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
        ) {
            return true
        }
        return generateSequence(error.cause) { it.cause }.any { cause ->
            cause is java.net.UnknownHostException ||
                cause is java.net.ConnectException ||
                cause is java.net.NoRouteToHostException ||
                cause is java.net.SocketException
        }
    }

    private fun retryOrFail(httpAccessError: Boolean = false) {
        val session = currentSession
        val locked = session?.let { factory.lockedFormat(it.mpdUrl) }
        if (locked != null) {
            if (sameFormatRetries < MAX_SAME_FORMAT_RETRIES) {
                sameFormatRetries += 1
                Log.w(TAG, "reload format=$locked attempt=$sameFormatRetries")
                mainHandler.post { startExo(locked) }
                return
            }
            Log.w(TAG, "locked format=$locked exhausted — not switching parser or WebView")
        } else {
            if (httpAccessError) formatQueue.clear()
            formatQueue.removeFirstOrNull()?.let { nextFormat ->
                Log.w(TAG, "retry format=$nextFormat")
                mainHandler.post { startExo(nextFormat) }
                return
            }
        }

        if (tryNextFallbackSession()) return

        if (locked == null && !webViewFailoverUsed && session != null && PlayerRuntimeConfig.failoverToWebview) {
            webViewFailoverUsed = true
            Log.w(TAG, "failover → WebView")
            mainHandler.post { startWebViewEngine(session) }
            return
        }

        onError("Playback failed")
    }

    private fun tryNextFallbackSession(): Boolean {
        if (sessionQueueIndex + 1 >= sessionQueue.size) return false
        sessionQueueIndex++
        val next = sessionQueue[sessionQueueIndex]
        Log.w(TAG, "fallback stream ${sessionQueueIndex + 1}/${sessionQueue.size}")
        mainHandler.post {
            exoPlayer?.release()
            exoPlayer = null
            startSession(next)
        }
        return true
    }

    private fun startWebViewEngine(session: StreamSession) {
        onStateChanged(PlaybackState.BUFFERING)
        try {
            exoPlayer?.release()
            exoPlayer = null
            webViewEngine?.release()
            activeEngine = ActiveEngine.WEBVIEW
            webViewEngine = WebViewEngine(
                context = context,
                onPlaybackStateChanged = { state ->
                    onStateChanged(state)
                },
                onError = { err ->
                    Log.e(TAG, "WebView error: $err")
                    if (!tryNextFallbackSession()) onError(err)
                },
                onHumanCheck = onHumanCheck,
            )
            webViewEngine?.initialize(session)
            webViewEngine?.setQuality(initialQuality, fromUser = false)
            if (PlayerRuntimeConfig.autoPlay) {
                webViewEngine?.play()
                mainHandler.postDelayed({ webViewEngine?.play() }, 400)
            }
        } catch (e: Exception) {
            Log.e(TAG, "WebView start failed", e)
            onError(e.message ?: "WebView failed")
        }
    }

    fun play() {
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.play()
            ActiveEngine.EXO -> exoPlayer?.let {
                it.playWhenReady = true
                it.play()
            }
            ActiveEngine.NONE -> { }
        }
    }

    fun pause() {
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.pause()
            ActiveEngine.EXO -> exoPlayer?.pause()
            ActiveEngine.NONE -> { }
        }
    }

    fun stop() {
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.stop()
            ActiveEngine.EXO -> exoPlayer?.stop()
            ActiveEngine.NONE -> { }
        }
    }

    fun release() {
        mainHandler.removeCallbacksAndMessages(null)
        exoPlayer?.removeListener(exoListener)
        exoPlayer?.release()
        exoPlayer = null
        webViewEngine?.release()
        webViewEngine = null
        isInitialized = false
        activeEngine = ActiveEngine.NONE
        currentSession = null
        sessionQueue = emptyList()
        sessionQueueIndex = 0
        formatQueue.clear()
    }

    fun seekTo(positionMs: Long) {
        if (activeEngine == ActiveEngine.EXO) exoPlayer?.seekTo(positionMs)
    }

    fun setQuality(quality: StreamQuality, fromUser: Boolean = true) {
        initialQuality = quality
        preferences = PlaybackPreferences.fromQuality(quality)
        PlaybackPreferences.update(false, preferences.defaultQuality, "zoom")
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.setQuality(quality, fromUser)
            ActiveEngine.EXO -> applyExoQualityCap()
            ActiveEngine.NONE -> { }
        }
    }

    private fun applyExoQualityCap() {
        val player = exoPlayer ?: return
        val selector = player.trackSelector as? DefaultTrackSelector ?: return
        val maxH = preferences.maxVideoHeight()
        selector.parameters = selector.buildUponParameters()
            .setMaxVideoSize(Int.MAX_VALUE, maxH)
            .setForceHighestSupportedBitrate(false)
            .build()
    }

    fun setAudioLanguage(language: String) {
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.setAudioLanguage(language)
            ActiveEngine.EXO -> {
                val player = exoPlayer ?: return
                val selector = player.trackSelector as? DefaultTrackSelector ?: return
                selector.parameters = selector.buildUponParameters()
                    .setPreferredAudioLanguage(language.ifBlank { "sw" })
                    .build()
            }
            ActiveEngine.NONE -> { }
        }
    }

    fun setTrack(group: Tracks.Group, trackIndex: Int) {
        val player = exoPlayer ?: return
        val selector = player.trackSelector as? DefaultTrackSelector ?: return
        selector.parameters = selector.buildUponParameters()
            .setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, trackIndex),
            )
            .build()
    }

    fun getCurrentPosition(): Long = exoPlayer?.currentPosition ?: 0L
    fun getDuration(): Long = exoPlayer?.duration?.takeIf { it > 0 } ?: 0L

    fun isPlaying(): Boolean = when (activeEngine) {
        ActiveEngine.WEBVIEW -> webViewEngine?.isPlaying() == true
        ActiveEngine.EXO -> exoPlayer?.isPlaying == true
        ActiveEngine.NONE -> false
    }

    fun getAvailableTracks(): Tracks = exoPlayer?.currentTracks ?: Tracks.EMPTY
    fun getExoPlayer(): ExoPlayer? = if (activeEngine == ActiveEngine.EXO) exoPlayer else null
    fun getWebView(): WebView? = webViewEngine?.getWebView()

    fun refreshSession(newSession: StreamSession) {
        currentSession = newSession
        when (activeEngine) {
            ActiveEngine.WEBVIEW -> webViewEngine?.refreshSession(newSession)
            ActiveEngine.EXO -> initialize(newSession, sessionQueue.drop(1))
            ActiveEngine.NONE -> { }
        }
    }

    fun isExoPlayback(): Boolean = activeEngine == ActiveEngine.EXO
    fun isWebViewPlayback(): Boolean = activeEngine == ActiveEngine.WEBVIEW
    fun isInitialized(): Boolean = isInitialized
    fun getCurrentSession(): StreamSession? = currentSession
}
