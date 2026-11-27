package com.eamax.player

import com.eamax.domain.model.StreamQuality

/**
 * Server / Flutter player policy applied via [com.eamax.MainActivity] `updatePlayerConfig`.
 * Used by ExoPlayerEngine for buffer sizes, timeouts, default quality, and
 * admin-managed gateway/embed details (same role as Washa remote player config).
 */
object PlayerRuntimeConfig {
    var bufferMinMs: Int = 20_000
    var bufferMaxMs: Int = 60_000
    var bufferForPlaybackMs: Int = 2_000
    var bufferForPlaybackAfterRebufferMs: Int = 7_000
    var networkTimeoutMs: Int = 15_000
    var defaultQuality: StreamQuality = StreamQuality.QUALITY_480P
    var autoPlay: Boolean = true
    var failoverToWebview: Boolean = true

    // Admin-managed gateway / embed policy (from /api/v2/config/bundle).
    // Same authorized package marker Washa sends to embed hosts.
    var appPackageHeader: String = "com.washatv"
    var pageUserAgent: String =
        "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    var mediaUserAgent: String = "ExoPlayer"
    var warmCookies: Boolean = true
    var resolveEmbedApi: Boolean = true
    var licenseAuthHeader: String = "nv-authorizations"
    var blockedPageMarker: String = "App Haijatambuliwa"

    fun applyFromArgs(args: Map<String, Any?>) {
        // Live-TV floors — low mins cause rebuffer scratch (play↔pause) on DRM DASH.
        (args["bufferMinMs"] as? Number)?.toInt()?.takeIf { it in 500..90_000 }?.let {
            bufferMinMs = it.coerceAtLeast(18_000)
        }
        (args["bufferMaxMs"] as? Number)?.toInt()?.takeIf { it in 2_000..180_000 }?.let {
            bufferMaxMs = it.coerceAtLeast(bufferMinMs + 10_000)
        }
        (args["initialBufferMs"] as? Number)?.toInt()?.takeIf { it in 200..12_000 }?.let {
            bufferForPlaybackMs = it.coerceIn(1_500, 6_000)
            bufferForPlaybackAfterRebufferMs =
                (bufferForPlaybackMs * 2).coerceIn(6_000, 12_000)
        }
        (args["networkTimeoutMs"] as? Number)?.toInt()?.takeIf { it in 3_000..60_000 }?.let {
            networkTimeoutMs = it.coerceAtLeast(12_000)
        }
        args["defaultQuality"]?.toString()?.let { parseQuality(it) }?.let {
            defaultQuality = it
        }
        (args["autoPlay"] as? Boolean)?.let { autoPlay = it }
        (args["failoverToWebview"] as? Boolean)?.let { failoverToWebview = it }

        @Suppress("UNCHECKED_CAST")
        val gateway = args["gatewayPolicy"] as? Map<String, Any?>
        if (gateway != null) applyGatewayPolicy(gateway)
    }

    fun applyGatewayPolicy(gateway: Map<String, Any?>) {
        gateway["appPackageHeader"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let {
            appPackageHeader = it
        }
        gateway["pageUserAgent"]?.toString()?.trim()?.takeIf { it.length >= 10 }?.let {
            pageUserAgent = it
        }
        gateway["mediaUserAgent"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let {
            mediaUserAgent = it
        }
        (gateway["warmCookies"] as? Boolean)?.let { warmCookies = it }
        (gateway["resolveEmbedApi"] as? Boolean)?.let { resolveEmbedApi = it }
        gateway["licenseAuthHeader"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let {
            licenseAuthHeader = it
        }
        gateway["blockedPageMarker"]?.toString()?.trim()?.takeIf { it.length >= 3 }?.let {
            blockedPageMarker = it
        }
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
