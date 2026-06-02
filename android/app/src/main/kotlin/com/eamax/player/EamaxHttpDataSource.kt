package com.eamax.player

import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.ConnectionSpec
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Protocol
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * Shared HTTP client for Media3, DRM license calls, and [StreamProbe].
 *
 * Goals across **Wi‑Fi, mobile data, IPv4-only, dual-stack IPv4/IPv6, and slow links**:
 * - **OkHttp** instead of `HttpURLConnection` (better redirects, HTTP/2, retries).
 * - **IPv4-first** when both address families exist (many Wi‑Fi setups return broken IPv6 first).
 * - **MODERN_TLS + COMPATIBLE_TLS + CLEARTEXT** for TLS/certificate variety and rare HTTP streams.
 * - **Longer timeouts** than default for congested or high-latency networks.
 * - **retryOnConnectionFailure** for transient RST / route flaps.
 */
object EamaxHttpDataSource {

    private const val CONNECT_SEC = 60L
    private const val READ_SEC = 60L
    private const val WRITE_SEC = 60L

    /**
     * Wi‑Fi often exposes **both** IPv4 + IPv6; if IPv6 routing is broken, Java/Exo used to fail
     * while **mobile data** (IPv4-only) still worked.
     *
     * When any **IPv4 (A)** exists, use **only** IPv4 — same paths as typical cellular.
     * Pure **IPv6-only** hosts (AAAA only) still return those addresses unchanged.
     */
    private val networkDns =
        object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val all = Dns.SYSTEM.lookup(hostname)
                val v4 = all.filterIsInstance<Inet4Address>()
                return if (v4.isNotEmpty()) v4 else all
            }
        }

    private val connectionSpecs = listOf(
        ConnectionSpec.MODERN_TLS,
        ConnectionSpec.COMPATIBLE_TLS,
        ConnectionSpec.CLEARTEXT,
    )

    private val sharedClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .dns(networkDns)
            .connectTimeout(CONNECT_SEC, TimeUnit.SECONDS)
            .readTimeout(READ_SEC, TimeUnit.SECONDS)
            .writeTimeout(WRITE_SEC, TimeUnit.SECONDS)
            // Do not cap entire exchange; segments can be long-lived.
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .connectionSpecs(connectionSpecs)
            .protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
            .build()
    }

    /** Same sockets/DNS/TLS as playback — probe and Exo stay consistent. */
    fun probeClient(): OkHttpClient = sharedClient

    /**
     * Short-timeout client used only by [StreamProbe] for format detection.
     * Falls back fast so users see playback (or error) without waiting 60s.
     * 8s connect / 10s read is generous enough for high-latency mobile networks.
     */
    val fastProbeClient: OkHttpClient by lazy {
        sharedClient.newBuilder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .callTimeout(12, TimeUnit.SECONDS)
            .build()
    }
    fun fastProbeClient(): OkHttpClient = fastProbeClient

    @Suppress("UNUSED_PARAMETER")
    fun factory(
        headers: Map<String, String>,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
        manifestClearKeyBytes: List<ByteArray>? = null,
    ): HttpDataSource.Factory {
        val clientBuilder = sharedClient.newBuilder()
            .connectTimeout(connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(readTimeoutMs.toLong(), TimeUnit.MILLISECONDS)

        if (!manifestClearKeyBytes.isNullOrEmpty()) {
            clientBuilder.addInterceptor(EncryptedManifestInterceptor(manifestClearKeyBytes))
        }

        return OkHttpDataSource.Factory(clientBuilder.build())
            .setDefaultRequestProperties(headers)
    }
}
