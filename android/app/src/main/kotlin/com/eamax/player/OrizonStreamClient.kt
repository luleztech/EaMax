package com.eamax.player

import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Stream HTTP stack recovered from Orizon TV 1.7.1 (`streamOkHttpClient` + OkHttpDataSource).
 */
object OrizonStreamClient {
    const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

    private const val CONNECT_TIMEOUT_SEC = 12L
    // Live HTTP stays open. A short read timeout closes the socket during a
    // brief upstream pause and the player restarts — that is a scratch.
    private const val READ_TIMEOUT_SEC = 45L
    private const val WRITE_TIMEOUT_SEC = 30L

    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SEC, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SEC, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SEC, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .followRedirects(true)
            .followSslRedirects(true)
            // Reuse sockets across playlist/segment fetches (no TLS handshake per segment).
            .connectionPool(ConnectionPool(10, 5, TimeUnit.MINUTES))
            .dispatcher(
                Dispatcher().apply {
                    maxRequests = 64
                    maxRequestsPerHost = 16
                },
            )
            .build()
    }

    /**
     * Opens the TCP + TLS (HTTP/2) connection to the stream host ahead of time so the player's
     * first manifest request reuses it from the pool instead of paying the handshake.
     */
    fun preconnect(url: String) {
        val httpUrl = url.trim().toHttpUrlOrNull() ?: return
        if (httpUrl.scheme != "http" && httpUrl.scheme != "https") return
        warmExecutor.execute {
            try {
                val root = httpUrl.newBuilder().encodedPath("/").query(null).fragment(null).build()
                okHttpClient.newCall(Request.Builder().url(root).head().build())
                    .execute()
                    .close()
            } catch (_: Exception) {
                // Best effort only.
            }
        }
    }

    private val warmExecutor = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread(r, "orizon-preconnect").apply { isDaemon = true }
    }

    fun dataSourceFactory(headers: Map<String, String>): HttpDataSource.Factory {
        val userAgent = headers.entries
            .firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }
            ?.value
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: USER_AGENT
        return OkHttpDataSource.Factory(okHttpClient)
            .setUserAgent(userAgent)
            .setDefaultRequestProperties(headers)
    }
}
