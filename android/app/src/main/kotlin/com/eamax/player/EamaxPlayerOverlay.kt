package com.eamax.player

import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.ProgressBar
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.eamax.domain.model.PlaybackState

/**
 * Loading and buffering indicators only — does not modify native Media3 controller widgets.
 */
@OptIn(UnstableApi::class)
class EamaxPlayerOverlay(
    private val loadingOverlay: View,
    private val bufferingBar: ProgressBar,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var attachedPlayer: Player? = null
    private var webViewMode = false
    private var playbackState = PlaybackState.IDLE
    private var firstFrameShown = false

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            syncFromPlayer(attachedPlayer)
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            syncFromPlayer(attachedPlayer)
        }

        override fun onRenderedFirstFrame() {
            markFirstFrameReady()
        }
    }

    fun attachExoPlayer(player: Player) {
        detach()
        webViewMode = false
        attachedPlayer = player
        player.addListener(playerListener)
        syncFromPlayer(player)
    }

    /**
     * @param alreadyPlaying When WebView is already decoding (e.g. revert after failed Exo promotion),
     *   keep the screen clean — never re-show the full-screen spinner.
     */
    fun attachWebViewMode(alreadyPlaying: Boolean = false) {
        detach()
        webViewMode = true
        attachedPlayer = null
        if (alreadyPlaying || playbackState == PlaybackState.PLAYING) {
            markFirstFrameReady()
        } else {
            firstFrameShown = false
            loadingOverlay.visibility = View.VISIBLE
            bufferingBar.visibility = View.GONE
        }
    }

    fun detach() {
        attachedPlayer?.removeListener(playerListener)
        attachedPlayer = null
        mainHandler.removeCallbacksAndMessages(null)
    }

    fun onEngineStateChanged(state: PlaybackState) {
        playbackState = state
        when (state) {
            PlaybackState.PLAYING -> {
                markFirstFrameReady()
                bufferingBar.visibility = View.GONE
            }
            PlaybackState.BUFFERING -> {
                if (webViewMode) {
                    if (firstFrameShown) {
                        // Rebuffering after first play — show only thin bar, keep video visible.
                        loadingOverlay.visibility = View.GONE
                        bufferingBar.visibility = View.VISIBLE
                    } else {
                        // Initial WebView load — keep full overlay, show spinning bar.
                        bufferingBar.visibility = View.VISIBLE
                    }
                } else {
                    showBufferingIndicator()
                }
            }
            PlaybackState.READY -> {
                bufferingBar.visibility = View.GONE
                if (!webViewMode && attachedPlayer != null) {
                    syncFromPlayer(attachedPlayer)
                }
            }
            PlaybackState.PAUSED -> bufferingBar.visibility = View.GONE
            else -> { }
        }
    }

    /** Gateway → Exo handoff: keep video visible, only show the thin top bar while rebuffering. */
    fun markStreamHandoff() {
        firstFrameShown = true
        loadingOverlay.visibility = View.GONE
        bufferingBar.visibility = View.VISIBLE
    }

    fun resetForNewStream() {
        firstFrameShown = false
        loadingOverlay.visibility = View.VISIBLE
        bufferingBar.visibility = View.GONE
    }

    fun dismissLoadingForWebView() {
        markFirstFrameReady()
    }

    private fun markFirstFrameReady() {
        firstFrameShown = true
        loadingOverlay.visibility = View.GONE
        bufferingBar.visibility = View.GONE
    }

    private fun showBufferingIndicator() {
        if (firstFrameShown || playbackState == PlaybackState.PLAYING || attachedPlayer?.isPlaying == true) {
            loadingOverlay.visibility = View.GONE
            bufferingBar.visibility = View.VISIBLE
        } else if (webViewMode) {
            // WebView initial load — spinner stays until PLAYING; no full overlay on rebuffer.
            bufferingBar.visibility = View.VISIBLE
        } else {
            bufferingBar.visibility = View.GONE
            loadingOverlay.visibility = View.VISIBLE
        }
    }

    /** Sync overlay when listener attaches after Exo already prepared (avoids spinner over playing video). */
    private fun syncFromPlayer(player: Player?) {
        if (webViewMode || player == null) return

        val ready = player.playbackState == Player.STATE_READY ||
            player.playbackState == Player.STATE_BUFFERING ||
            player.playbackState == Player.STATE_ENDED
        val playing = player.isPlaying

        if (ready || playing) {
            firstFrameShown = true
            loadingOverlay.visibility = View.GONE
        }

        if (player.playbackState == Player.STATE_BUFFERING && firstFrameShown) {
            bufferingBar.visibility = View.VISIBLE
        } else if (player.playbackState == Player.STATE_READY && playing) {
            bufferingBar.visibility = View.GONE
        } else if (player.playbackState == Player.STATE_READY && !playing) {
            bufferingBar.visibility = View.GONE
        }
    }
}
