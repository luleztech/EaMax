package com.eamax.player

import android.content.Context
import android.view.View
import android.webkit.WebView
import com.eamax.domain.model.StreamSession
import com.eamax.domain.model.DrmData
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.PlayerMode
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.platform.PlatformView
import org.json.JSONObject

/** Embeds [WebViewEngine] inside Flutter [PlayerScreen] for gateway / PHP streams. */
class GatewayWebPlayerPlatformView(
    context: Context,
    viewId: Int,
    args: Map<String, Any?>,
    messenger: BinaryMessenger,
) : PlatformView {

    private val appContext: Context = context.applicationContext
    private val webViewEngine: WebViewEngine
    private val channel = MethodChannel(messenger, "com.eamax/gateway_web_player")

    init {
        val url = args["url"]?.toString().orEmpty().trim()
        val headersJson = args["headersJson"]?.toString().orEmpty()
        val session = StreamSession(
            mpdUrl = url,
            licenseUrl = "",
            token = "",
            expiresAt = (System.currentTimeMillis() / 1000) + 86400,
            playerMode = PlayerMode.EXO,
            drmType = DrmType.NONE,
            drmData = DrmData(headers = null),
            trialRemaining = 999_999,
            channelIsPremium = false,
            headers = parseHeaders(headersJson),
        )

        webViewEngine = WebViewEngine(
            context = context,
            onPlaybackStateChanged = {},
            onError = {
                channel.invokeMethod("onError", mapOf("viewId" to viewId))
            },
        )
        webViewEngine.initialize(session)
    }

    override fun getView(): View = webViewEngine.getWebView() ?: View(appContext)

    override fun dispose() {
        webViewEngine.release()
    }

    private fun parseHeaders(json: String): Map<String, String> {
        if (json.isEmpty()) return emptyMap()
        return try {
            val o = JSONObject(json)
            buildMap {
                val it = o.keys()
                while (it.hasNext()) {
                    val k = it.next()
                    put(k, o.optString(k))
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }
}
