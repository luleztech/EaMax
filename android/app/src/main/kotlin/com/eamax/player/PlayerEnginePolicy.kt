package com.eamax.player

/**
 * Maps admin [preferredEngine] (global or per-channel session override) to native routing.
 */
object PlayerEnginePolicy {
    private val nativeEngines = setOf(
        "auto", "kotlin", "exo", "webview", "webplayer", "shaka",
    )

    /** Per-playback session override from channel admin setting. */
    @Volatile
    private var sessionEngine: String? = null

    fun setSessionEngine(engine: String?) {
        sessionEngine = engine?.trim()?.lowercase()?.takeIf {
            it.isNotEmpty() && it != "default" && it != "global"
        }
    }

    fun clearSessionEngine() {
        sessionEngine = null
    }

    private fun activeEngineRaw(): String {
        return sessionEngine ?: RemotePlayerConfigHolder.preferredEngine
    }

    fun normalize(raw: String?): String {
        val e = raw?.trim()?.lowercase().orEmpty()
        return when (e) {
            "vlc", "mx", "flutter", "chewie", "native_video", "webrtc" -> "auto"
            in nativeEngines -> e
            else -> "auto"
        }
    }

    fun forceWebView(): Boolean {
        val e = normalize(activeEngineRaw())
        return e == "webview" || e == "webplayer" || e == "shaka"
    }

    fun forceExo(): Boolean = normalize(activeEngineRaw()) == "exo"

    /** Smart native stack (probe + failover). */
    fun smartRouting(): Boolean {
        val e = normalize(activeEngineRaw())
        return e == "auto" || e == "kotlin"
    }
}
