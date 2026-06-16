package com.eamax.player

import android.net.Uri

/**
 * URL classification aligned with EaMax React Native [phpStreamSupport] + [StreamEngine].
 * Gateway pages (.php, /embed/, etc.) often return HTML with buried .m3u8 / .mpd links.
 */
object StreamUrlClassifier {

    fun isPhpLikeUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return Regex("""\.php(\?|$|#)""", RegexOption.IGNORE_CASE).containsMatchIn(url)
    }

    /** PHP, ASP, player gateways, embed paths — probe/sniff instead of assuming DASH. */
    fun isLikelyGatewayUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        // Direct manifest/progressive URLs are never gateway pages (paths may contain /stream/ or /play/).
        if (hasObviousM3u8(url) || hasObviousMpd(url) || hasObviousProgressiveExtension(url)) return false
        val u = url.lowercase()
        return Regex("""\.(php|asp|aspx|cgi|jsp|html?)(\?|$|#)""", RegexOption.IGNORE_CASE).containsMatchIn(url) ||
            "/embed/" in u || "/gateway/" in u ||
            ("/stream/" in u && !hasObviousM3u8(url) && !hasObviousMpd(url)) ||
            ("/play/" in u && !hasObviousM3u8(url) && !hasObviousMpd(url)) ||
            "/player/" in u
    }

    /** IPTV / panel URLs without file extension (with or without port). */
    fun isLikelyIptvLiveUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        if (hasObviousM3u8(url) || hasObviousMpd(url) || hasObviousProgressiveExtension(url)) return false
        val base = url.split("#").first().lowercase()
        if (Regex("""^https?://[^/]+:\d{2,5}/(live|stream|play|hls|iptv|channel|ch)/""").containsMatchIn(base)) {
            return true
        }
        if (Regex("""^https?://[^/]+:\d{2,5}/[^/]+/[^/]+/[^/?#]+$""").containsMatchIn(base)) return true
        if (Regex("""^https?://[^/]+/(live|stream|play|hls|iptv|channel|ch)/[^/?#]+""").containsMatchIn(base)) {
            return true
        }
        return false
    }

    fun hasObviousM3u8(url: String): Boolean =
        Regex("""\.m3u8?(\?|#|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url) ||
            Regex("""[?&](format|type)=m3u8?(\b|&|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url)

    fun hasObviousMpd(url: String): Boolean =
        Regex("""\.mpd(\?|#|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url)

    fun hasObviousProgressiveExtension(url: String): Boolean {
        val u = url.lowercase()
        return listOf(".mp4", ".m4v", ".webm", ".mkv", ".mov", ".ts").any { u.contains(it) }
    }

    fun isRelayStyleUrl(url: String): Boolean {
        val u = url.lowercase()
        return "/relay/stream" in u || "/relay/m3u8" in u || "/api/relay/" in u
    }

    /**
     * Signed redirect fronts (e.g. `*.ycn-redirect.com/live/.../index.m3u8`) often answer **403 /
     * "blocked"** to library User-Agents. Use browser-like UA + Referer/Origin — same idea as
     * [PhpWebViewSupport.BROWSER_PLAYBACK_USER_AGENT] for gateway probes in [StreamProbe].
     */
    fun isYcnRedirectHost(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val host = Uri.parse(url.trim()).host?.lowercase().orEmpty()
            host == "ycn-redirect.com" || host.endsWith(".ycn-redirect.com")
        } catch (_: Exception) {
            false
        }
    }

    /** Azam / tokenized CDNs that serve Widevine DASH — never promote Exo without a license URL. */
    fun likelyRequiresWidevine(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        return u.contains("azamtvltd") ||
            u.contains("cdntoken=") ||
            u.contains("cdnblncr") ||
            u.contains("mpilalivetv") ||
            u.contains("/wv/") ||
            u.contains("widevine")
    }

    fun isNagraLicense(licenseUrl: String?): Boolean {
        if (licenseUrl.isNullOrBlank()) return false
        return licenseUrl.contains("nagra", ignoreCase = true)
    }

    /**
     * True for real Widevine license POST endpoints — not CDN manifest/token URLs.
     * Azam gateways often expose `.../tok_eyJ...` URLs that must stay in WebView Shaka.
     */
    fun isLikelyLicenseServerUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.trim().lowercase()
        if (!u.startsWith("http")) return false
        if (hasObviousM3u8(u) || hasObviousMpd(u)) return false
        if (u.contains("/tok_") || u.contains("tok_eyj")) return false
        if (u.contains("cdntoken=")) return false
        if (isNagraLicense(url)) return true
        if (Regex("""/(license|licenses|licence|licences|getkey|acquirelicense|rights)""", RegexOption.IGNORE_CASE)
                .containsMatchIn(u)
        ) {
            return true
        }
        if (u.contains("widevine") && (u.contains("license") || u.contains("/wv/"))) return true
        if (u.contains("rightsmanager")) return true
        if (u.contains("azamtvltd") &&
            (u.contains("license") || u.contains("/wv/") || u.contains("nagra"))
        ) {
            return true
        }
        return false
    }

    /** License URLs captured from gateway network hooks (may not match strict server heuristics). */
    fun isGatewayCapturedLicenseUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.trim().lowercase()
        if (!u.startsWith("http")) return false
        if (hasObviousM3u8(u) || hasObviousMpd(u)) return false
        if (u.contains("/tok_") || u.contains("tok_eyj")) return false
        if (isNagraLicense(url)) return true
        if (u.contains("azamtvltd") &&
            (u.contains("license") || u.contains("/wv/") || u.contains("rights") ||
                u.contains("getkey") || u.contains("acquire"))
        ) {
            return true
        }
        return isLikelyLicenseServerUrl(url)
    }

    /** Native Exo needs a real license server (or clear keys). Otherwise keep WebView Shaka. */
    fun canPromoteGatewayToNativeExo(extracted: PhpGatewayExtractor.Extracted): Boolean {
        if (extracted.clearKeys.isNotEmpty()) return true
        if (!likelyRequiresWidevine(extracted.streamUrl)) return true
        return isLikelyLicenseServerUrl(extracted.licenseUrl)
    }
}
