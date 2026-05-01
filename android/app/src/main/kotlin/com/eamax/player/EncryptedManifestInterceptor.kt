package com.eamax.player

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Locale
import java.util.zip.GZIPInputStream
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

private const val TAG = "ManifestInterceptor"

class EncryptedManifestInterceptor(
    private val clearKeyBytes: List<ByteArray>
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        val path = request.url.encodedPath.lowercase(Locale.ROOT)
        if (!path.contains(".mpd")) {
            return response
        }

        val contentType = response.body?.contentType()?.toString()?.lowercase(Locale.ROOT)
        if (response.code != 200 || response.body == null) {
            return response
        }

        val bodyBytes = response.body!!.bytes()
        if (bodyBytes.isEmpty()) {
            return response
        }

        val decompressed = maybeDecompressGzip(bodyBytes)
        if (looksLikeXml(decompressed)) {
            Log.d(TAG, "✅ Manifest is gzipped and decompressed successfully")
            return response.newBuilder()
                .body(decompressed.toResponseBody(response.body!!.contentType()))
                .build()
        }

        if (bodyBytes !== decompressed) {
            Log.w(TAG, "⚠️ Manifest decompressed but still not XML; trying decryption on decompressed bytes")
        } else {
            Log.w(TAG, "⚠️ Manifest appears encrypted/binary, attempting decryption...")
        }

        val targetBytes = if (bodyBytes !== decompressed) decompressed else bodyBytes
        for ((index, keyBytes) in clearKeyBytes.withIndex()) {
            try {
                val decrypted = decryptManifest(targetBytes, keyBytes)
                if (looksLikeXml(decrypted)) {
                    Log.d(TAG, "✅ Decrypted manifest with ClearKey #$index")
                    return response.newBuilder()
                        .body(decrypted.toResponseBody(response.body!!.contentType()))
                        .build()
                }
            } catch (e: Exception) {
                Log.w(TAG, "⚠️ ClearKey #$index did not decrypt manifest: ${e.message}")
            }
        }

        if (bodyBytes !== decompressed) {
            Log.w(TAG, "⚠️ Returning decompressed manifest payload after failed decryption")
            return response.newBuilder()
                .body(decompressed.toResponseBody(response.body!!.contentType()))
                .build()
        }

        Log.e(TAG, "❌ Unable to decrypt manifest; returning original response")
        return response.newBuilder()
            .body(bodyBytes.toResponseBody(response.body!!.contentType()))
            .build()
    }

    private fun looksLikeXml(bytes: ByteArray): Boolean {
        val prefix = bytes.take(128).toByteArray().toString(Charsets.UTF_8).trimStart()
        return prefix.startsWith("<?xml") || prefix.startsWith("<MPD") || prefix.startsWith("<mpd")
    }

    private fun maybeDecompressGzip(bytes: ByteArray): ByteArray {
        return if (bytes.size >= 2 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte()) {
            try {
                GZIPInputStream(ByteArrayInputStream(bytes)).use { gzip ->
                    gzip.readBytes()
                }
            } catch (e: IOException) {
                Log.w(TAG, "⚠️ Failed to decompress gzip manifest: ${e.message}")
                bytes
            }
        } else {
            bytes
        }
    }

    private fun decryptManifest(input: ByteArray, keyBytes: ByteArray): ByteArray {
        if (input.size <= 16) throw IOException("Manifest too short for IV + ciphertext")
        val iv = input.copyOfRange(0, 16)
        val cipherText = input.copyOfRange(16, input.size)
        val key = SecretKeySpec(keyBytes, "AES")
        val ivSpec = IvParameterSpec(iv)

        val pkcs5 = runCatching {
            val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(Cipher.DECRYPT_MODE, key, ivSpec)
            cipher.doFinal(cipherText)
        }.getOrNull()
        if (pkcs5 != null) return pkcs5

        return runCatching {
            val cipher = Cipher.getInstance("AES/CBC/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, ivSpec)
            stripTrailingNulls(cipher.doFinal(cipherText))
        }.getOrElse { throw IOException("Manifest decrypt failed for both PKCS5Padding and NoPadding", it) }
    }

    private fun stripTrailingNulls(input: ByteArray): ByteArray {
        var end = input.size
        while (end > 0 && input[end - 1] == 0.toByte()) {
            end--
        }
        return if (end == input.size) input else input.copyOf(end)
    }
}
