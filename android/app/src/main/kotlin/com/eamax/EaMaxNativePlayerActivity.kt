package com.eamax

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.util.Log
import androidx.annotation.OptIn
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.ErrorMessageProvider
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.StreamQuality
import com.eamax.player.PlayerManager
import com.eamax.player.PlayerRuntimeConfig
import com.eamax.player.StreamSessionBuilder
import com.eamax.player.FallbackStreamParser
import com.eamax.player.EamaxPlayerOverlay
import org.json.JSONObject

/**
 * Full-screen landscape player with leotena-style chrome:
 * auto-hiding controls, MOJA KWA MOJA badge, Lugha / Ubora / Badili Kituo chips.
 */
class EaMaxNativePlayerActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "EaMaxNativePlayer"
        private const val CONTROLS_HIDE_MS = 4_000L
    }

    private lateinit var playerManager: PlayerManager
    private var exoBoundToView = false
    private var selectedOkoaQuality: StreamQuality = StreamQuality.QUALITY_480P
    private var preferredAudioLanguage: String = "sw"
    private lateinit var playerOverlay: EamaxPlayerOverlay
    private lateinit var loadingOverlay: View
    private lateinit var bufferingBar: ProgressBar

    private lateinit var rotateHintOverlay: FrameLayout
    private lateinit var rotateHintPhone: ImageView
    private var phoneHintAnimator: ObjectAnimator? = null
    private var rotateHintDismissedThisSession = false
    private var hasBeenLandscapeThisSession = false
    private var playbackReady = false
    private lateinit var playerViewRef: PlayerView
    private lateinit var playerTopTools: LinearLayout

    private lateinit var playerChrome: View
    private lateinit var chromeTapCatcher: View
    private lateinit var humanCheckBack: ImageButton
    private lateinit var playPauseBtn: ImageButton
    private lateinit var languageChip: TextView
    private lateinit var qualityChip: TextView
    private lateinit var titleView: TextView
    private var controlsVisible = true
    private var humanCheckActive = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val hideControlsRunnable = Runnable {
        if (!humanCheckActive) hideControls()
    }
    private var channelName: String = ""
    private var playbackErrorPending = false
    private var webViewAttachAttempts = 0

    private val exoPlayListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            updatePlayPauseIcon(isPlaying)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            val p = playerManager.getExoPlayer() ?: return
            updatePlayPauseIcon(p.isPlaying)
        }
    }

    private fun showChannelUnavailableAndFinish() {
        if (isFinishing) return
        if (playbackErrorPending) return
        playbackErrorPending = true
        mainHandler.postDelayed({
            if (isFinishing) return@postDelayed
            if (playerManager.isPlaying()) {
                playbackErrorPending = false
                return@postDelayed
            }
            try {
                AlertDialog.Builder(this)
                    .setTitle(R.string.player_error_title)
                    .setMessage(R.string.channel_unavailable_message)
                    .setPositiveButton(R.string.ok_understood) { _, _ -> finish() }
                    .setOnCancelListener { finish() }
                    .setCancelable(true)
                    .show()
            } catch (_: Exception) {
                finish()
            }
        }, 8_000L)
    }

    private fun cancelPendingPlaybackError() {
        playbackErrorPending = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Match leotena: force landscape for the player session.
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        applyImmersiveFullscreen()

        setContentView(R.layout.activity_native_player)

        hasBeenLandscapeThisSession = true

        val extras = intent.extras
        if (extras == null) {
            finish()
            return
        }

        val session = try {
            StreamSessionBuilder.fromFlutterBundle(extras)
        } catch (e: Exception) {
            Log.e(TAG, "Invalid playback bundle", e)
            showChannelUnavailableAndFinish()
            return
        }

        if (session.mpdUrl.isEmpty()) {
            showChannelUnavailableAndFinish()
            return
        }

        channelName = extras.getString("channelName").orEmpty().ifBlank { getString(R.string.player_live) }

        extras.getString("playerPolicyJson")?.trim()?.takeIf { it.isNotEmpty() }?.let { policyJson ->
            try {
                val o = JSONObject(policyJson)
                val map = buildMap<String, Any?> {
                    for (key in o.keys()) {
                        put(key, o.get(key))
                    }
                }
                PlayerRuntimeConfig.applyFromArgs(map)
            } catch (e: Exception) {
                Log.w(TAG, "playerPolicyJson parse failed: ${e.message}")
            }
        }

        val defaultQualityRaw = extras.getString("defaultQuality")
        selectedOkoaQuality = PlayerRuntimeConfig.parseQuality(defaultQualityRaw)
        PlayerRuntimeConfig.defaultQuality = selectedOkoaQuality

        val fallbackJson = extras.getString("fallbackStreamsJson").orEmpty()
        val fallbackSessions = FallbackStreamParser.parse(fallbackJson, session)

        playerViewRef = findViewById<PlayerView>(R.id.player_view).apply {
            applyResizeModeForOrientation()
            setKeepScreenOn(true)
            setErrorMessageProvider(
                ErrorMessageProvider { _: PlaybackException ->
                    android.util.Pair(0, getString(R.string.player_error_title))
                },
            )
        }
        val playerView = playerViewRef
        val webContainer = findViewById<FrameLayout>(R.id.webview_container)
        loadingOverlay = findViewById(R.id.loading_overlay)
        loadingOverlay.isClickable = false
        loadingOverlay.isFocusable = false
        loadingOverlay.setOnTouchListener { _, _ -> false }
        bufferingBar = findViewById(R.id.buffering_bar)
        playerOverlay = EamaxPlayerOverlay(
            loadingOverlay = loadingOverlay,
            bufferingBar = bufferingBar,
        )
        playerOverlay.resetForNewStream()

        rotateHintOverlay = findViewById(R.id.rotate_hint_overlay)
        rotateHintPhone = findViewById(R.id.rotate_hint_phone)
        findViewById<Button>(R.id.btn_rotate_hint_later).setOnClickListener {
            rotateHintDismissedThisSession = true
            hideRotateHintOverlay()
        }
        findViewById<Button>(R.id.btn_rotate_hint_never).setOnClickListener {
            RotateHintPreferences.setNeverShowHint(this, true)
            rotateHintDismissedThisSession = true
            hideRotateHintOverlay()
        }

        bindChromeUi()

        if (session.drmType != DrmType.NONE) {
            (playerView.videoSurfaceView as? SurfaceView)?.setSecure(true)
            Log.d(TAG, "Secure surface enabled for DRM: ${session.drmType}")
        }

        preferredAudioLanguage =
            PlayerLanguagePreferences.get(this) ?: session.preferredAudioLanguage.ifBlank { "sw" }
        refreshLanguageChip()
        refreshQualityChip()

        playerManager = PlayerManager(
            context = this,
            onStateChanged = { state ->
                runOnUiThread {
                    if (humanCheckActive && state != PlaybackState.PLAYING) {
                        // Keep overlays clear while user verifies reCAPTCHA.
                        clearOverlaysForHumanCheck()
                    } else {
                        playerOverlay.onEngineStateChanged(state)
                    }
                    if (playerManager.isWebViewPlayback()) {
                        when (state) {
                            PlaybackState.BUFFERING,
                            PlaybackState.READY,
                            PlaybackState.PLAYING -> {
                                attachWebViewIfNeeded(webContainer, playerView)
                                ensureAutoplay()
                                if (state == PlaybackState.PLAYING) {
                                    cancelPendingPlaybackError()
                                    updatePlayPauseIcon(true)
                                    if (!humanCheckActive) scheduleHideControls()
                                }
                            }
                            PlaybackState.PAUSED -> updatePlayPauseIcon(false)
                            PlaybackState.ENDED -> showChannelUnavailableAndFinish()
                            else -> { }
                        }
                        return@runOnUiThread
                    }
                    if (!playerManager.isExoPlayback()) return@runOnUiThread
                    val attach = state == PlaybackState.BUFFERING ||
                        state == PlaybackState.READY ||
                        state == PlaybackState.PLAYING
                    if (attach) {
                        webContainer.visibility = View.GONE
                        playerView.visibility = View.VISIBLE
                        bindExoToPlayerViewIfNeeded(playerView, strictNull = false)
                        ensureAutoplay()
                    }
                    when (state) {
                        PlaybackState.PLAYING -> {
                            cancelPendingPlaybackError()
                            updatePlayPauseIcon(true)
                            scheduleHideControls()
                        }
                        PlaybackState.PAUSED -> updatePlayPauseIcon(false)
                        PlaybackState.READY, PlaybackState.BUFFERING -> ensureAutoplay()
                        else -> { }
                    }
                }
            },
            onError = { msg ->
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    Log.w(TAG, "Playback error: $msg")
                    showChannelUnavailableAndFinish()
                }
            },
            onHumanCheck = { needed ->
                runOnUiThread {
                    // Never expose captcha UI — always stay in normal autoplay chrome.
                    if (needed) {
                        Log.i(TAG, "Ignoring human-check request — silent play mode")
                        setHumanCheckMode(false)
                    } else {
                        setHumanCheckMode(false)
                    }
                }
            },
        )
        playerManager.setInitialQuality(selectedOkoaQuality)
        val playbackSession = session.copy(preferredAudioLanguage = preferredAudioLanguage)
        playerManager.initialize(playbackSession, fallbackSessions)
        playbackReady = true
        syncPlaybackSurface()
        ensureAutoplay()
        mainHandler.postDelayed({ if (!isFinishing) ensureAutoplay() }, 800L)
        showControls()
        scheduleHideControls()
    }

    private fun bindChromeUi() {
        playerChrome = findViewById(R.id.player_chrome)
        chromeTapCatcher = findViewById(R.id.chrome_tap_catcher)
        humanCheckBack = findViewById(R.id.btn_human_check_back)
        playPauseBtn = findViewById(R.id.btn_player_play_pause)
        languageChip = findViewById(R.id.btn_player_language)
        qualityChip = findViewById(R.id.btn_player_settings)
        titleView = findViewById(R.id.player_title)
        playerTopTools = findViewById(R.id.player_top_tools)

        titleView.text = channelName

        findViewById<ImageButton>(R.id.btn_player_back).setOnClickListener { finish() }
        humanCheckBack.setOnClickListener { finish() }

        playPauseBtn.setOnClickListener {
            if (humanCheckActive) return@setOnClickListener
            togglePlayPause()
            scheduleHideControls()
        }

        languageChip.setOnClickListener {
            if (humanCheckActive) return@setOnClickListener
            showAudioLanguageDialog()
            scheduleHideControls()
        }
        qualityChip.setOnClickListener {
            if (humanCheckActive) return@setOnClickListener
            showQualityDialog()
            scheduleHideControls()
        }
        findViewById<TextView>(R.id.btn_player_switch_channel).setOnClickListener {
            finish()
        }

        playerChrome.setOnClickListener {
            if (!humanCheckActive) toggleControls()
        }
        chromeTapCatcher.setOnClickListener {
            if (!humanCheckActive) showControls()
        }
    }

    private fun setHumanCheckMode(needed: Boolean) {
        if (humanCheckActive == needed) {
            if (needed) clearOverlaysForHumanCheck()
            return
        }
        humanCheckActive = needed
        if (needed) {
            Log.i(TAG, "Entering human-check mode — overlays cleared for reCAPTCHA")
            mainHandler.removeCallbacks(hideControlsRunnable)
            clearOverlaysForHumanCheck()
            humanCheckBack.visibility = View.VISIBLE
            humanCheckBack.bringToFront()
        } else {
            Log.i(TAG, "Leaving human-check mode — restoring player chrome")
            humanCheckBack.visibility = View.GONE
            showControls()
        }
    }

    /** Hide every touch-blocking layer so the WebView captcha can be tapped. */
    private fun clearOverlaysForHumanCheck() {
        mainHandler.removeCallbacks(hideControlsRunnable)
        controlsVisible = false
        if (::playerChrome.isInitialized) playerChrome.visibility = View.GONE
        if (::chromeTapCatcher.isInitialized) chromeTapCatcher.visibility = View.GONE
        if (::loadingOverlay.isInitialized) loadingOverlay.visibility = View.GONE
        if (::bufferingBar.isInitialized) bufferingBar.visibility = View.GONE
        if (::playerOverlay.isInitialized) playerOverlay.clearForHumanCheck()
        if (::humanCheckBack.isInitialized) {
            humanCheckBack.visibility = View.VISIBLE
            humanCheckBack.bringToFront()
        }
        // Keep WebView on top of chrome layers for touch delivery.
        findViewById<FrameLayout>(R.id.webview_container)?.bringToFront()
        if (::humanCheckBack.isInitialized) humanCheckBack.bringToFront()
    }

    private fun togglePlayPause() {
        if (!::playerManager.isInitialized || humanCheckActive) return
        if (playerManager.isPlaying()) {
            playerManager.pause()
            updatePlayPauseIcon(false)
        } else {
            playerManager.play()
            updatePlayPauseIcon(true)
        }
    }

    private fun updatePlayPauseIcon(playing: Boolean) {
        if (!::playPauseBtn.isInitialized) return
        playPauseBtn.setImageResource(
            if (playing) android.R.drawable.ic_media_pause
            else android.R.drawable.ic_media_play,
        )
    }

    private fun showControls() {
        if (humanCheckActive) {
            clearOverlaysForHumanCheck()
            return
        }
        controlsVisible = true
        playerChrome.visibility = View.VISIBLE
        chromeTapCatcher.visibility = View.GONE
        scheduleHideControls()
    }

    private fun hideControls() {
        if (humanCheckActive) {
            clearOverlaysForHumanCheck()
            return
        }
        controlsVisible = false
        playerChrome.visibility = View.GONE
        chromeTapCatcher.visibility = View.VISIBLE
    }

    private fun toggleControls() {
        if (humanCheckActive) return
        if (controlsVisible) hideControls() else showControls()
    }

    private fun scheduleHideControls() {
        if (humanCheckActive) return
        mainHandler.removeCallbacks(hideControlsRunnable)
        mainHandler.postDelayed(hideControlsRunnable, CONTROLS_HIDE_MS)
    }

    private fun refreshLanguageChip() {
        if (!::languageChip.isInitialized) return
        languageChip.text = getString(
            if (preferredAudioLanguage == "en") R.string.player_chip_language_en
            else R.string.player_chip_language,
        )
    }

    private fun refreshQualityChip() {
        if (!::qualityChip.isInitialized) return
        qualityChip.text = getString(R.string.player_chip_quality, selectedOkoaQuality.label)
    }

    private fun syncPlaybackSurface() {
        val webContainer = findViewById<FrameLayout>(R.id.webview_container)
        val playerView = playerViewRef
        if (playerManager.isWebViewPlayback()) {
            val webAlreadyPlaying = playerManager.isPlaying()
            playerOverlay.attachWebViewMode(alreadyPlaying = webAlreadyPlaying)
            playerView.player = null
            exoBoundToView = false
            attachWebViewIfNeeded(webContainer, playerView)
            playerManager.setQuality(selectedOkoaQuality, fromUser = false)
            ensureAutoplay()
        } else if (playerManager.isExoPlayback()) {
            playerOverlay.markStreamHandoff()
            exoBoundToView = false
            webContainer.visibility = View.GONE
            webContainer.removeAllViews()
            playerView.visibility = View.VISIBLE
            playerManager.setQuality(selectedOkoaQuality, fromUser = false)
            bindExoToPlayerViewIfNeeded(playerView, strictNull = true)
            playerManager.getExoPlayer()?.let {
                playerOverlay.attachExoPlayer(it)
                it.removeListener(exoPlayListener)
                it.addListener(exoPlayListener)
            }
            ensureAutoplay()
        }
    }

    /** Start playback once — Exo uses playWhenReady; avoid duplicate play() storms. */
    private fun ensureAutoplay() {
        if (!::playerManager.isInitialized || isFinishing) return
        if (!PlayerRuntimeConfig.autoPlay) return
        try {
            playerManager.play()
            playerManager.getExoPlayer()?.let { p ->
                if (!p.playWhenReady) p.playWhenReady = true
                updatePlayPauseIcon(p.isPlaying)
            }
            if (playerManager.isWebViewPlayback()) {
                updatePlayPauseIcon(true)
            }
        } catch (e: Exception) {
            Log.w(TAG, "ensureAutoplay: ${e.message}")
        }
    }

    private fun showAudioLanguageDialog() {
        if (!::playerManager.isInitialized || isFinishing) return
        val labels = arrayOf(
            getString(R.string.language_swahili),
            getString(R.string.language_english),
        )
        val codes = arrayOf("sw", "en")
        val checked = if (preferredAudioLanguage == "en") 1 else 0
        try {
            AlertDialog.Builder(this, androidx.appcompat.R.style.Theme_AppCompat_Dialog_Alert)
                .setTitle(R.string.pick_language)
                .setSingleChoiceItems(labels, checked) { d, which ->
                    try {
                        preferredAudioLanguage = codes[which]
                        PlayerLanguagePreferences.set(this, preferredAudioLanguage)
                        playerManager.setAudioLanguage(preferredAudioLanguage)
                        refreshLanguageChip()
                        ensureAutoplay()
                    } catch (e: Exception) {
                        Log.e(TAG, "language switch failed", e)
                    }
                    d.dismiss()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        } catch (e: Exception) {
            Log.e(TAG, "showAudioLanguageDialog", e)
        }
    }

    private fun showQualityDialog() {
        if (!::playerManager.isInitialized || isFinishing) return
        val qualities = listOf(
            StreamQuality.AUTO,
            StreamQuality.QUALITY_240P,
            StreamQuality.QUALITY_360P,
            StreamQuality.QUALITY_480P,
            StreamQuality.QUALITY_720P,
            StreamQuality.QUALITY_1080P,
        )
        val initial = qualities.indexOf(selectedOkoaQuality).let { if (it >= 0) it else 0 }
        try {
            AlertDialog.Builder(this, androidx.appcompat.R.style.Theme_AppCompat_Dialog_Alert)
                .setTitle(R.string.pick_quality)
                .setSingleChoiceItems(
                    qualities.map { it.label }.toTypedArray(),
                    initial,
                ) { d, which ->
                    try {
                        val q = qualities[which]
                        selectedOkoaQuality = q
                        playerManager.setQuality(q, fromUser = true)
                        refreshQualityChip()
                        ensureAutoplay()
                        Log.d(TAG, "User picked quality: $q")
                    } catch (e: Exception) {
                        Log.e(TAG, "quality switch failed", e)
                    }
                    d.dismiss()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        } catch (e: Exception) {
            Log.e(TAG, "showQualityDialog", e)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveFullscreen()
    }

    private fun applyImmersiveFullscreen() {
        enableScreenshotBlocking()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        try {
            super.onConfigurationChanged(newConfig)
            applyImmersiveFullscreen()
            val playerView = findViewById<PlayerView>(R.id.player_view)
            val webContainer = findViewById<FrameLayout>(R.id.webview_container)
            playerView.applyResizeModeForOrientation()
            syncExoVideoScalingForOrientation()

            if (newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE) {
                hasBeenLandscapeThisSession = true
                hideRotateHintOverlay()
            }

            window.decorView.post {
                try {
                    playerView.requestLayout()
                    playerView.invalidate()
                    webContainer.requestLayout()
                    webContainer.invalidate()
                } catch (e: Exception) {
                    Log.w(TAG, "layout after rotation: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "onConfigurationChanged", e)
        }
    }

    private fun PlayerView.applyResizeModeForOrientation() {
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
    }

    private fun syncExoVideoScalingForOrientation() {
        if (!::playerManager.isInitialized || playerManager.isWebViewPlayback()) return
        val p = playerManager.getExoPlayer() ?: return
        p.videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
    }

    private fun hideRotateHintOverlay() {
        phoneHintAnimator?.cancel()
        phoneHintAnimator = null
        if (::rotateHintPhone.isInitialized) rotateHintPhone.rotation = 0f
        if (::rotateHintOverlay.isInitialized) rotateHintOverlay.visibility = View.GONE
    }

    private fun attachWebViewIfNeeded(webContainer: FrameLayout, playerView: PlayerView) {
        val w = playerManager.getWebView()
        if (w == null) {
            if (webViewAttachAttempts < 8) {
                webViewAttachAttempts++
                mainHandler.postDelayed({
                    if (!isFinishing) attachWebViewIfNeeded(webContainer, playerView)
                }, 400L)
            }
            return
        }
        webViewAttachAttempts = 0
        try {
            playerView.player = null
        } catch (_: Exception) {
        }
        exoBoundToView = false
        webContainer.visibility = View.VISIBLE
        playerView.visibility = View.GONE
        w.visibility = View.VISIBLE
        if (w.parent !== webContainer) {
            (w.parent as? android.view.ViewGroup)?.removeView(w)
            webContainer.removeAllViews()
            webContainer.addView(
                w,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
        }
        Log.d(TAG, "WebView added to player container")
    }

    private fun bindExoToPlayerViewIfNeeded(playerView: PlayerView, strictNull: Boolean) {
        if (exoBoundToView || !playerManager.isExoPlayback()) return
        val p = playerManager.getExoPlayer()
        if (p == null) {
            if (strictNull) {
                showChannelUnavailableAndFinish()
            }
            return
        }
        try {
            playerView.player = p
            p.volume = 1f
            p.playWhenReady = true
            p.play()
            p.videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
            p.removeListener(exoPlayListener)
            p.addListener(exoPlayListener)
            updatePlayPauseIcon(true)
            exoBoundToView = true
        } catch (e: Exception) {
            Log.e(TAG, "bindExoToPlayerViewIfNeeded", e)
            showChannelUnavailableAndFinish()
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(hideControlsRunnable)
        phoneHintAnimator?.cancel()
        if (::playerOverlay.isInitialized) {
            playerOverlay.detach()
        }
        if (::playerManager.isInitialized) {
            playerManager.getExoPlayer()?.removeListener(exoPlayListener)
            playerManager.release()
        }
        // Restore portrait for Flutter UI.
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        super.onDestroy()
    }
}
