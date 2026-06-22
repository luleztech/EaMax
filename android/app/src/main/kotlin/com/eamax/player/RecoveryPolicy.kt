package com.eamax.player

/**
 * Admin-driven network recovery policy — maps reconnectionPolicy to retry behavior.
 */
object RecoveryPolicy {
    fun retryDelayMs(attempt: Int): Long {
        val base = RemotePlayerConfigHolder.retryDelayMs
        return when (RemotePlayerConfigHolder.reconnectionPolicy) {
            "aggressive" -> base
            "conservative" -> (base * attempt * 1.5).toLong().coerceAtMost(15_000L)
            else -> (base * attempt).toLong().coerceAtMost(10_000L) // balanced
        }
    }

    fun shouldRetrySameStream(attempt: Int): Boolean {
        if (!RemotePlayerConfigHolder.reconnectEnabled) return false
        return attempt < RemotePlayerConfigHolder.retryMax
    }

    fun networkTimeoutMs(): Long = RemotePlayerConfigHolder.networkTimeoutMs.toLong()
}
