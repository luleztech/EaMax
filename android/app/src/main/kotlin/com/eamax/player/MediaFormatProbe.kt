package com.eamax.player

import okhttp3.Request
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Sniffs the real media format of a URL that has no usable file extension
 * (IPTV panel links, tokenised CDN paths, `?id=` endpoints, redirects…).
 *
 * Reads at most [PROBE_BYTES] with a Range request, then closes the socket, so a live
 * stream is never downloaded. Anything that cannot be identified returns null and the
 * caller falls back to the heuristic classifier + format retry queue.
 */
object MediaFormatProbe {

    private const val PROBE_BYTES = 2048

    val executor = Executors.newCachedThreadPool { r ->
        Thread(r, "eamax-format-probe").apply { isDaemon = true }
    }

    private val client by lazy {
        OrizonStreamClient.okHttpClient.newBuilder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .callTimeout(4, TimeUnit.SECONDS)
            .build()
    }

    fun probe(url: String, headers: Map<String, String>): OrizonPlayerFactory.Format? {
        val builder = Request.Builder().url(url).get()
        headers.forEach { (k, v) ->
            val lk = k.lowercase()
            if (lk == "range" || lk == "host" || lk == "content-length" || v.isBlank()) return@forEach
            runCatching { builder.header(k, v) }
        }
        builder.header("Range", "bytes=0-${PROBE_BYTES - 1}")

        return client.newCall(builder.build()).execute().use { resp ->
            if (!resp.isSuccessful) return@use null

            // A redirect can land on a URL that does have an extension.
            StreamUrlClassifier.pathFormat(resp.request.url.toString())?.toFactoryFormat()
                ?.let { return@use it }

            val contentType = resp.header("Content-Type").orEmpty().lowercase()
            val stream = resp.body?.byteStream() ?: return@use null
            val buf = ByteArray(PROBE_BYTES)
            var n = 0
            while (n < PROBE_BYTES) {
                val r = stream.read(buf, n, PROBE_BYTES - n)
                if (r <= 0) break
                n += r
                // Enough to decide on a text manifest; TS needs >188 bytes.
                if (n >= 512 && looksTextual(buf, n)) break
            }
            sniff(contentType, buf, n)
        }
    }

    private fun StreamUrlClassifier.Format.toFactoryFormat(): OrizonPlayerFactory.Format? = when (this) {
        StreamUrlClassifier.Format.HLS -> OrizonPlayerFactory.Format.HLS
        StreamUrlClassifier.Format.DASH -> OrizonPlayerFactory.Format.DASH
        StreamUrlClassifier.Format.PROGRESSIVE -> OrizonPlayerFactory.Format.PROGRESSIVE
        else -> null
    }

    private fun looksTextual(b: ByteArray, n: Int): Boolean {
        for (i in 0 until minOf(n, 64)) {
            val c = b[i].toInt() and 0xFF
            if (c == 0 || (c < 9) || (c in 14..31)) return false
        }
        return true
    }

    internal fun sniff(contentType: String, b: ByteArray, n: Int): OrizonPlayerFactory.Format? {
        if (n > 0) {
            val text = String(b, 0, minOf(n, 1024), Charsets.ISO_8859_1)
                .trimStart('\uFEFF', 'ï', '»', '¿', ' ', '\n', '\r', '\t')
            if (text.startsWith("#EXTM3U")) return OrizonPlayerFactory.Format.HLS
            if (text.contains("<MPD", ignoreCase = true)) return OrizonPlayerFactory.Format.DASH
        }
        if (contentType.contains("mpegurl")) return OrizonPlayerFactory.Format.HLS
        if (contentType.contains("dash+xml")) return OrizonPlayerFactory.Format.DASH

        if (n >= 189 && b[0] == 0x47.toByte() && b[188] == 0x47.toByte()) {
            return OrizonPlayerFactory.Format.PROGRESSIVE // MPEG-TS
        }
        if (n >= 12 && b[4] == 'f'.code.toByte() && b[5] == 't'.code.toByte() &&
            b[6] == 'y'.code.toByte() && b[7] == 'p'.code.toByte()
        ) {
            return OrizonPlayerFactory.Format.PROGRESSIVE // MP4 / M4V / 3GP
        }
        if (n >= 4 && (b[0].toInt() and 0xFF) == 0x1A && (b[1].toInt() and 0xFF) == 0x45 &&
            (b[2].toInt() and 0xFF) == 0xDF && (b[3].toInt() and 0xFF) == 0xA3
        ) {
            return OrizonPlayerFactory.Format.PROGRESSIVE // Matroska / WebM
        }
        if (n >= 3 && (
                (b[0] == 'F'.code.toByte() && b[1] == 'L'.code.toByte() && b[2] == 'V'.code.toByte()) ||
                    (b[0] == 'I'.code.toByte() && b[1] == 'D'.code.toByte() && b[2] == '3'.code.toByte()) ||
                    (b[0] == 'O'.code.toByte() && b[1] == 'g'.code.toByte() && b[2] == 'g'.code.toByte())
                )
        ) {
            return OrizonPlayerFactory.Format.PROGRESSIVE
        }
        if (n >= 2 && (b[0].toInt() and 0xFF) == 0xFF && (b[1].toInt() and 0xF0) == 0xF0) {
            return OrizonPlayerFactory.Format.PROGRESSIVE // ADTS / MP3 frame
        }
        if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
            return OrizonPlayerFactory.Format.PROGRESSIVE
        }
        return null
    }
}
