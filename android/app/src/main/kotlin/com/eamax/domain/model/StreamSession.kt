package com.eamax.domain.model

import java.util.UUID

/**
 * STREAM SESSION CONTRACT (CRITICAL)
 */
data class StreamSession(
    val mpdUrl: String,
    val licenseUrl: String,
    val token: String,
    val expiresAt: Long, // Unix timestamp in seconds
    val playerMode: PlayerMode,
    val drmType: DrmType,
    val drmData: DrmData,
    val trialRemaining: Int, // Default is now handled in DTO
    val channelIsPremium: Boolean = false, // 🔥 CRITICAL: Is this channel premium (needs trial timer)?
    val headers: Map<String, String> = emptyMap(),
    val preferredAudioLanguage: String = "sw",
    val sessionId: String = UUID.randomUUID().toString()
) {
    fun isValid(): Boolean {
        val currentTime = System.currentTimeMillis() / 1000
        return currentTime < (expiresAt - 30)
    }

    fun timeUntilExpiry(): Long {
        val currentTime = System.currentTimeMillis() / 1000
        return expiresAt - currentTime
    }
}

enum class PlayerMode {
    EXO, WEB
}

enum class DrmType {
    WIDEVINE, 
    WIDEVINE_L1, 
    WIDEVINE_L3, 
    CLEARKEY, 
    PLAYREADY, 
    NONE
}

data class ClearKey(
    val kid: String,
    val k: String
)

data class DrmData(
    val keyId: String? = null,
    val key: String? = null,
    val headers: Map<String, String>? = null,
    val keys: List<ClearKey>? = null
)
