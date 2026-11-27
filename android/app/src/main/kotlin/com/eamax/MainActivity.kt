package com.eamax

import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import com.eamax.player.GatewayWebPlayerFactory
import com.eamax.player.PlayerRuntimeConfig
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {

    companion object {
        private const val NATIVE_PLAYER_REQUEST = 48291
        // After first UI settles; creating WebView loads Chromium on the main thread.
        private const val WEBVIEW_WARMUP_DELAY_MS = 12_000L
    }

    private var nativeOpenResult: MethodChannel.Result? = null

    /** Disk / SQLite / PackageManager / KeyStore work must never run on the UI thread (ANR). */
    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableScreenshotBlocking()
        // Pre-load the CA-store check off the UI thread so later checks hit the cache.
        ioExecutor.execute { runCatching { CaptureProtection.warmUp() } }
        // Warm the Android WebView only after startup has settled, and never on low-RAM devices:
        // creating the first WebView loads Chromium on the main thread and can stall input.
        val activityManager = getSystemService(ACTIVITY_SERVICE) as? ActivityManager
        if (activityManager?.isLowRamDevice != true) {
            Handler(Looper.getMainLooper()).postDelayed({
                if (isFinishing || isDestroyed) return@postDelayed
                try {
                    WebView(applicationContext).apply {
                        settings.javaScriptEnabled = true
                        loadUrl("about:blank")
                        destroy()
                    }
                } catch (_: Exception) {
                }
            }, WEBVIEW_WARMUP_DELAY_MS)
        }
    }

    override fun onDestroy() {
        ioExecutor.shutdown()
        super.onDestroy()
    }

    /** Runs [block] on the IO thread and delivers the result on the main thread. */
    private fun <T> runOffMain(
        result: MethodChannel.Result,
        errorCode: String? = null,
        block: () -> T?,
    ) {
        try {
            ioExecutor.execute {
                val outcome = runCatching(block)
                runOnUiThread {
                    try {
                        outcome.fold(
                            onSuccess = { result.success(it) },
                            onFailure = {
                                if (errorCode != null) result.error(errorCode, it.message, null)
                                else result.success(null)
                            },
                        )
                    } catch (_: Exception) {
                        // Flutter engine may already be detached.
                    }
                }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            try {
                result.success(null)
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
            "com.eamax/security_guard",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "findCaptureApps" -> runOffMain(result) {
                    CaptureProtection.findEnabledCaptureApps(this).map {
                        mapOf("packageName" to it.packageName, "label" to it.label)
                    }
                }
                "openCaptureAppSettings" -> {
                    val id = call.argument<String>("packageName")
                    try {
                        ioExecutor.execute {
                            val known = id != null && CaptureProtection.findEnabledCaptureApps(this)
                                .any { it.packageName == id }
                            runOnUiThread {
                                try {
                                    if (!known || id == null) {
                                        result.error("invalid_package", "No active capture threat found", null)
                                        return@runOnUiThread
                                    }
                                    val intent = when (id) {
                                        CaptureProtection.ID_SYSTEM_PROXY ->
                                            Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS)
                                        CaptureProtection.ID_USER_CA ->
                                            Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS)
                                        else -> Intent(
                                            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                            android.net.Uri.parse("package:$id"),
                                        )
                                    }
                                    runCatching { startActivity(intent) }
                                        .onSuccess { result.success(null) }
                                        .onFailure { result.error("settings_failed", it.message, null) }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        result.success(null)
                    }
                }
                else -> result.notImplemented()
            }
        }
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.eamax/app_data",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "readLegacyRnUserId" -> runOffMain(result) {
                    RnAsyncStorageUserId.readUserId(this)
                }
                "readStableUserId" -> runOffMain(result) {
                    StableUserIdentity.read(this)
                }
                "persistStableUserId" -> {
                    val id = call.argument<String>("userId")?.trim().orEmpty()
                    runOffMain<Any?>(result, errorCode = "persist_failed") {
                        if (id.isNotEmpty()) StableUserIdentity.persist(this, id)
                        null
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
                            "playbackEngine",
                            args["playbackEngine"]?.toString().orEmpty(),
                        )
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
                        intent.putExtra("videoZoomMode", "fit")
                        Log.i(
                            "EaMaxNative",
                            "open drm=${args["drmType"]} clearKeyLen=${mergedClearKey.length} " +
                                "engine=${args["playbackEngine"]} url=${args["url"]}",
                        )
                        // Open the socket/TLS to the stream host while the activity starts.
                        com.eamax.player.OrizonStreamClient.preconnect(args["url"]?.toString().orEmpty())
                        nativeOpenResult = result
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, NATIVE_PLAYER_REQUEST)
                        // No slide animation: the player screen appears on the very next frame.
                        @Suppress("DEPRECATION")
                        overridePendingTransition(0, 0)
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
