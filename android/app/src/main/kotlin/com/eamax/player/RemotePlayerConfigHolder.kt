package com.eamax.player

import com.eamax.domain.model.StreamQuality

/**
 * Server-driven player settings pushed from Flutter after each config bundle fetch.
 * Defaults match [backend player_config_global].
 */
object RemotePlayerConfigHolder {
    @Volatile var preferredEngine: String = "auto"
        private set
    @Volatile var bufferMinMs: Int = 800
        private set
    @Volatile var bufferMaxMs: Int = 12000
        private set
    @Volatile var retryMax: Int = 4
        private set
    @Volatile var retryDelayMs: Long = 1200L
        private set
    @Volatile var failoverToWebview: Boolean = true
        private set
    @Volatile var reconnectEnabled: Boolean = true
        private set
    @Volatile var autoPlay: Boolean = true
        private set
    @Volatile var defaultQuality: String = "360p"
        private set

    fun defaultStreamQuality(): StreamQuality {
        return when (defaultQuality.lowercase().trim()) {
            "auto" -> StreamQuality.AUTO
            "240p" -> StreamQuality.QUALITY_240P
            "480p" -> StreamQuality.QUALITY_480P
            "720p" -> StreamQuality.QUALITY_720P
            "1080p" -> StreamQuality.QUALITY_1080P
            else -> StreamQuality.QUALITY_360P
        }
    }

    fun defaultQualityMaxHeight(): Int {
        val q = defaultStreamQuality()
        return if (q == StreamQuality.AUTO) Int.MAX_VALUE else q.height
    }

    fun update(
        preferredEngine: String?,
        bufferMinMs: Int?,
        bufferMaxMs: Int?,
        retryMax: Int?,
        retryDelayMs: Int?,
        failoverToWebview: Boolean?,
        reconnectEnabled: Boolean?,
        autoPlay: Boolean?,
        defaultQuality: String?,
    ) {
        preferredEngine?.trim()?.lowercase()?.takeIf { it in setOf("auto", "exo", "webview") }
            ?.let { this.preferredEngine = it }
        bufferMinMs?.takeIf { it in 500..60_000 }?.let { this.bufferMinMs = it }
        bufferMaxMs?.takeIf { it in 2_000..120_000 }?.let { this.bufferMaxMs = it }
        retryMax?.takeIf { it in 1..12 }?.let { this.retryMax = it }
        retryDelayMs?.takeIf { it in 200..15_000 }?.let { this.retryDelayMs = it.toLong() }
        if (failoverToWebview != null) this.failoverToWebview = failoverToWebview
        if (reconnectEnabled != null) this.reconnectEnabled = reconnectEnabled
        if (autoPlay != null) this.autoPlay = autoPlay
        defaultQuality?.trim()?.lowercase()?.takeIf {
            it in setOf("auto", "240p", "360p", "480p", "720p", "1080p")
        }?.let { this.defaultQuality = it }
    }
}
