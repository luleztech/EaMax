package com.eamax

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import androidx.appcompat.app.AlertDialog
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.StreamQuality
import com.eamax.player.PlayerManager
import com.eamax.player.StreamSessionBuilder

/** Full-screen playback using the native PlayerManager stack (see repo `player/` sources). */
class EaMaxNativePlayerActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "EaMaxNativePlayer"
    }

    private lateinit var playerManager: PlayerManager
    private var exoBoundToView = false
    private var selectedOkoaQuality: StreamQuality = StreamQuality.QUALITY_360P
    private var okoaAppliedOnTracks = false

    private lateinit var rotateHintOverlay: FrameLayout
    private lateinit var rotateHintPhone: ImageView
    private var phoneHintAnimator: ObjectAnimator? = null
    /** [Baadae] — hide until next channel / new activity. */
    private var rotateHintDismissedThisSession = false
    /** After landscape once, do not show rotate hint again this session. */
    private var hasBeenLandscapeThisSession = false
    private var playbackReady = false
    private lateinit var webLoadingOverlay: FrameLayout
    private var unavailableDialogShown = false

    /** Never expose URLs / HTTP / DRM details to the user (security). */
    private fun showChannelUnavailableAndFinish() {
        if (isFinishing || unavailableDialogShown) return
        unavailableDialogShown = true
        try {
            AlertDialog.Builder(this)
                .setMessage(R.string.channel_unavailable_message)
                .setPositiveButton(R.string.ok_understood) { _, _ -> finish() }
                .setOnCancelListener { finish() }
                .setCancelable(true)
                .show()
        } catch (_: Exception) {
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // FULL_USER honors system rotation lock (often traps player in portrait). FULL_SENSOR + manifest
        // fullSensor tracks physical rotation for proper landscape fullscreen playback.
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
        applyImmersiveFullscreen()

        setContentView(R.layout.activity_native_player)

        if (resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            hasBeenLandscapeThisSession = true
        }

        val extras = intent.extras
        if (extras == null) {
            finish()
            return
        }

        val sessions = try {
            StreamSessionBuilder.fromFlutterBundleWithFallbacks(extras)
        } catch (e: Exception) {
            Log.e(TAG, "Invalid playback bundle", e)
            showChannelUnavailableAndFinish()
            return
        }

        if (sessions.isEmpty() || sessions.first().mpdUrl.isEmpty()) {
            showChannelUnavailableAndFinish()
            return
        }

        val session = sessions.first()

        val playerView = findViewById<PlayerView>(R.id.player_view).apply {
            applyResizeModeForOrientation()
            setKeepScreenOn(true)
            // Enable secure surface for DRM content to support Widevine L1
            if (session.drmType != DrmType.NONE) {
                (videoSurfaceView as? SurfaceView)?.setSecure(true)
                Log.d(TAG, "Secure surface enabled for DRM: ${session.drmType}")
            }
        }
        val webContainer = findViewById<FrameLayout>(R.id.webview_container)
        webLoadingOverlay = findViewById(R.id.web_loading_overlay)
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

        val close = findViewById<ImageButton>(R.id.btn_close)
        close.setOnClickListener { finish() }
        val okoaBundle = findViewById<Button>(R.id.btn_okoa_bundle)
        okoaBundle.setOnClickListener { showOkoaQualityDialog() }
        applyOkoaButtonInsets(okoaBundle)

        showWebLoadingOverlay()

        playerManager = PlayerManager(
            context = this,
            onStateChanged = { state ->
                runOnUiThread {
                    if (playerManager.isWebViewPlayback()) {
                        when (state) {
                            PlaybackState.PLAYING -> {
                                hideWebLoadingOverlay()
                                attachWebViewIfNeeded(webContainer, playerView)
                                playerManager.getWebView()?.alpha = 1f
                            }
                            PlaybackState.ENDED -> {
                                // Ignore ENDED from WebView when Exo took over (live TV handoff).
                                if (playerManager.getExoPlayer() != null) {
                                    Log.d(TAG, "Ignoring WebView ENDED — Exo player active")
                                    return@runOnUiThread
                                }
                                if (playerManager.shouldSuppressPlaybackError()) return@runOnUiThread
                                showChannelUnavailableAndFinish()
                            }
                            else -> { }
                        }
                        return@runOnUiThread
                    }
                }
                if (exoBoundToView || playerManager.isWebViewPlayback()) return@PlayerManager
                val attach = state == PlaybackState.BUFFERING ||
                    state == PlaybackState.READY ||
                    state == PlaybackState.PLAYING
                if (!attach) return@PlayerManager
                runOnUiThread {
                    hideWebLoadingOverlay()
                    webContainer.visibility = View.GONE
                    playerView.visibility = View.VISIBLE
                    bindExoToPlayerViewIfNeeded(playerView, strictNull = false)
                }
            },
            onError = { msg ->
                runOnUiThread {
                    if (isFinishing || unavailableDialogShown) return@runOnUiThread
                    Log.w(TAG, "Playback error: $msg")
                    if (playerManager.shouldSuppressPlaybackError()) {
                        Log.i(TAG, "Suppressing unavailable dialog — playback still active")
                        hideWebLoadingOverlay()
                        return@runOnUiThread
                    }
                    if (playerManager.tryRevertToWebViewPlayback()) {
                        Log.i(TAG, "Reverted to WebView — suppressing unavailable dialog")
                        attachWebViewIfNeeded(webContainer, playerView)
                        hideWebLoadingOverlay()
                        return@runOnUiThread
                    }
                    hideWebLoadingOverlay()
                    showChannelUnavailableAndFinish()
                }
            },
            onTracksAvailable = { tracks ->
                runOnUiThread {
                    if (isFinishing || okoaAppliedOnTracks || playerManager.isWebViewPlayback()) return@runOnUiThread
                    val hasVideo = tracks.groups.any { it.type == C.TRACK_TYPE_VIDEO && it.length > 0 }
                    if (!hasVideo) return@runOnUiThread
                    okoaAppliedOnTracks = true
                    playerManager.setQuality(selectedOkoaQuality, fromUser = false)
                }
            },
            onReady = {
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    playbackReady = true
                    exoBoundToView = false
                    okoaAppliedOnTracks = false
                    try {
                        close.bringToFront()
                        okoaBundle.bringToFront()
                        if (playerManager.isWebViewPlayback()) {
                            playerView.player = null
                            okoaBundle.visibility = View.VISIBLE
                            playerView.visibility = View.GONE
                            attachWebViewIfNeeded(webContainer, playerView)
                            showWebLoadingOverlay()
                            playerManager.getWebView()?.alpha = 0f
                            playerManager.setQuality(selectedOkoaQuality, fromUser = false)
                        } else {
                            exoBoundToView = false
                            hideWebLoadingOverlay()
                            webContainer.visibility = View.GONE
                            webContainer.removeAllViews()
                            playerView.visibility = View.VISIBLE
                            okoaBundle.visibility = View.VISIBLE
                            playerManager.setQuality(selectedOkoaQuality, fromUser = false)
                            bindExoToPlayerViewIfNeeded(playerView, strictNull = true)
                        }
                        maybeShowRotateHint()
                    } catch (e: Exception) {
                        Log.e(TAG, "onReady", e)
                        showChannelUnavailableAndFinish()
                    }
                }
            },
        )
        playerManager.initializeWithFailover(sessions)
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
            } else if (playbackReady) {
                maybeShowRotateHint()
            }

            // Re-measure after rotation so PlayerView / WebView fill the new window (avoids “stuck” portrait layout).
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
        // Landscape: zoom so video fills the display (true “fullscreen”); portrait: letterbox-fit.
        resizeMode = when (resources.configuration.orientation) {
            Configuration.ORIENTATION_LANDSCAPE ->
                AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    private fun syncExoVideoScalingForOrientation() {
        if (!::playerManager.isInitialized || playerManager.isWebViewPlayback()) return
        val p = playerManager.getExoPlayer() ?: return
        p.videoScalingMode = if (resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
        } else {
            C.VIDEO_SCALING_MODE_SCALE_TO_FIT
        }
    }

    private fun maybeShowRotateHint() {
        if (!playbackReady) return
        if (RotateHintPreferences.neverShowHint(this)) return
        if (rotateHintDismissedThisSession) return
        if (hasBeenLandscapeThisSession) return
        if (resources.configuration.orientation != Configuration.ORIENTATION_PORTRAIT) return
        rotateHintOverlay.visibility = View.VISIBLE
        startPhoneHintAnimation()
    }

    private fun hideWebLoadingOverlay() {
        if (::webLoadingOverlay.isInitialized) {
            webLoadingOverlay.visibility = View.GONE
        }
    }

    private fun showWebLoadingOverlay() {
        if (::webLoadingOverlay.isInitialized) {
            webLoadingOverlay.visibility = View.VISIBLE
            webLoadingOverlay.bringToFront()
            findViewById<ImageButton>(R.id.btn_close)?.bringToFront()
            findViewById<Button>(R.id.btn_okoa_bundle)?.bringToFront()
        }
    }

    private fun hideRotateHintOverlay() {
        phoneHintAnimator?.cancel()
        phoneHintAnimator = null
        rotateHintPhone.rotation = 0f
        rotateHintOverlay.visibility = View.GONE
    }

    private fun startPhoneHintAnimation() {
        phoneHintAnimator?.cancel()
        phoneHintAnimator = ObjectAnimator.ofFloat(rotateHintPhone, View.ROTATION, -16f, 16f).apply {
            duration = 900L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = LinearInterpolator()
            start()
        }
    }

    private fun applyOkoaButtonInsets(okoaBundle: Button) {
        val baseTop = (16 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(okoaBundle) { v, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            val lp = v.layoutParams as? FrameLayout.LayoutParams
            if (lp != null) {
                lp.topMargin = baseTop + top
                v.layoutParams = lp
            }
            insets
        }
        ViewCompat.requestApplyInsets(okoaBundle)
    }

    private fun showOkoaQualityDialog() {
        val qualities = listOf(
            StreamQuality.AUTO,
            StreamQuality.QUALITY_240P,
            StreamQuality.QUALITY_360P,
            StreamQuality.QUALITY_480P,
            StreamQuality.QUALITY_720P,
            StreamQuality.QUALITY_1080P,
        )
        val initial = qualities.indexOf(selectedOkoaQuality).let { if (it >= 0) it else 2 }
        AlertDialog.Builder(this)
            .setTitle(R.string.pick_quality)
            .setSingleChoiceItems(
                qualities.map { it.label }.toTypedArray(),
                initial,
            ) { d, which ->
                selectedOkoaQuality = qualities[which]
                playerManager.setQuality(selectedOkoaQuality, fromUser = true)
                d.dismiss()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun attachWebViewIfNeeded(webContainer: FrameLayout, playerView: PlayerView) {
        val w = playerManager.getWebViewForReattach() ?: run {
            hideWebLoadingOverlay()
            showChannelUnavailableAndFinish()
            return
        }
        webContainer.visibility = View.VISIBLE
        playerView.visibility = View.GONE
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
    }

    private fun bindExoToPlayerViewIfNeeded(playerView: PlayerView, strictNull: Boolean) {
        if (exoBoundToView || playerManager.isWebViewPlayback()) return
        val p = playerManager.getExoPlayer()
        if (p == null) {
            if (strictNull) {
                playerView.postDelayed({
                    if (isFinishing || unavailableDialogShown || exoBoundToView) return@postDelayed
                    if (playerManager.shouldSuppressPlaybackError()) {
                        bindExoToPlayerViewIfNeeded(playerView, strictNull = false)
                        return@postDelayed
                    }
                    val retry = playerManager.getExoPlayer()
                    if (retry != null) {
                        bindExoToPlayerViewIfNeeded(playerView, strictNull = false)
                    } else if (!playerManager.shouldSuppressPlaybackError()) {
                        showChannelUnavailableAndFinish()
                    }
                }, 500)
            }
            return
        }
        try {
            playerView.player = p
            p.volume = 1f
            p.playWhenReady = true
            p.videoScalingMode = if (resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
                C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
            } else {
                C.VIDEO_SCALING_MODE_SCALE_TO_FIT
            }
            exoBoundToView = true
        } catch (e: Exception) {
            Log.e(TAG, "bindExoToPlayerViewIfNeeded", e)
            showChannelUnavailableAndFinish()
        }
    }

    override fun onDestroy() {
        phoneHintAnimator?.cancel()
        if (::playerManager.isInitialized) {
            playerManager.release()
        }
        super.onDestroy()
    }
}
