package com.eamax.player

import android.net.Uri
import android.util.Log
import com.eamax.domain.model.ClearKey
import com.eamax.domain.model.DrmData
import com.eamax.domain.model.DrmType
import com.eamax.domain.model.PlayerMode
import com.eamax.domain.model.StreamSession
import com.eamax.safeUrlForLogs
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Resolves PHP/embed gateway pages (same flow as Washa [GatewayEmbedResolver]):
 * warm the embed page with app headers + cookies, call `player.php?api=1`,
 * then hand ExoPlayer `mpdPath` + Widevine `licenseUrl` + `authXmlToken`
 * as `nv-authorizations`.
 */
object GatewayPlaybackResolver {
    private const val TAG = "GatewayResolver"
    private const val CACHE_TTL_MS = 60_000L
    private const val MAX_API_ATTEMPTS = 3

    private fun packageHeader(): String =
        PlayerRuntimeConfig.appPackageHeader.ifBlank { "com.washatv" }

    private fun licenseAuthHeader(): String =
        PlayerRuntimeConfig.licenseAuthHeader.ifBlank { "nv-authorizations" }

    private fun mediaUa(): String =
        PlayerRuntimeConfig.mediaUserAgent.ifBlank { "ExoPlayer" }

    private fun blockedMarker(): String =
        PlayerRuntimeConfig.blockedPageMarker.ifBlank { "App Haijatambuliwa" }

    data class Resolved(
        val streamUrl: String,
        val licenseUrl: String = "",
        val authToken: String = "",
        val clearKeyRaw: String = "",
        val isHls: Boolean = false,
        val headers: Map<String, String> = emptyMap(),
        val drmType: DrmType? = null,
        val referer: String = "",
        val origin: String = "",
    )

    private data class CacheEntry(val resolved: Resolved, val expiresAtMs: Long)

    private val cache = ConcurrentHashMap<String, CacheEntry>()

    fun resolve(session: StreamSession): Resolved? {
        val gatewayUrl = session.mpdUrl.trim()
        if (gatewayUrl.isEmpty()) return null

        cache[gatewayUrl]?.let { entry ->
            if (entry.expiresAtMs > System.currentTimeMillis()) {
                Log.d(TAG, "Embed API cache hit ${safeUrlForLogs(gatewayUrl)}")
                return entry.resolved
            }
            cache.remove(gatewayUrl)
        }

        // Admin can disable embed API resolve remotely.
        if (PlayerRuntimeConfig.resolveEmbedApi) {
            resolveLikeWasha(gatewayUrl, session.headers)?.let { resolved ->
                cache[gatewayUrl] = CacheEntry(resolved, System.currentTimeMillis() + CACHE_TTL_MS)
                return resolved
            }
        }

        if (!StreamUrlClassifier.needsWebPlayer(gatewayUrl)) return null

        val audioLang = session.preferredAudioLanguage.ifBlank { "sw" }
        val reqHeaders = PlaybackBrowserHeaders.buildForUrl(gatewayUrl, session.headers, audioLang)
        val html = fetchBodyLegacy(gatewayUrl, reqHeaders) ?: return null

        resolveEmbedApiLegacy(gatewayUrl, html)?.let { resolved ->
            cache[gatewayUrl] = CacheEntry(resolved, System.currentTimeMillis() + CACHE_TTL_MS)
            return resolved
        }

        val encrypted = GatewayStreamExtractor.extract(html)
            ?: GatewayStreamExtractor.extractDrmFromHtml(html)
        if (encrypted != null && encrypted.streamUrl.lowercase().startsWith("http")) {
            return buildResolvedFromHtml(gatewayUrl, encrypted, reqHeaders)
        }

        val manifest = ManifestUrlExtractor.extract(html, gatewayUrl)
        if (manifest != null) {
            val origin = originOf(gatewayUrl)
            return Resolved(
                streamUrl = manifest.url,
                isHls = manifest.isHls,
                headers = mapOf(
                    "User-Agent" to mediaUa(),
                    "Referer" to if (origin.isNotEmpty()) "$origin/" else "",
                ),
                referer = if (origin.isNotEmpty()) "$origin/" else "",
                origin = origin,
            )
        }

        if (GatewayStreamExtractor.looksLikeHardBotChallenge(html)) {
            Log.w(TAG, "Gateway HTML is a hard bot challenge with no stream payload")
        }
        return null
    }

    /** Apply resolve onto session — DRM only on the real MPD, not the embed URL. */
    fun toStreamSession(base: StreamSession, resolved: Resolved): StreamSession {
        val headers = LinkedHashMap(resolved.headers)
        if (resolved.referer.isNotEmpty()) headers["Referer"] = resolved.referer
        if (resolved.origin.isNotEmpty()) headers["Origin"] = resolved.origin
        val auth = resolved.authToken.trim()
        if (auth.isNotEmpty()) {
            headers[licenseAuthHeader()] = auth
        }

        val clearKeys: List<ClearKey> =
            if (resolved.clearKeyRaw.isNotBlank()) {
                StreamSessionBuilder.parseClearKeysFromGateway(resolved.clearKeyRaw)
            } else {
                emptyList()
            }

        var drm = resolved.drmType ?: DrmType.NONE
        if (drm == DrmType.NONE) {
            drm = when {
                clearKeys.isNotEmpty() -> DrmType.CLEARKEY
                resolved.licenseUrl.isNotBlank() -> DrmType.WIDEVINE
                else -> DrmType.NONE
            }
        }
        if (drm != DrmType.NONE && drm != DrmType.CLEARKEY && resolved.licenseUrl.isBlank()) {
            drm = DrmType.NONE
        }
        if (drm == DrmType.CLEARKEY && clearKeys.isEmpty()) {
            drm = DrmType.NONE
        }

        val drmHeaders = LinkedHashMap<String, String>()
        if (auth.isNotEmpty()) {
            drmHeaders[licenseAuthHeader()] = auth
        }

        val drmData = when (drm) {
            DrmType.CLEARKEY -> DrmData(
                keys = clearKeys,
                headers = drmHeaders.takeIf { it.isNotEmpty() },
            )
            else -> DrmData(headers = drmHeaders.takeIf { it.isNotEmpty() })
        }

        Log.i(
            TAG,
            "gateway resolved drm=$drm url=${safeUrlForLogs(resolved.streamUrl)} " +
                "license=${resolved.licenseUrl.isNotBlank()} nv-auth=${auth.isNotEmpty()}",
        )

        return base.copy(
            mpdUrl = resolved.streamUrl,
            licenseUrl = resolved.licenseUrl,
            token = auth.ifBlank { base.token },
            playerMode = PlayerMode.EXO,
            drmType = drm,
            drmData = drmData,
            headers = headers,
        )
    }

    /**
     * Same sequence as Washa [GatewayEmbedResolver.resolve]:
     * 1) GET embed with package header (sets cookies)
     * 2) Discover player.php API URL
     * 3) GET JSON → mpdPath / licenseUrl / authXmlToken
     */
    private fun resolveLikeWasha(
        gatewayUrl: String,
        sessionHeaders: Map<String, String> = emptyMap(),
    ): Resolved? {
        val client = newCookieClient()
        // API / admin headers (e.g. X-Requested-With: com.washatv) win over defaults.
        val headers = PlaybackHttpHeaders.merge(sessionHeaders, gatewayUrl)

        val pageHtml = if (PlayerRuntimeConfig.warmCookies) {
            fetchText(client, gatewayUrl, headers) ?: return null
        } else {
            ""
        }
        if (pageHtml.contains(blockedMarker(), ignoreCase = true)) {
            Log.w(TAG, "gateway blocked app recognition url=${safeUrlForLogs(gatewayUrl)}")
            return null
        }
        // mpilali: player.php?channel=N returns JSON immediately (stream_url + clear_key).
        parseApiJson(pageHtml, gatewayUrl)?.let { return it }

        val apiUrl = findApiUrl(gatewayUrl, pageHtml) ?: return null
        Log.i(TAG, "api=${safeUrlForLogs(apiUrl)}")

        val apiHeaders = LinkedHashMap(headers).apply {
            put("Accept", "application/json")
            put("X-Requested-With", packageHeader())
        }

        var lastError = ""
        repeat(MAX_API_ATTEMPTS) { attempt ->
            val apiBody = fetchText(client, apiUrl, apiHeaders)
            if (apiBody.isNullOrBlank()) {
                lastError = "empty body"
                if (attempt < MAX_API_ATTEMPTS - 1) Thread.sleep(1500L * (attempt + 1))
                return@repeat
            }
            val parsed = parseApiJson(apiBody, gatewayUrl)
            if (parsed != null) return parsed

            val trimmed = apiBody.trim()
            if (trimmed.startsWith("{")) {
                try {
                    val json = JSONObject(trimmed)
                    lastError = json.optString("error").ifBlank { json.optString("message") }.take(120)
                    val retryable = lastError.contains("429") ||
                        lastError.contains("502") ||
                        lastError.contains("rate", ignoreCase = true) ||
                        lastError.contains("limekataliwa", ignoreCase = true)
                    if (retryable && attempt < MAX_API_ATTEMPTS - 1) {
                        Log.w(TAG, "Embed API rate-limited, retry ${attempt + 1}: $lastError")
                        Thread.sleep(2000L * (attempt + 1))
                        return@repeat
                    }
                } catch (_: Exception) {
                }
            }
            return null
        }
        Log.e(TAG, "Embed API resolver: no stream after retries ($lastError)")
        return null
    }

    private fun parseApiJson(body: String, gatewayUrl: String): Resolved? {
        return try {
            val trimmed = body.trim()
            if (!trimmed.startsWith("{")) return null
            val json = JSONObject(trimmed)
            if (json.optBoolean("success", true).not() &&
                !json.has("mpdPath") &&
                !json.has("stream_url") &&
                !json.has("streamUrl")
            ) {
                Log.w(TAG, "api error=${json.optString("error")}")
                return null
            }
            val mpd = json.optString("mpdPath").trim()
                .ifEmpty { json.optString("stream_url").trim() }
                .ifEmpty { json.optString("streamUrl").trim() }
                .ifEmpty { json.optString("manifestUrl").trim() }
                .ifEmpty { json.optString("url").trim() }
            if (mpd.isEmpty() || !mpd.startsWith("http")) {
                Log.w(TAG, "api missing stream url")
                return null
            }
            val license = json.optString("licenseUrl").trim()
                .ifEmpty { json.optString("license_url").trim() }
            val auth = json.optString("authXmlToken").trim()
                .ifEmpty { json.optString("authToken").trim() }
            val clearKey = json.optString("clear_key").trim()
                .ifEmpty { json.optString("clearKey").trim() }
            val drmRaw = json.optString("drmType").trim()
                .ifEmpty { json.optString("drm_type").trim() }
                .ifEmpty { "none" }
                .lowercase()
            val drm = when {
                clearKey.isNotEmpty() ||
                    drmRaw.contains("clearkey") ||
                    drmRaw.contains("clear_key") -> DrmType.CLEARKEY
                drmRaw.contains("widevine") || license.isNotEmpty() -> DrmType.WIDEVINE
                else -> DrmType.NONE
            }
            val origin = originOf(gatewayUrl)
            val referer = if (origin.isNotEmpty()) "$origin/" else ""
            val playHeaders = linkedMapOf(
                "User-Agent" to mediaUa(),
                "Referer" to referer,
            )
            if (auth.isNotEmpty()) {
                playHeaders[licenseAuthHeader()] = auth
            }
            Log.i(TAG, "Embed API resolved: ${safeUrlForLogs(mpd)} drm=$drm")
            Resolved(
                streamUrl = mpd,
                licenseUrl = license,
                authToken = auth,
                clearKeyRaw = clearKey,
                isHls = mpd.contains(".m3u8", ignoreCase = true),
                headers = playHeaders,
                drmType = when {
                    drm == DrmType.CLEARKEY && clearKey.isEmpty() -> DrmType.NONE
                    drm == DrmType.WIDEVINE && license.isEmpty() -> DrmType.NONE
                    else -> drm
                },
                referer = referer,
                origin = origin,
            )
        } catch (e: Exception) {
            Log.w(TAG, "api parse failed: ${e.message}")
            null
        }
    }

    private fun findApiUrl(gatewayUrl: String, html: String): String? {
        val inline = Regex(
            """API_URL\s*=\s*["']([^"']+)["']""",
            RegexOption.IGNORE_CASE,
        ).find(html)?.groupValues?.getOrNull(1)?.trim().orEmpty()
        if (inline.isNotEmpty()) {
            return absolutize(gatewayUrl, unescapeJsonUrl(inline))
        }

        val base = Uri.parse(gatewayUrl)
        val path = base.path.orEmpty().lowercase()
        if (path.contains("embed.php") || path.contains("player.php") || path.contains("watch.php")) {
            val channel = base.getQueryParameter("channel").orEmpty()
                .ifEmpty { base.getQueryParameter("ch").orEmpty() }
                .ifEmpty { base.getQueryParameter("id").orEmpty() }
            if (channel.isNotEmpty()) {
                // mpilali-style: the player URL itself is the JSON API.
                return gatewayUrl
            }
            val app = base.getQueryParameter("app").orEmpty()
            val key = base.getQueryParameter("key").orEmpty()
            if (app.isNotEmpty() && key.isNotEmpty()) {
                return base.buildUpon()
                    .path(base.path!!.replace(Regex("""(?i)embed\.php"""), "player.php"))
                    .clearQuery()
                    .appendQueryParameter("app", app)
                    .appendQueryParameter("key", key)
                    .appendQueryParameter("api", "1")
                    .appendQueryParameter("t", System.currentTimeMillis().toString())
                    .build()
                    .toString()
            }
        }

        val href = Regex(
            """(?:href|src)=["']([^"']*player\.php\?[^"']+)["']""",
            RegexOption.IGNORE_CASE,
        ).find(html)?.groupValues?.getOrNull(1)?.trim().orEmpty()
        if (href.isNotEmpty()) {
            val abs = absolutize(gatewayUrl, href)
            return if (abs.contains("api=")) abs
            else Uri.parse(abs).buildUpon()
                .appendQueryParameter("api", "1")
                .appendQueryParameter("t", System.currentTimeMillis().toString())
                .build()
                .toString()
        }
        return null
    }

    private fun unescapeJsonUrl(raw: String): String =
        raw.replace("\\u0026", "&").replace("\\/", "/")

    private fun absolutize(baseUrl: String, maybeRelative: String): String {
        val t = maybeRelative.trim()
        if (t.startsWith("http://") || t.startsWith("https://")) return t
        val base = Uri.parse(baseUrl)
        return if (t.startsWith("/")) {
            "${base.scheme}://${base.authority}$t"
        } else {
            val parent = base.path?.substringBeforeLast('/') ?: ""
            "${base.scheme}://${base.authority}$parent/$t"
        }
    }

    private fun resolveEmbedApiLegacy(playerUrl: String, html: String?): Resolved? {
        val parsed = runCatching { Uri.parse(playerUrl) }.getOrNull() ?: return null
        val appKey = extractAppKey(parsed, html) ?: return null
        val origin = originOf(playerUrl)
        if (origin.isEmpty()) return null
        val apiUrl =
            "$origin/player.php?app=${Uri.encode(appKey.first)}&key=${Uri.encode(appKey.second)}&api=1"
        val hdrs = linkedMapOf(
            "User-Agent" to PlayerRuntimeConfig.pageUserAgent.ifBlank { OrizonStreamClient.USER_AGENT },
            "Accept" to "application/json",
            "X-Requested-With" to packageHeader(),
            "Referer" to "$origin/",
        )
        val body = fetchBodyLegacy(apiUrl, hdrs, acceptJson = true) ?: return null
        return parseApiJson(body, playerUrl)
    }

    private fun extractAppKey(parsed: Uri, html: String?): Pair<String, String>? {
        var app = parsed.getQueryParameter("app")?.trim().orEmpty()
        var key = parsed.getQueryParameter("key")?.trim().orEmpty()
        val path = (parsed.path ?: "").lowercase()
        val isEmbedPhp = path.endsWith("/embed.php") || path.endsWith("embed.php")
        val isPlayerPhp = path.endsWith("/player.php") || path.endsWith("player.php")

        if ((app.isEmpty() || key.isEmpty()) && !html.isNullOrBlank()) {
            if (app.isEmpty()) app = pickHtmlParam(html, "app")
            if (key.isEmpty()) key = pickHtmlParam(html, "key")
        }
        if (app.isEmpty() || key.isEmpty()) return null
        if (!isEmbedPhp && !isPlayerPhp && html == null && !path.contains(".php")) {
            return null
        }
        return app to key
    }

    private fun pickHtmlParam(html: String, name: String): String {
        if (name.equals("app", ignoreCase = true)) {
            Regex("""[?&]app=([^&'"\s<>]+)""", RegexOption.IGNORE_CASE)
                .find(html)?.groupValues?.getOrNull(1)?.trim()?.let { if (it.isNotEmpty()) return it }
            Regex("""['"]app['"]\s*:\s*['"]?([^'",\s}]+)['"]?""", RegexOption.IGNORE_CASE)
                .find(html)?.groupValues?.getOrNull(1)?.trim()?.let { if (it.isNotEmpty()) return it }
        }
        if (name.equals("key", ignoreCase = true)) {
            Regex("""[?&]key=([^&'"\s<>]+)""", RegexOption.IGNORE_CASE)
                .find(html)?.groupValues?.getOrNull(1)?.trim()?.let { if (it.isNotEmpty()) return it }
            Regex("""['"]key['"]\s*:\s*['"]([^'"]+)['"]""", RegexOption.IGNORE_CASE)
                .find(html)?.groupValues?.getOrNull(1)?.trim()?.let { if (it.isNotEmpty()) return it }
        }
        return ""
    }

    private fun originOf(url: String): String {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return ""
        val host = uri.host?.takeIf { it.isNotBlank() } ?: return ""
        val scheme = uri.scheme?.takeIf { it.isNotBlank() } ?: "https"
        val port = when (val p = uri.port) {
            -1, 80, 443 -> ""
            else -> ":$p"
        }
        return "$scheme://$host$port"
    }

    private fun buildResolvedFromHtml(
        gatewayUrl: String,
        extracted: GatewayExtracted,
        reqHeaders: Map<String, String>,
    ): Resolved {
        val origin = originOf(gatewayUrl)
        val referer = if (origin.isNotEmpty()) "$origin/" else (reqHeaders["Referer"] ?: "")
        val merged = linkedMapOf(
            "User-Agent" to mediaUa(),
            "Referer" to referer,
        )
        if (extracted.authToken.isNotEmpty()) {
            merged[licenseAuthHeader()] = extracted.authToken
        }
        val license = extracted.licenseUrl
        val drm = when {
            license.isNotBlank() -> DrmType.WIDEVINE
            extracted.clearKeyRaw.isNotBlank() -> DrmType.CLEARKEY
            else -> null
        }
        Log.i(TAG, "Extracted direct stream from gateway (${safeUrlForLogs(gatewayUrl)})")
        return Resolved(
            streamUrl = extracted.streamUrl,
            licenseUrl = license,
            authToken = extracted.authToken,
            clearKeyRaw = extracted.clearKeyRaw,
            isHls = extracted.isHls,
            headers = merged.filterValues { it.isNotEmpty() },
            drmType = drm,
            referer = referer,
            origin = origin,
        )
    }

    private fun fetchText(
        client: OkHttpClient,
        url: String,
        headers: Map<String, String>,
    ): String? {
        return try {
            val req = Request.Builder().url(url).get()
            headers.forEach { (k, v) -> req.header(k, v) }
            if (headers.keys.none { it.equals("User-Agent", ignoreCase = true) }) {
                req.header("User-Agent", OrizonStreamClient.USER_AGENT)
            }
            client.newCall(req.build()).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "HTTP ${resp.code} url=${safeUrlForLogs(url)}")
                    // Allow JSON error bodies through for retry classification.
                    val body = resp.body?.string().orEmpty()
                    if (body.trim().startsWith("{")) return body
                    return null
                }
                resp.body?.string()
            }
        } catch (e: Exception) {
            Log.w(TAG, "fetch failed url=${safeUrlForLogs(url)}: ${e.message}")
            null
        }
    }

    private fun newCookieClient(): OkHttpClient {
        val jar = object : CookieJar {
            private val store = ConcurrentHashMap<String, List<Cookie>>()
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
                store[url.host] = cookies
            }
            override fun loadForRequest(url: HttpUrl): List<Cookie> =
                store[url.host].orEmpty()
        }
        return OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .cookieJar(jar)
            .build()
    }

    private fun fetchBodyLegacy(
        url: String,
        headers: Map<String, String>,
        acceptJson: Boolean = false,
    ): String? {
        var connection: java.net.HttpURLConnection? = null
        return try {
            connection = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 15_000
                readTimeout = 15_000
                requestMethod = "GET"
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
                if (acceptJson) setRequestProperty("Accept", "application/json")
            }
            val code = connection.responseCode
            val stream: java.io.InputStream? =
                if (code in 200..299) connection.inputStream else connection.errorStream
            if (stream == null) return null
            val body = stream.bufferedReader(Charsets.UTF_8).use { it.readText().take(512 * 1024) }
            if (code !in 200..299) {
                if (acceptJson && body.trim().startsWith("{")) return body
                return null
            }
            body
        } catch (e: Exception) {
            Log.w(TAG, "Gateway fetch failed: ${e.message}")
            null
        } finally {
            connection?.disconnect()
        }
    }
}
