package com.eamax.player

import android.util.Log
import androidx.media3.exoplayer.drm.ExoMediaDrm
import androidx.media3.exoplayer.drm.HttpMediaDrmCallback
import androidx.media3.exoplayer.drm.MediaDrmCallback
import java.util.UUID

/**
 * Widevine license acquisition: WebView proxy first (Nagra/Azam), then native HTTP fallback.
 */
class GatewayMediaDrmCallback(
    private val licenseUrl: String,
    private val licenseHeaders: Map<String, String>,
    private val nativeCallback: HttpMediaDrmCallback,
    private val webViewBridge: WebViewLicenseBridge?,
) : MediaDrmCallback {

    companion object {
        private const val TAG = "GatewayMediaDrmCallback"
    }

    override fun executeProvisionRequest(
        uuid: UUID,
        request: ExoMediaDrm.ProvisionRequest,
    ): MediaDrmCallback.Response = nativeCallback.executeProvisionRequest(uuid, request)

    override fun executeKeyRequest(
        uuid: UUID,
        request: ExoMediaDrm.KeyRequest,
    ): MediaDrmCallback.Response {
        if (webViewBridge != null && StreamUrlClassifier.isNagraLicense(licenseUrl)) {
            try {
                Log.d(TAG, "License via WebView proxy → ${licenseUrl.take(80)}")
                val webHeaders = mapOf("Content-Type" to "application/octet-stream")
                val data = webViewBridge.fetchLicense(licenseUrl, request.data, webHeaders)
                return MediaDrmCallback.Response(data)
            } catch (e: Exception) {
                Log.w(TAG, "WebView license proxy failed: ${e.message} — trying native HTTP")
            }
        }
        return nativeCallback.executeKeyRequest(uuid, request)
    }
}
