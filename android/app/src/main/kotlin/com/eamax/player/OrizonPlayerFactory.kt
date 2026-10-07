package com.eamax.player

import android.content.Context
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.dash.DashMediaSource
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager
import androidx.media3.exoplayer.drm.FrameworkMediaDrm
import androidx.media3.exoplayer.drm.HttpMediaDrmCallback
import androidx.media3.exoplayer.drm.LocalMediaDrmCallback
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.StreamSession
import org.json.JSONArray
import org.json.JSONObject

/**
 * Orizon TV 1.7.1 player factory (`mi1` / DirectPlay).
 * Builds ExoPlayer + DASH/HLS/progressive sources over OkHttp, with Widevine/ClearKey.
 */
@OptIn(UnstableApi::class)
class OrizonPlayerFactory(private val context: Context) {

    fun createPlayer(
        preferredAudioLanguage: String = "sw",
        preferences: PlaybackPreferences = PlaybackPreferences.current(),
    ): ExoPlayer {
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                PlayerRuntimeConfig.bufferMinMs,
                PlayerRuntimeConfig.bufferMaxMs,
                PlayerRuntimeConfig.bufferForPlaybackMs,
                PlayerRuntimeConfig.bufferForPlaybackAfterRebufferMs,
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .setBackBuffer(BACK_BUFFER_MS, false)
            .build()

        val maxVideoHeight = preferences.maxVideoHeight()
        val trackSelector = DefaultTrackSelector(context)
        trackSelector.parameters = trackSelector.buildUponParameters()
            .setPreferredAudioLanguage(preferredAudioLanguage.ifBlank { "sw" })
            .setMaxVideoSize(Int.MAX_VALUE, maxVideoHeight)
            .setForceHighestSupportedBitrate(false)
            .setTunnelingEnabled(false)
            .build()

        val renderersFactory = DefaultRenderersFactory(context).apply {
            setEnableDecoderFallback(true)
            setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
        }

        return ExoPlayer.Builder(context)
            .setRenderersFactory(renderersFactory)
            .setTrackSelector(trackSelector)
            .setLoadControl(loadControl)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
            .apply {
                videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT
                repeatMode = Player.REPEAT_MODE_OFF
                playWhenReady = true
            }
    }

    fun play(player: ExoPlayer, session: StreamSession, formatOverride: Format? = null) {
        val url = session.mpdUrl.trim()
        require(url.isNotEmpty()) { "URL cannot be empty" }
        val format = formatOverride ?: classify(url)
        if (format == Format.GATEWAY) {
            throw IllegalArgumentException("Gateway URL must use WebView")
        }
        Log.i(TAG, "play format=$format url=${url.take(160)}")
        val headers = buildHeaders(session)
        val dataSource = OrizonStreamClient.dataSourceFactory(headers)
        val mediaItem = buildMediaItem(session, format, headers)
        val factory = mediaSourceFactory(format, dataSource)
        if (session.drmType != DrmType.NONE) {
            try {
                val drm = createDrmSessionManager(session, headers)
                factory.setDrmSessionManagerProvider { drm }
            } catch (e: Exception) {
                if (format != Format.HLS) throw e
                Log.w(TAG, "DRM manager skipped for HLS: ${e.message}")
            }
        }
        player.setMediaSource(factory.createMediaSource(mediaItem))
        player.prepare()
        player.playWhenReady = true
    }

    fun classify(url: String): Format {
        val trimmed = url.trim()
        val noQuery = trimmed.substringBefore('?').substringBefore('#')
        if (noQuery.endsWith(".mpd", ignoreCase = true)) return Format.DASH
        if (noQuery.endsWith(".m3u8", ignoreCase = true) ||
            noQuery.endsWith(".m3u", ignoreCase = true)
        ) {
            return Format.HLS
        }
        if (noQuery.endsWith(".mp4", ignoreCase = true) ||
            noQuery.endsWith(".m4v", ignoreCase = true) ||
            noQuery.endsWith(".webm", ignoreCase = true) ||
            noQuery.endsWith(".mkv", ignoreCase = true) ||
            noQuery.endsWith(".ts", ignoreCase = true)
        ) {
            return Format.PROGRESSIVE
        }
        return when (StreamUrlClassifier.detectFormat(trimmed)) {
            StreamUrlClassifier.Format.DASH -> Format.DASH
            StreamUrlClassifier.Format.HLS -> {
                // IPTV-style URLs without .m3u8 often serve raw TS — HLS parser fails with EXTM3U.
                if (StreamUrlClassifier.isLikelyIptvLiveUrl(trimmed) &&
                    !trimmed.contains(".m3u8", ignoreCase = true) &&
                    !trimmed.contains(".m3u", ignoreCase = true)
                ) {
                    Format.PROGRESSIVE
                } else {
                    Format.HLS
                }
            }
            StreamUrlClassifier.Format.PROGRESSIVE -> Format.PROGRESSIVE
            StreamUrlClassifier.Format.GATEWAY -> Format.GATEWAY
            StreamUrlClassifier.Format.UNKNOWN -> Format.PROGRESSIVE
        }
    }

    enum class Format { DASH, HLS, PROGRESSIVE, GATEWAY }

    private fun mediaSourceFactory(
        format: Format,
        dataSource: HttpDataSource.Factory,
    ): androidx.media3.exoplayer.source.MediaSource.Factory {
        val retries = DefaultLoadErrorHandlingPolicy(LOAD_ERROR_RETRY_COUNT)
        return when (format) {
            Format.DASH -> DashMediaSource.Factory(dataSource)
                .setFallbackTargetLiveOffsetMs(30_000)
                .setLoadErrorHandlingPolicy(retries)
            Format.HLS -> HlsMediaSource.Factory(dataSource)
                .setAllowChunklessPreparation(true)
                .setLoadErrorHandlingPolicy(retries)
            Format.PROGRESSIVE -> ProgressiveMediaSource.Factory(dataSource)
                .setLoadErrorHandlingPolicy(retries)
            Format.GATEWAY -> throw IllegalArgumentException("Gateway URL must use WebView")
        }
    }

    private fun buildMediaItem(
        session: StreamSession,
        format: Format,
        headers: Map<String, String>,
    ): MediaItem {
        val builder = MediaItem.Builder()
            .setUri(session.mpdUrl)
            .setMimeType(
                when (format) {
                    Format.HLS -> "application/x-mpegurl"
                    Format.DASH -> "application/dash+xml"
                    Format.PROGRESSIVE, Format.GATEWAY -> null
                },
            )
        if (format == Format.HLS) {
            builder.setLiveConfiguration(
                MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(HLS_LIVE_TARGET_OFFSET_MS)
                    .setMinOffsetMs(HLS_LIVE_MIN_OFFSET_MS)
                    .setMaxOffsetMs(HLS_LIVE_MAX_OFFSET_MS)
                    .setMaxPlaybackSpeed(HLS_LIVE_MAX_PLAYBACK_SPEED)
                    .build(),
            )
        }
        if (session.drmType != DrmType.NONE) {
            builder.setDrmConfiguration(buildDrmConfiguration(session, headers))
        }
        return builder.build()
    }

    private fun buildDrmConfiguration(
        session: StreamSession,
        headers: Map<String, String>,
    ): MediaItem.DrmConfiguration {
        return when (session.drmType) {
            DrmType.WIDEVINE, DrmType.WIDEVINE_L1, DrmType.WIDEVINE_L3 ->
                MediaItem.DrmConfiguration.Builder(C.WIDEVINE_UUID)
                    .setLicenseUri(session.licenseUrl.takeIf { it.isNotBlank() })
                    .setLicenseRequestHeaders(headers)
                    .setMultiSession(false)
                    .build()
            DrmType.PLAYREADY ->
                MediaItem.DrmConfiguration.Builder(C.PLAYREADY_UUID)
                    .setLicenseUri(session.licenseUrl.takeIf { it.isNotBlank() })
                    .setLicenseRequestHeaders(headers)
                    .setMultiSession(false)
                    .build()
            DrmType.CLEARKEY ->
                MediaItem.DrmConfiguration.Builder(C.CLEARKEY_UUID)
                    .setMultiSession(false)
                    .build()
            DrmType.NONE ->
                MediaItem.DrmConfiguration.Builder(C.WIDEVINE_UUID).build()
        }
    }

    private fun createDrmSessionManager(
        session: StreamSession,
        headers: Map<String, String>,
    ): DefaultDrmSessionManager {
        return when (session.drmType) {
            DrmType.WIDEVINE, DrmType.WIDEVINE_L1, DrmType.WIDEVINE_L3 ->
                DefaultDrmSessionManager.Builder()
                    .setUuidAndExoMediaDrmProvider(C.WIDEVINE_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
                    .setPlayClearSamplesWithoutKeys(true)
                    .build(
                        HttpMediaDrmCallback(
                            session.licenseUrl,
                            OrizonStreamClient.dataSourceFactory(headers),
                        ),
                    )
            DrmType.PLAYREADY ->
                DefaultDrmSessionManager.Builder()
                    .setUuidAndExoMediaDrmProvider(C.PLAYREADY_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
                    .setPlayClearSamplesWithoutKeys(true)
                    .build(
                        HttpMediaDrmCallback(
                            session.licenseUrl,
                            OrizonStreamClient.dataSourceFactory(headers),
                        ),
                    )
            DrmType.CLEARKEY ->
                DefaultDrmSessionManager.Builder()
                    .setUuidAndExoMediaDrmProvider(C.CLEARKEY_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
                    .setPlayClearSamplesWithoutKeys(true)
                    .build(LocalMediaDrmCallback(buildClearKeyJson(session)))
            DrmType.NONE ->
                throw IllegalArgumentException("No DRM")
        }
    }

    private fun buildClearKeyJson(session: StreamSession): ByteArray {
        val keys = session.drmData.keys
        if (keys.isNullOrEmpty()) {
            throw IllegalArgumentException("Invalid clearkey format. Expected: kid:key")
        }
        val keysArray = JSONArray()
        for (clearKey in keys) {
            keysArray.put(
                JSONObject()
                    .put("kty", "oct")
                    .put("kid", clearKey.kid)
                    .put("k", clearKey.k),
            )
        }
        return JSONObject()
            .put("keys", keysArray)
            .put("type", "temporary")
            .toString()
            .toByteArray(Charsets.UTF_8)
    }

    private fun buildHeaders(session: StreamSession): Map<String, String> {
        val sessionHeaders = LinkedHashMap<String, String>()
        session.drmData.headers?.let { sessionHeaders.putAll(it) }
        sessionHeaders.putAll(session.headers)
        val headers = PlaybackHttpHeaders.merge(sessionHeaders, session.mpdUrl)
        if (session.token.isNotEmpty() &&
            headers.keys.none { it.equals("Authorization", ignoreCase = true) }
        ) {
            headers["Authorization"] = "Bearer ${session.token}"
        }
        Log.i(TAG, "request headers keys=${headers.keys.sorted()}")
        return headers
    }

    companion object {
        private const val TAG = "OrizonPlayerFactory"
        private const val MIN_BUFFER_MS = 10_000
        private const val MAX_BUFFER_MS = 40_000
        private const val BUFFER_FOR_PLAYBACK_MS = 1_800
        private const val BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 3_500
        private const val BACK_BUFFER_MS = 0
        private const val HLS_LIVE_TARGET_OFFSET_MS = 8_000L
        private const val HLS_LIVE_MIN_OFFSET_MS = 3_000L
        private const val HLS_LIVE_MAX_OFFSET_MS = 35_000L
        private const val HLS_LIVE_MAX_PLAYBACK_SPEED = 1.04f
        private const val LOAD_ERROR_RETRY_COUNT = 3
    }
}
