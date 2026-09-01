package com.eamax.player

import com.eamax.domain.model.StreamQuality

/**
 * Server / Flutter player policy applied via [com.eamax.MainActivity] `updatePlayerConfig`.
 * Used by ExoPlayerEngine for buffer sizes, timeouts, and default quality.
 */
object PlayerRuntimeConfig {
    var bufferMinMs: Int = 2_500
    var bufferMaxMs: Int = 20_000
    var bufferForPlaybackMs: Int = 500
    var bufferForPlaybackAfterRebufferMs: Int = 1_500
    var networkTimeoutMs: Int = 10_000
    var defaultQuality: StreamQuality = StreamQuality.QUALITY_480P
    var autoPlay: Boolean = true
    var failoverToWebview: Boolean = true

    fun applyFromArgs(args: Map<String, Any?>) {
        (args["bufferMinMs"] as? Number)?.toInt()?.takeIf { it in 500..60_000 }?.let {
            bufferMinMs = it
        }
        (args["bufferMaxMs"] as? Number)?.toInt()?.takeIf { it in 2_000..120_000 }?.let {
            bufferMaxMs = it
        }
        (args["initialBufferMs"] as? Number)?.toInt()?.takeIf { it in 200..10_000 }?.let {
            bufferForPlaybackMs = it
        }
        (args["networkTimeoutMs"] as? Number)?.toInt()?.takeIf { it in 3_000..60_000 }?.let {
            networkTimeoutMs = it
        }
        args["defaultQuality"]?.toString()?.let { parseQuality(it) }?.let {
            defaultQuality = it
        }
        (args["autoPlay"] as? Boolean)?.let { autoPlay = it }
        (args["failoverToWebview"] as? Boolean)?.let { failoverToWebview = it }
    }

    fun parseQuality(raw: String?): StreamQuality {
        return when (raw?.trim()?.lowercase()) {
            "auto", "abr", "" -> StreamQuality.AUTO
            "240p", "240" -> StreamQuality.QUALITY_240P
            "360p", "360" -> StreamQuality.QUALITY_360P
            "480p", "480" -> StreamQuality.QUALITY_480P
            "720p", "720" -> StreamQuality.QUALITY_720P
            "1080p", "1080" -> StreamQuality.QUALITY_1080P
            else -> StreamQuality.QUALITY_480P
        }
    }
}
