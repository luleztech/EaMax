package com.eamax

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import com.eamax.player.RemotePlayerConfigHolder

class MainActivity : FlutterActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableScreenshotBlocking()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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
                    try {
                        val intent = Intent(this, EaMaxNativePlayerActivity::class.java)
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
                        intent.putExtra("fallbackStreamsJson", args["fallbackStreamsJson"]?.toString().orEmpty())
                        val playbackEngine = args["playbackEngine"]?.toString()?.trim().orEmpty()
                        if (playbackEngine.isNotEmpty()) {
                            intent.putExtra("playbackEngine", playbackEngine)
                        }
                        startActivity(intent)
                        result.success(null)
                    } catch (e: Exception) {
                        result.error("native_open_failed", e.message ?: "Failed to open player", null)
                    }
                }
                "openExternal" -> {
                    @Suppress("UNCHECKED_CAST")
                    val args = call.arguments as? Map<String, Any?>
                    if (args == null) {
                        result.error("bad_args", "Expected map", null)
                        return@setMethodCallHandler
                    }
                    val engine = args["engine"]?.toString()?.lowercase()?.trim().orEmpty()
                    val url = args["url"]?.toString()?.trim().orEmpty()
                    if (url.isEmpty()) {
                        result.error("bad_args", "Missing url", null)
                        return@setMethodCallHandler
                    }
                    val pkg = when (engine) {
                        "vlc" -> "org.videolan.vlc"
                        "mx" -> "com.mxtech.videoplayer.ad"
                        else -> {
                            result.error("bad_engine", "Unknown external player", null)
                            return@setMethodCallHandler
                        }
                    }
                    try {
                        val view = Intent(Intent.ACTION_VIEW).apply {
                            setPackage(pkg)
                            setDataAndType(Uri.parse(url), "video/*")
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(view)
                        result.success(true)
                    } catch (_: Exception) {
                        try {
                            val generic = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(Uri.parse(url), "video/*")
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            startActivity(generic)
                            result.success(true)
                        } catch (e: Exception) {
                            result.error("external_failed", e.message ?: "External player not installed", null)
                        }
                    }
                }
                "updatePlayerConfig" -> {
                    @Suppress("UNCHECKED_CAST")
                    val args = call.arguments as? Map<String, Any?>
                    if (args == null) {
                        result.error("bad_args", "Expected map", null)
                        return@setMethodCallHandler
                    }
                    fun intArg(key: String): Int? =
                        (args[key] as? Number)?.toInt()
                            ?: args[key]?.toString()?.toIntOrNull()
                    fun boolArg(key: String): Boolean? = when (val v = args[key]) {
                        is Boolean -> v
                        else -> v?.toString()?.equals("true", ignoreCase = true)
                    }
                    RemotePlayerConfigHolder.update(
                        preferredEngine = args["preferredEngine"]?.toString(),
                        bufferMinMs = intArg("bufferMinMs"),
                        bufferMaxMs = intArg("bufferMaxMs"),
                        retryMax = intArg("retryMax"),
                        retryDelayMs = intArg("retryDelayMs"),
                        failoverToWebview = boolArg("failoverToWebview"),
                        reconnectEnabled = boolArg("reconnectEnabled"),
                        autoPlay = boolArg("autoPlay"),
                        defaultQuality = args["defaultQuality"]?.toString(),
                    )
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }
}
