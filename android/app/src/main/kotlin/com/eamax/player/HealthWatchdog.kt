package com.eamax.player

import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Detects stuck playback (infinite buffer, black screen, frozen position)
 * and triggers auto-healing without user intervention.
 */
class HealthWatchdog(
    private val onHeal: (symptom: String) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var lastProgressMs: Long = 0L
    private var lastProgressAt: Long = System.currentTimeMillis()
    private var readyAt: Long = 0L
    private var isPlaying = false
    private var isBuffering = false
    private var healAttempts = 0
    private val maxHealAttempts = 3

    companion object {
        private const val TAG = "HealthWatchdog"
        private const val STUCK_BUFFER_MS = 20_000L
        private const val BLACK_SCREEN_MS = 8_000L
        private const val FROZEN_POSITION_MS = 15_000L
        private const val TICK_MS = 3_000L
    }

    private val tickRunnable = object : Runnable {
        override fun run() {
            checkHealth()
            handler.postDelayed(this, TICK_MS)
        }
    }

    fun start() {
        healAttempts = 0
        readyAt = System.currentTimeMillis()
        lastProgressAt = readyAt
        handler.removeCallbacks(tickRunnable)
        handler.postDelayed(tickRunnable, TICK_MS)
    }

    fun stop() {
        handler.removeCallbacks(tickRunnable)
    }

    fun onProgress(positionMs: Long) {
        if (positionMs != lastProgressMs) {
            lastProgressMs = positionMs
            lastProgressAt = System.currentTimeMillis()
        }
    }

    fun onPlayingChanged(playing: Boolean) {
        isPlaying = playing
        if (playing) readyAt = System.currentTimeMillis()
    }

    fun onBufferingChanged(buffering: Boolean) {
        isBuffering = buffering
        if (!buffering) lastProgressAt = System.currentTimeMillis()
    }

    fun onReadyForDisplay() {
        readyAt = System.currentTimeMillis()
    }

    private fun checkHealth() {
        if (healAttempts >= maxHealAttempts) return
        val now = System.currentTimeMillis()

        if (isBuffering && now - lastProgressAt > STUCK_BUFFER_MS) {
            triggerHeal("infinite_buffering")
            return
        }

        if (!isPlaying && now - readyAt > BLACK_SCREEN_MS && lastProgressMs == 0L) {
            triggerHeal("black_screen")
            return
        }

        if (isPlaying && !isBuffering && now - lastProgressAt > FROZEN_POSITION_MS) {
            triggerHeal("stream_stuck")
        }
    }

    private fun triggerHeal(symptom: String) {
        healAttempts++
        Log.w(TAG, "Auto-heal triggered: $symptom (attempt $healAttempts)")
        lastProgressAt = System.currentTimeMillis()
        onHeal(symptom)
    }
}
