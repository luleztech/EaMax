package com.eamax.player

import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Proxies Widevine license POSTs through the gateway WebView (cookies + CORS context).
 * Nagra/Azam license servers often reject native OkHttp requests with HTTP 400.
 */
class WebViewLicenseBridge(
    private val webView: WebView,
) {
    companion object {
        private const val TAG = "WebViewLicenseBridge"
        private const val TIMEOUT_SEC = 20L
        const val JS_INTERFACE_NAME = "LicenseBridge"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val pending = ConcurrentHashMap<String, PendingLicense>()

    private class PendingLicense {
        val latch = CountDownLatch(1)
        var response: ByteArray? = null
        var error: String? = null
    }

    init {
        webView.addJavascriptInterface(LicenseJsInterface(), JS_INTERFACE_NAME)
    }

    fun injectScript() {
        mainHandler.post {
            webView.evaluateJavascript(PhpWebViewSupport.webViewLicenseFetchScript(), null)
        }
    }

    /**
     * Blocks the Exo DRM thread until the WebView fetch completes or times out.
     */
    fun fetchLicense(
        licenseUrl: String,
        requestBody: ByteArray,
        headers: Map<String, String>,
    ): ByteArray {
        val id = UUID.randomUUID().toString()
        val pendingReq = PendingLicense()
        pending[id] = pendingReq

        val bodyB64 = Base64.encodeToString(requestBody, Base64.NO_WRAP)
        val headersJson = org.json.JSONObject(headers as Map<*, *>).toString()
        val urlJson = org.json.JSONObject.quote(licenseUrl)
        val idJson = org.json.JSONObject.quote(id)
        val bodyJson = org.json.JSONObject.quote(bodyB64)

        mainHandler.post {
            webView.evaluateJavascript(
                "window.__eaMaxFetchWidevineLicense($idJson,$urlJson,$bodyJson,$headersJson);",
                null,
            )
        }

        if (!pendingReq.latch.await(TIMEOUT_SEC, TimeUnit.SECONDS)) {
            pending.remove(id)
            throw TimeoutException("WebView license fetch timed out")
        }

        pending.remove(id)
        pendingReq.error?.let { throw LicenseBridgeException(it) }
        return pendingReq.response
            ?: throw LicenseBridgeException("WebView license response empty")
    }

    inner class LicenseJsInterface {
        @JavascriptInterface
        fun onLicenseSuccess(id: String, bodyB64: String) {
            val req = pending[id] ?: return
            try {
                req.response = Base64.decode(bodyB64, Base64.DEFAULT)
                Log.d(TAG, "WebView license OK (${req.response?.size ?: 0} bytes)")
            } catch (e: Exception) {
                req.error = e.message ?: "decode failed"
            }
            req.latch.countDown()
        }

        @JavascriptInterface
        fun onLicenseError(id: String, message: String) {
            val req = pending[id] ?: return
            req.error = message.ifBlank { "license fetch failed" }
            Log.w(TAG, "WebView license error: ${req.error}")
            req.latch.countDown()
        }
    }

    class LicenseBridgeException(message: String) : Exception(message)
}
