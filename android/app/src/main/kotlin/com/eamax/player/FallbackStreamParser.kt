package com.eamax.player

import com.eamax.domain.model.ClearKey
import com.eamax.domain.model.DrmData
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.PlayerMode
import com.eamax.domain.model.StreamSession
import org.json.JSONArray
import org.json.JSONObject

/** Parses Flutter `fallbackStreamsJson` into alternate [StreamSession] candidates. */
object FallbackStreamParser {

    fun parse(json: String, base: StreamSession): List<StreamSession> {
        if (json.isBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val url = o.optString("url").trim()
                    if (url.isEmpty()) continue
                    val licenseUrl = o.optString("licenseUrl").trim()
                    val drmTypeStr = o.optString("drmType", "NONE").uppercase()
                    val clearKeyHex = sequenceOf(
                        o.optString("clearKeyHex"),
                        o.optString("drmClearKey"),
                    ).firstOrNull { it.isNotBlank() }.orEmpty()

                    var drmType = when (drmTypeStr) {
                        "CLEARKEY", "CLEAR_KEY" -> DrmType.CLEARKEY
                        "WIDEVINE" -> DrmType.WIDEVINE
                        "WIDEVINE_L1" -> DrmType.WIDEVINE_L1
                        "WIDEVINE_L3" -> DrmType.WIDEVINE_L3
                        "PLAYREADY" -> DrmType.PLAYREADY
                        else -> DrmType.NONE
                    }
                    val headers = parseHeadersObject(o.optJSONObject("headers"))
                    val keys = if (clearKeyHex.isNotEmpty()) {
                        StreamSessionBuilder.parseClearKeysFromGateway(clearKeyHex)
                    } else {
                        emptyList()
                    }
                    if (drmType == DrmType.CLEARKEY && keys.isEmpty()) drmType = DrmType.NONE
                    if (drmType != DrmType.NONE && drmType != DrmType.CLEARKEY && licenseUrl.isEmpty()) {
                        drmType = DrmType.NONE
                    }

                    val gateway = StreamUrlClassifier.needsWebPlayer(url)
                    val playerMode = if (gateway) PlayerMode.WEB else PlayerMode.EXO

                    add(
                        base.copy(
                            mpdUrl = url,
                            licenseUrl = licenseUrl.ifBlank { base.licenseUrl },
                            drmType = drmType,
                            drmData = if (keys.isNotEmpty()) DrmData(keys = keys) else base.drmData,
                            headers = if (headers.isNotEmpty()) headers else base.headers,
                            playerMode = playerMode,
                            sessionId = "${base.sessionId}-fb$i",
                        ),
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun parseHeadersObject(o: JSONObject?): Map<String, String> {
        if (o == null) return emptyMap()
        return buildMap {
            val it = o.keys()
            while (it.hasNext()) {
                val k = it.next()
                put(k, o.optString(k))
            }
        }
    }
}
