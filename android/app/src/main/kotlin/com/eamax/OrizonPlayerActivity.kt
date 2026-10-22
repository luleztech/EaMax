package com.eamax

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.StreamSession
import com.eamax.player.OrizonPlayerFactory
import com.eamax.player.PlaybackPreferences
import com.eamax.player.StreamSessionBuilder
import com.eamax.player.WebViewEngine
import org.json.JSONArray

/**
 * Orizon TV landscape player with format retry + WebView failover for gateway pages.
 */
@OptIn(UnstableApi::class)
class OrizonPlayerActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "OrizonPlayer"
        private const val MAX_SAME_FORMAT_RETRIES = 4
        private const val MAX_PLAYLIST_RESET_RELOADS = 8
        private const val MAX_NETWORK_RETRIES = 8
        /** Cycle order shown on the zoom chip. */
        private val ZOOM_MODES = listOf("normal", "fill", "stretched", "contain")
    }

    private var player: ExoPlayer? = null
    private var webViewEngine: WebViewEngine? = null
    private lateinit var playerView: PlayerView
    private lateinit var webContainer: FrameLayout
    private lateinit var zoomChip: LinearLayout
    private lateinit var zoomLabel: TextView
    private lateinit var factory: OrizonPlayerFactory
    private lateinit var session: StreamSession
    private var playbackPreferences = PlaybackPreferences.current()
    private var zoomMode: String = "contain"

    private val formatQueue = ArrayDeque<OrizonPlayerFactory.Format>()
    private val fallbackUrls = ArrayDeque<String>()
    private var handlingError = false
    private var sameFormatRetries = 0
    private var playlistResetReloads = 0
    private var networkRetries = 0
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        WindowCompat.setDecorFitsSystemWindows(window, false)
        applyImmersiveFullscreen()
        enableScreenshotBlocking()
        setContentView(R.layout.activity_orizon_player)

        val extras = intent.extras
        if (extras == null) {
            finish()
            return
        }
        session = try {
            StreamSessionBuilder.fromFlutterBundle(extras)
        } catch (e: Exception) {
            Log.e(TAG, "Invalid playback bundle", e)
            showUnavailableAndFinish()
            return
        }
        if (session.mpdUrl.isEmpty()) {
            showUnavailableAndFinish()
            return
        }

        parseFallbackUrls(extras.getString("fallbackStreamsJson"))
        playbackPreferences = readPlaybackPreferences(extras)
        PlaybackPreferences.update(
            dataSaver = playbackPreferences.dataSaver,
            defaultQuality = playbackPreferences.defaultQuality,
            videoZoomMode = playbackPreferences.videoZoomMode,
        )
        factory = OrizonPlayerFactory(this)
        playerView = findViewById(R.id.player_view)
        webContainer = findViewById(R.id.webview_container)
        zoomChip = findViewById(R.id.zoom_chip)
        zoomLabel = findViewById(R.id.zoom_label)
        zoomMode = normalizeZoomMode(playbackPreferences.videoZoomMode)
        applyZoomMode(zoomMode, announce = false)
        zoomChip.setOnClickListener { cycleZoom() }
        playerView.setKeepContentOnPlayerReset(true)
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        playerView.keepScreenOn = true
        playerView.controllerAutoShow = true
        playerView.setShowPreviousButton(false)
        playerView.setShowNextButton(false)
        playerView.setShowFastForwardButton(false)
        playerView.setShowRewindButton(false)
        playerView.setShowSubtitleButton(false)
        playerView.setErrorMessageProvider { error: PlaybackException ->
            if (factory.isHlsPlaylistReset(error)) {
                android.util.Pair(0, "")
            } else {
                android.util.Pair(0, getString(R.string.channel_unavailable_message))
            }
        }
        // Device back always leaves the player (do not navigate WebView history).
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    leavePlayer()
                }
            },
        )

        val classified = factory.lockedFormat(session.mpdUrl) ?: factory.classify(session.mpdUrl)
        Log.i(TAG, "open classified=$classified url=${session.mpdUrl.take(160)}")
        if (classified == OrizonPlayerFactory.Format.GATEWAY) {
            startWebView()
        } else {
            enqueueFormats(classified)
            startExo(classified)
        }
    }

    private fun readPlaybackPreferences(extras: Bundle): PlaybackPreferences {
        val dataSaver = extras.getBoolean("dataSaver")
        val defaultQuality = extras.getString("defaultQuality")?.trim().orEmpty().ifEmpty { "480p" }
        val zoom = extras.getString("videoZoomMode")?.lowercase()?.trim().orEmpty().ifEmpty { "contain" }
        return PlaybackPreferences(
            dataSaver = dataSaver,
            defaultQuality = defaultQuality,
            videoZoomMode = zoom,
        )
    }

    private fun normalizeZoomMode(raw: String): String {
        return when (raw.lowercase().trim()) {
            "fill", "cover", "zoom" -> "fill"
            "stretched", "stretch" -> "stretched"
            "normal", "fit" -> "normal"
            "contain" -> "contain"
            else -> "contain"
        }
    }

    private fun cycleZoom() {
        val idx = ZOOM_MODES.indexOf(zoomMode).let { if (it < 0) 0 else it }
        val next = ZOOM_MODES[(idx + 1) % ZOOM_MODES.size]
        applyZoomMode(next, announce = true)
    }

    private fun applyZoomMode(mode: String, announce: Boolean) {
        zoomMode = normalizeZoomMode(mode)
        playbackPreferences = playbackPreferences.copy(videoZoomMode = zoomMode)
        PlaybackPreferences.update(
            dataSaver = playbackPreferences.dataSaver,
            defaultQuality = playbackPreferences.defaultQuality,
            videoZoomMode = zoomMode,
        )
        // Distinct Exo modes: normal≈height-fit, contain=letterbox, fill=crop, stretch=distort.
        playerView.resizeMode = when (zoomMode) {
            "fill" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            "stretched" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            "normal" -> AspectRatioFrameLayout.RESIZE_MODE_FIXED_HEIGHT
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT // contain
        }
        webViewEngine?.setZoomMode(zoomMode)
        zoomLabel.setText(
            when (zoomMode) {
                "fill" -> R.string.zoom_fill
                "stretched" -> R.string.zoom_stretched
                "normal" -> R.string.zoom_normal
                else -> R.string.zoom_contain
            },
        )
        if (announce) {
            Toast.makeText(this, zoomLabel.text, Toast.LENGTH_SHORT).show()
        }
    }

    private fun enqueueFormats(first: OrizonPlayerFactory.Format) {
        formatQueue.clear()
        sameFormatRetries = 0
        // A known playlist or file stays on that parser. Trying DASH on `#EXTM3U` stops the stream.
        if (factory.lockedFormat(session.mpdUrl) != null) return
        val rest = listOf(
            OrizonPlayerFactory.Format.HLS,
            OrizonPlayerFactory.Format.DASH,
            OrizonPlayerFactory.Format.PROGRESSIVE,
        ).filter { it != first }
        formatQueue.addAll(rest)
    }

    private fun startExo(format: OrizonPlayerFactory.Format, soft: Boolean = false) {
        handlingError = false
        try {
            val exo = player ?: factory.createPlayer(
                session.preferredAudioLanguage,
                playbackPreferences,
            ).also { created ->
                created.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (playbackState == Player.STATE_READY) {
                            sameFormatRetries = 0
                            playlistResetReloads = 0
                            networkRetries = 0
                        }
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        handlePlaybackError(error)
                    }
                })
                player = created
                playerView.player = created
            }
            playerView.visibility = View.VISIBLE
            webContainer.visibility = View.GONE
            if (!soft && exo.mediaItemCount > 0) {
                exo.stop()
                exo.clearMediaItems()
            }
            factory.play(exo, session, format)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start Exo format=$format", e)
            retryOrFail()
        }
    }

    private fun startWebView() {
        handlingError = false
        Log.i(TAG, "failover → WebView url=${session.mpdUrl.take(160)}")
        try {
            playerView.player = null
            player?.release()
            player = null
            playerView.visibility = View.GONE
            webContainer.visibility = View.VISIBLE
            webViewEngine?.release()
            val engine = WebViewEngine(
                context = this,
                onPlaybackStateChanged = { state ->
                    if (state == PlaybackState.ENDED) showUnavailableAndFinish()
                },
                onError = { err ->
                    Log.e(TAG, "WebView error $err")
                    showUnavailableAndFinish()
                },
            )
            engine.initialize(session)
            val web = engine.getWebView()
            if (web != null) {
                (web.parent as? ViewGroup)?.removeView(web)
                webContainer.removeAllViews()
                webContainer.addView(
                    web,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
            }
            webViewEngine = engine
            engine.setZoomMode(zoomMode)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start WebView", e)
            showUnavailableAndFinish()
        }
    }

    private fun handlePlaybackError(error: PlaybackException) {
        if (isFinishing || handlingError) return
        if (factory.isHlsPlaylistReset(error)) {
            if (playlistResetReloads < MAX_PLAYLIST_RESET_RELOADS) {
                playlistResetReloads += 1
                handlingError = true
                Log.w(TAG, "Live HLS playlist restarted — reloading without leaving the player ($playlistResetReloads)")
                val format = factory.lockedFormat(session.mpdUrl) ?: OrizonPlayerFactory.Format.HLS
                startExo(format, soft = true)
                return
            }
        }
        if (isNetworkFailure(error) && networkRetries < MAX_NETWORK_RETRIES) {
            networkRetries += 1
            val delayMs = (1_500L * networkRetries).coerceAtMost(10_000L)
            handlingError = true
            Log.w(TAG, "No network — retry $networkRetries in ${delayMs}ms (${error.cause?.message})")
            mainHandler.postDelayed({
                if (isFinishing) return@postDelayed
                val format = factory.lockedFormat(session.mpdUrl) ?: OrizonPlayerFactory.Format.HLS
                startExo(format, soft = true)
            }, delayMs)
            return
        }
        handlingError = true
        Log.e(
            TAG,
            "Playback error ${error.errorCode} url=${session.mpdUrl.take(160)} cause=${error.cause?.message}",
            error,
        )
        retryOrFail(isHttpAccessError(error))
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

    private fun isHttpAccessError(error: PlaybackException): Boolean {
        val message = generateSequence(error.cause) { it.cause }
            .mapNotNull { it.message?.lowercase() }
            .joinToString(" ")
        return error.errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ||
            message.contains("response code: 403") ||
            message.contains("response code: 401") ||
            message.contains("response code: 404")
    }

    private fun retryOrFail(httpAccessError: Boolean = false) {
        val locked = factory.lockedFormat(session.mpdUrl)
        if (locked != null) {
            if (sameFormatRetries < MAX_SAME_FORMAT_RETRIES) {
                sameFormatRetries += 1
                Log.w(TAG, "reload format=$locked attempt=$sameFormatRetries")
                startExo(locked)
                return
            }
            Log.w(TAG, "locked format=$locked exhausted — not switching parser or WebView")
        } else {
            if (httpAccessError) {
                formatQueue.clear()
                Log.w(TAG, "HTTP access error — skip format retries")
            }
            val nextFormat = formatQueue.removeFirstOrNull()
            if (nextFormat != null) {
                Log.w(TAG, "retry format=$nextFormat")
                startExo(nextFormat)
                return
            }
        }
        val nextUrl = fallbackUrls.removeFirstOrNull()
        if (nextUrl != null) {
            Log.w(TAG, "retry fallback url=${nextUrl.take(160)}")
            session = session.copy(mpdUrl = nextUrl)
            val classified = factory.lockedFormat(nextUrl) ?: factory.classify(nextUrl)
            if (classified == OrizonPlayerFactory.Format.GATEWAY) {
                startWebView()
            } else {
                enqueueFormats(classified)
                startExo(classified)
            }
            return
        }
        // A raw playlist is not a web page. WebView failover only helps gateway HTML.
        if (locked == null && webViewEngine == null) {
            startWebView()
            return
        }
        showUnavailableAndFinish()
    }

    private fun parseFallbackUrls(json: String?) {
        if (json.isNullOrBlank()) return
        try {
            val arr = JSONArray(json)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val url = obj.optString("url").trim()
                if (url.isNotEmpty() && url != session.mpdUrl) fallbackUrls.add(url)
            }
        } catch (e: Exception) {
            Log.w(TAG, "fallbackStreamsJson parse failed", e)
        }
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
        webViewEngine?.pause()
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveFullscreen()
        player?.play()
        webViewEngine?.play()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveFullscreen()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        try {
            playerView.player = null
        } catch (_: Exception) {
        }
        try {
            player?.release()
        } catch (_: Exception) {
        }
        player = null
        try {
            webViewEngine?.release()
        } catch (_: Exception) {
        }
        webViewEngine = null
        super.onDestroy()
    }

    private fun leavePlayer() {
        if (isFinishing) return
        try {
            setResult(RESULT_OK)
        } catch (_: Exception) {
        }
        try {
            playerView.player = null
            player?.stop()
            player?.release()
        } catch (_: Exception) {
        }
        player = null
        try {
            webViewEngine?.release()
        } catch (_: Exception) {
        }
        webViewEngine = null
        finish()
    }

    private fun applyImmersiveFullscreen() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    private fun showUnavailableAndFinish() {
        if (isFinishing) return
        try {
            val msg = getString(R.string.channel_unavailable_message)
                .ifBlank { "Channel haipatikani sasa." }
            AlertDialog.Builder(this)
                .setMessage(msg)
                .setPositiveButton(R.string.ok_understood) { _, _ -> leavePlayer() }
                .setOnCancelListener { leavePlayer() }
                .setCancelable(true)
                .show()
        } catch (_: Exception) {
            leavePlayer()
        }
    }
}
