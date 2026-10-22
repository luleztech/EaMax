package com.eamax.player

import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.audio.AudioSink
import java.nio.ByteBuffer
import kotlin.math.abs

/**
 * Live MPEG-TS timestamps sometimes jump by several seconds and then come back.
 * [androidx.media3.exoplayer.audio.DefaultAudioSink] treats a jump over 200ms as a
 * discontinuity: it drains the track and moves the clock, and the video decoder
 * then drops frames to catch up. That is the scratch.
 *
 * Buffers are fed with a continuous timestamp instead, so the clock never jumps.
 */
@UnstableApi
class DiscontinuityTolerantAudioSink(
    private val delegate: AudioSink,
) : AudioSink by delegate {

    private var sampleRate = 0
    private var pcmFrameSize = 0
    private var samplesPerAccessUnit = 0
    private var nextPtsUs = C.TIME_UNSET
    private var latchedInputPts = UNLATCHED
    private var latchedOutputPts = 0L
    private var latchedBytes = 0
    private var latchedAccessUnits = 0
    private var holdingClock = false

    override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
        delegate.configure(inputFormat, specifiedBufferSize, outputChannels)
        val channels = outputChannels?.size ?: inputFormat.channelCount
        val encoding = when (inputFormat.pcmEncoding) {
            C.ENCODING_PCM_8BIT,
            C.ENCODING_PCM_16BIT,
            C.ENCODING_PCM_24BIT,
            C.ENCODING_PCM_32BIT,
            C.ENCODING_PCM_FLOAT,
            -> inputFormat.pcmEncoding
            else -> C.ENCODING_INVALID
        }
        sampleRate = inputFormat.sampleRate
        pcmFrameSize = if (sampleRate > 0 && channels > 0 && encoding != C.ENCODING_INVALID) {
            Util.getPcmFrameSize(encoding, channels)
        } else {
            0
        }
        // HTTP MPEG-TS often passes AAC/AC3 straight through. Those buffers have
        // no PCM frame size, so the clock still has to advance or the jump leaks.
        samplesPerAccessUnit = when (inputFormat.sampleMimeType) {
            MimeTypes.AUDIO_AAC -> 1024
            MimeTypes.AUDIO_AC3, MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_AC4 -> 1536
            MimeTypes.AUDIO_MPEG, MimeTypes.AUDIO_MPEG_L1, MimeTypes.AUDIO_MPEG_L2 -> 1152
            MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD -> 512
            else -> if (pcmFrameSize > 0) 0 else 1024
        }
        resetTimeline()
    }

    override fun flush() {
        resetTimeline()
        delegate.flush()
    }

    override fun reset() {
        resetTimeline()
        delegate.reset()
    }

    override fun handleDiscontinuity() {
        // Not a seek. flush() already re-bases the clock after a real seek.
        // Forwarding this drains queued audio and clicks.
    }

    override fun handleBuffer(
        buffer: ByteBuffer,
        presentationTimeUs: Long,
        encodedAccessUnitCount: Int,
    ): Boolean {
        if (presentationTimeUs != latchedInputPts) {
            latchedInputPts = presentationTimeUs
            latchedOutputPts = continuousPts(presentationTimeUs)
            latchedBytes = buffer.remaining()
            latchedAccessUnits = encodedAccessUnitCount
        }
        val consumed = delegate.handleBuffer(buffer, latchedOutputPts, encodedAccessUnitCount)
        if (consumed) {
            noteConsumed(latchedOutputPts, latchedBytes, latchedAccessUnits)
            latchedInputPts = UNLATCHED
        }
        return consumed
    }

    private fun continuousPts(presentationTimeUs: Long): Long {
        val expected = nextPtsUs
        if (expected == C.TIME_UNSET) return presentationTimeUs
        val delta = abs(presentationTimeUs - expected)
        if (delta <= MAX_GAP_US) {
            holdingClock = false
            return presentationTimeUs
        }
        if (!holdingClock) {
            holdingClock = true
            Log.i(TAG, "Holding audio clock across a ${delta / 1000}ms timestamp jump")
        }
        return expected
    }

    private fun noteConsumed(outputPtsUs: Long, bytes: Int, accessUnits: Int) {
        val durationUs = bufferDurationUs(bytes, accessUnits)
        if (durationUs <= 0L) return
        nextPtsUs = outputPtsUs + durationUs
    }

    private fun bufferDurationUs(bytes: Int, accessUnits: Int): Long {
        val rate = if (sampleRate > 0) sampleRate else 48_000
        if (pcmFrameSize > 0 && bytes > 0) {
            val frames = bytes / pcmFrameSize
            if (frames > 0) return frames * 1_000_000L / rate
        }
        val units = when {
            accessUnits > 0 -> accessUnits
            samplesPerAccessUnit > 0 -> 1
            else -> 0
        }
        if (samplesPerAccessUnit > 0 && units > 0) {
            return units * samplesPerAccessUnit * 1_000_000L / rate
        }
        return 0L
    }

    private fun resetTimeline() {
        nextPtsUs = C.TIME_UNSET
        latchedInputPts = UNLATCHED
        latchedBytes = 0
        latchedAccessUnits = 0
        holdingClock = false
    }

    private companion object {
        const val TAG = "EaMaxAudio"
        const val UNLATCHED = Long.MIN_VALUE
        /** Same threshold DefaultAudioSink uses before it drains and resyncs. */
        const val MAX_GAP_US = 200_000L
    }
}
