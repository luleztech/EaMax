package com.eamax.player

import com.eamax.domain.model.StreamQuality

/** Viewer playback prefs from Flutter / native activity (quality, zoom, data saver). */
data class PlaybackPreferences(
    val dataSaver: Boolean = false,
    val defaultQuality: String = "480p",
    val videoZoomMode: String = "zoom",
) {
    fun maxVideoHeight(): Int {
        if (dataSaver) return 480
        return when (defaultQuality.lowercase().trim()) {
            "240p", "240" -> 240
            "360p", "360" -> 360
            "480p", "480" -> 480
            "720p", "720" -> 720
            "1080p", "1080" -> 1080
            "auto", "" -> 480
            else -> 480
        }
    }

    companion object {
        private var cached = PlaybackPreferences()

        fun fromQuality(quality: StreamQuality, dataSaver: Boolean = false): PlaybackPreferences {
            val q = when (quality) {
                StreamQuality.AUTO -> "480p"
                StreamQuality.QUALITY_240P -> "240p"
                StreamQuality.QUALITY_360P -> "360p"
                StreamQuality.QUALITY_480P -> "480p"
                StreamQuality.QUALITY_720P -> "720p"
                StreamQuality.QUALITY_1080P -> "1080p"
            }
            return PlaybackPreferences(dataSaver = dataSaver, defaultQuality = q)
        }

        fun update(
            dataSaver: Boolean,
            defaultQuality: String,
            videoZoomMode: String,
        ) {
            cached = PlaybackPreferences(
                dataSaver = dataSaver,
                defaultQuality = defaultQuality.ifBlank { "480p" },
                videoZoomMode = videoZoomMode,
            )
        }

        fun current(): PlaybackPreferences = cached
    }
}
