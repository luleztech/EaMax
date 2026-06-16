package com.eamax.player

/**
 * Server-driven player settings pushed from Flutter after each config bundle fetch.
 * Defaults match [backend player_config_global].
 */
object RemotePlayerConfigHolder {
    @Volatile var bufferMinMs: Int = 1500
        private set
    @Volatile var bufferMaxMs: Int = 30000
        private set
    @Volatile var retryMax: Int = 4
        private set
    @Volatile var retryDelayMs: Long = 1200L
        private set
    @Volatile var failoverToWebview: Boolean = true
        private set
    @Volatile var reconnectEnabled: Boolean = true
        private set

    fun update(
        bufferMinMs: Int?,
        bufferMaxMs: Int?,
        retryMax: Int?,
        retryDelayMs: Int?,
        failoverToWebview: Boolean?,
        reconnectEnabled: Boolean?,
    ) {
        bufferMinMs?.takeIf { it in 500..60_000 }?.let { this.bufferMinMs = it }
        bufferMaxMs?.takeIf { it in 2_000..120_000 }?.let { this.bufferMaxMs = it }
        retryMax?.takeIf { it in 1..12 }?.let { this.retryMax = it }
        retryDelayMs?.takeIf { it in 200..15_000 }?.let { this.retryDelayMs = it.toLong() }
        if (failoverToWebview != null) this.failoverToWebview = failoverToWebview
        if (reconnectEnabled != null) this.reconnectEnabled = reconnectEnabled
    }
}
