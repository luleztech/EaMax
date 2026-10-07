package com.eamax.domain.model

/**
 * QUALITY SELECTION (MANDATORY — BOTH ENGINES)
 * 
 * User Options:
 * - Auto (ABR)
 * - 240p / 360p / 480p / 720p / 1080p (when available)
 * 
 * Authority Rules:
 * - Kotlin owns selected quality
 * - JS/WebView executes selection
 * - ABR disabled when manual quality is chosen
 * - ABR re-enabled when Auto selected
 */
enum class StreamQuality(val height: Int, val label: String) {
    AUTO(0, "Auto (ABR)"),
    QUALITY_240P(240, "240p"),
    QUALITY_360P(360, "360p"),
    QUALITY_480P(480, "480p"),
    QUALITY_720P(720, "720p"),
    QUALITY_1080P(1080, "1080p")
}

/**
 * AUDIO SELECTION (MANDATORY)
 * 
 * Kotlin owns preferred audio language
 */
data class AudioTrack(
    val id: String,
    val language: String,
    val label: String,
    val isDefault: Boolean = false
)

/**
 * Player configuration state
 * Kotlin owns all authority over these settings
 */
data class PlayerConfig(
    val selectedQuality: StreamQuality = StreamQuality.AUTO,
    val selectedAudioLanguage: String = "en",
    val isABREnabled: Boolean = true,
    val availableQualities: List<StreamQuality> = listOf(
        StreamQuality.AUTO,
        StreamQuality.QUALITY_240P,
        StreamQuality.QUALITY_360P,
        StreamQuality.QUALITY_480P,
        StreamQuality.QUALITY_720P,
        StreamQuality.QUALITY_1080P
    ),
    val availableAudioTracks: List<AudioTrack> = emptyList()
) {
    fun setQuality(quality: StreamQuality): PlayerConfig {
        return this.copy(
            selectedQuality = quality,
            isABREnabled = quality == StreamQuality.AUTO
        )
    }

    fun setAudioLanguage(language: String): PlayerConfig {
        return this.copy(selectedAudioLanguage = language)
    }
}
