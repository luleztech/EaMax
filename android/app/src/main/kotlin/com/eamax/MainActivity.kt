package com.eamax

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import com.eamax.player.GatewayWebPlayerFactory
import com.eamax.player.PlayerRuntimeConfig
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    companion object {
        private const val NATIVE_PLAYER_REQUEST = 48291
    }

    private var nativeOpenResult: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableScreenshotBlocking()
        // Warm the Android WebView so gateway fallback is ready when requested.
        Handler(Looper.getMainLooper()).post {
            try {
                WebView(applicationContext).apply {
                    settings.javaScriptEnabled = true
                    loadUrl("about:blank")
                    destroy()
                }
            } catch (_: Exception) {
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == NATIVE_PLAYER_REQUEST) {
            val pending = nativeOpenResult
            nativeOpenResult = null
            try {
                pending?.success(null)
            } catch (_: Exception) {
                // The Flutter engine can be torn down while native playback closes.
            }
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine
            .platformViewsController
            .registry
            .registerViewFactory(
                "com.eamax/gateway_web_player",
                GatewayWebPlayerFactory(flutterEngine.dartExecutor.binaryMessenger),
            )
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.eamax/app_data",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "readLegacyRnUserId" -> {
                    try {
                        result.success(RnAsyncStorageUserId.readUserId(this))
                    } catch (_: Exception) {
                        result.success(null)
                    }
                }
                "readStableUserId" -> {
                    try {
                        result.success(StableUserIdentity.read(this))
                    } catch (_: Exception) {
                        result.success(null)
                    }
                }
                "persistStableUserId" -> {
                    try {
                        val id = call.argument<String>("userId")?.trim().orEmpty()
                        if (id.isNotEmpty()) {
                            StableUserIdentity.persist(this, id)
                        }
                        result.success(null)
                    } catch (e: Exception) {
                        result.error("persist_failed", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.eamax/native_player",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "open" -> {
                    @Suppress("UNCHECKED_CAST")
                    val args = call.arguments as? Map<String, Any?>
                    if (args == null) {
                        result.error("bad_args", "Expected map", null)
                        return@setMethodCallHandler
                    }
                    if (nativeOpenResult != null) {
                        result.error("busy", "Player already open", null)
                        return@setMethodCallHandler
                    }
                    try {
                        val intent = Intent(this, OrizonPlayerActivity::class.java)
                        intent.putExtra("url", args["url"]?.toString().orEmpty())
                        intent.putExtra("licenseUrl", args["licenseUrl"]?.toString().orEmpty())
                        intent.putExtra("token", args["token"]?.toString().orEmpty())
                        intent.putExtra("drmType", args["drmType"]?.toString().orEmpty().ifEmpty { "NONE" })
                        val mergedClearKey = sequenceOf(
                            args["clearKeyHex"]?.toString(),
                            args["drmClearKey"]?.toString(),
                            args["drm_clear_key"]?.toString(),
                        ).firstOrNull { !it.isNullOrBlank() }.orEmpty()
                        intent.putExtra("clearKeyHex", mergedClearKey)
                        intent.putExtra("headersJson", args["headersJson"]?.toString().orEmpty())
                        intent.putExtra(
                            "audioLanguage",
                            args["audioLanguage"]?.toString().orEmpty().ifEmpty { "sw" },
                        )
                        intent.putExtra(
                            "fallbackStreamsJson",
                            args["fallbackStreamsJson"]?.toString().orEmpty(),
                        )
                        intent.putExtra(
                            "defaultQuality",
                            args["defaultQuality"]?.toString().orEmpty().ifEmpty { "480p" },
                        )
                        intent.putExtra("videoZoomMode", "contain")
                        nativeOpenResult = result
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, NATIVE_PLAYER_REQUEST)
                    } catch (e: Exception) {
                        nativeOpenResult = null
                        result.error("native_open_failed", e.message ?: "Failed to open player", null)
                    }
                }
                "updatePlayerConfig" -> {
                    @Suppress("UNCHECKED_CAST")
                    val args = call.arguments as? Map<String, Any?>
                    if (args != null) {
                        PlayerRuntimeConfig.applyFromArgs(args)
                    }
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }
}
