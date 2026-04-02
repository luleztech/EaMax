package com.eamax

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.eamax.domain.model.PlaybackState
import com.eamax.domain.model.StreamQuality
import com.eamax.player.PlayerManager
import com.eamax.player.StreamSessionBuilder

/** Full-screen playback using the native PlayerManager stack (see repo `player/` sources). */
class EaMaxNativePlayerActivity : AppCompatActivity() {

    private lateinit var playerManager: PlayerManager
    private var exoBoundToView = false
    private var selectedOkoaQuality: StreamQuality = StreamQuality.QUALITY_360P

    private lateinit var rotateHintOverlay: FrameLayout
    private lateinit var rotateHintPhone: ImageView
    private var phoneHintAnimator: ObjectAnimator? = null
    /** [Baadae] — hide until next channel / new activity. */
    private var rotateHintDismissedThisSession = false
    /** After landscape once, do not show rotate hint again this session. */
    private var hasBeenLandscapeThisSession = false
    private var playbackReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
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

        val playerView = findViewById<PlayerView>(R.id.player_view).apply {
            applyResizeModeForOrientation()
            setKeepScreenOn(true)
        }
        val webContainer = findViewById<FrameLayout>(R.id.webview_container)
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

        val session = try {
            StreamSessionBuilder.fromFlutterBundle(extras)
        } catch (e: Exception) {
            Toast.makeText(this, e.message ?: "Invalid playback", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        if (session.mpdUrl.isEmpty()) {
            Toast.makeText(this, "Missing URL", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        playerManager = PlayerManager(
            context = this,
            onStateChanged = { state ->
                if (exoBoundToView || playerManager.isWebViewPlayback()) return@PlayerManager
                val attach = state == PlaybackState.BUFFERING ||
                    state == PlaybackState.READY ||
                    state == PlaybackState.PLAYING
                if (!attach) return@PlayerManager
                runOnUiThread { bindExoToPlayerViewIfNeeded(playerView, strictNull = false) }
            },
            onError = { msg ->
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    Toast.makeText(this@EaMaxNativePlayerActivity, msg, Toast.LENGTH_LONG).show()
                    finish()
                }
            },
            onTracksAvailable = {},
            onReady = {
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    playbackReady = true
                    try {
                        if (playerManager.isWebViewPlayback()) {
                            okoaBundle.visibility = View.VISIBLE
                            playerView.visibility = View.GONE
                            webContainer.visibility = View.VISIBLE
                            webContainer.removeAllViews()
                            playerManager.getWebView()?.let { w ->
                                webContainer.addView(
                                    w,
                                    FrameLayout.LayoutParams(
                                        FrameLayout.LayoutParams.MATCH_PARENT,
                                        FrameLayout.LayoutParams.MATCH_PARENT,
                                    ),
                                )
                            } ?: run {
                                Toast.makeText(this@EaMaxNativePlayerActivity, "Haikuweza kupakia kiunganishi", Toast.LENGTH_LONG).show()
                                finish()
                            }
                            playerManager.setQuality(selectedOkoaQuality)
                        } else {
                            okoaBundle.visibility = View.GONE
                            bindExoToPlayerViewIfNeeded(playerView, strictNull = true)
                        }
                        maybeShowRotateHint()
                    } catch (e: Exception) {
                        Toast.makeText(this@EaMaxNativePlayerActivity, e.message ?: "Playback error", Toast.LENGTH_LONG).show()
                        finish()
                    }
                }
            },
        )
        playerManager.initialize(session)
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
        super.onConfigurationChanged(newConfig)
        applyImmersiveFullscreen()
        val playerView = findViewById<PlayerView>(R.id.player_view)
        playerView.applyResizeModeForOrientation()
        syncExoVideoScalingForOrientation()

        if (newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            hasBeenLandscapeThisSession = true
            hideRotateHintOverlay()
        } else if (playbackReady) {
            maybeShowRotateHint()
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
                playerManager.setQuality(selectedOkoaQuality)
                d.dismiss()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun bindExoToPlayerViewIfNeeded(playerView: PlayerView, strictNull: Boolean) {
        if (exoBoundToView || playerManager.isWebViewPlayback()) return
        val p = playerManager.getExoPlayer()
        if (p == null) {
            if (strictNull) {
                Toast.makeText(this, "Haikuweza kuanza kichezaji", Toast.LENGTH_LONG).show()
                finish()
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
            Toast.makeText(this, e.message ?: "Playback error", Toast.LENGTH_LONG).show()
            finish()
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
