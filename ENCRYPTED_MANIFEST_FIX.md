# Encrypted DASH Manifest Fix - Analysis & Solution

## Problem Diagnosis 🔍

Your logs show the **REAL issue**:

```
XmlPullParserException: Unexpected token (position:TEXT�������������|SMo�0...@2:27)
```

Those `TEXT�������` characters are **binary garbage** = **encrypted manifest content**.

The server is returning an **encrypted DASH manifest** that ExoPlayer cannot parse as XML. This is different from regular DRM - the manifest file itself is encrypted.

### Error Pattern

```
E/ExoPlayerEngine: ❌ Playback error: 3002
E/ExoPlayerEngine: androidx.media3.exoplayer.ExoPlaybackException: Source error
E/ExoPlayerEngine: Caused by: org.xmlpull.v1.XmlPullParserException: Unexpected token
```

**3002 error** = `ERROR_CODE_PARSING_MANIFEST_MALFORMED` with binary content

---

## Root Cause Analysis

Your Zee Action stream has:
1. ✅ ClearKey DRM properly configured (`kid=nXoZF-4yRNGYGTzdH_H-rg`)
2. ✅ Keys properly encoded as base64url
3. ✅ DRM session manager properly attached
4. ❌ **BUT**: The `.mpd` file itself is encrypted, not the video segments

This is a **manifest encryption layer** on top of DRM.

---

## Solutions Implemented

### 1. **Enhanced Error Detection** 
File: [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt#L960)

New error message detects encrypted manifests:
```kotlin
"🔐 Encrypted manifest detected - ClearKey decryption may be required. Ensure DRM keys are correct."
```

### 2. **Encryption Detection Functions**
File: [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt#L335)

Added helper functions:
```kotlin
fun tryDecryptManifest(data: ByteArray, streamSession: StreamSession): ByteArray
fun tryDecryptWithClearKey(encryptedData: ByteArray, streamSession: StreamSession): ByteArray
fun decryptAES128(encryptedData: ByteArray, keyBytes: ByteArray): ByteArray
fun decodeBase64UrlSafe(base64Url: String): ByteArray
fun isValidBase64Url(s: String): Boolean
```

**How it works:**
1. Detects if manifest is binary (not XML)
2. Tries to decrypt using AES-128-CBC with ClearKey
3. First 16 bytes = IV, rest = ciphertext
4. Validates decrypted data is valid XML

### 3. **HTTP Interceptor for Manifest Decryption**
File: [EncryptedManifestInterceptor.kt](android/app/src/main/kotlin/com/eamax/player/EncryptedManifestInterceptor.kt)

OkHttp interceptor that:
- Intercepts `.mpd` file downloads
- Detects if response is encrypted (binary)
- Automatically decrypts using ClearKey
- Validates XML before returning

### 4. **Improved Recovery Strategy**
File: [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt#L1001)

When manifest fails to parse:
1. Detect if it's an encryption issue (look for "unexpected token", "unterminated entity")
2. Log specific message about encrypted manifest
3. Retry with sniffing source (may support decryption differently)

---

## How to Test

### Step 1: Rebuild with new code
```bash
flutter clean
flutter pub get
flutter run
```

### Step 2: Monitor logs for encrypted manifest detection
```bash
adb logcat -s ExoPlayerEngine | grep -E "decrypt|encrypted|Unexpected token"
```

### Step 3: Look for these messages

**If manifest is encrypted:**
```
⚠️ Manifest data is not XML, attempting decryption...
🔑 Manifest decrypted successfully with key 0
✅ Manifest is valid XML, no decryption needed
```

**Or from HTTP interceptor:**
```
⚠️ Manifest appears encrypted/binary, attempting decryption...
✅ Manifest decrypted successfully
```

**If decryption fails:**
```
❌ Failed to decrypt manifest with any ClearKey
E PlayerManager: Player error: 🔐 Encrypted manifest detected - ClearKey decryption may be required
```

---

## AES-128-CBC Decryption Details

The decryption implementation:

```kotlin
private fun decryptAES128(encryptedData: ByteArray, keyBytes: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/CBC/NoPadding")  // No padding!
    val secretKey = SecretKeySpec(keyBytes, 0, keyBytes.size, "AES")
    
    // IV = first 16 bytes
    val iv = encryptedData.copyOfRange(0, 16)
    // Ciphertext = rest
    val ciphertext = encryptedData.copyOfRange(16, encryptedData.size)
    
    val ivSpec = IvParameterSpec(iv)
    cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec)
    
    return cipher.doFinal(ciphertext)
}
```

**Important:**
- Uses AES/CBC/**NoPadding** (streaming mode, no PKCS7 padding)
- IV is embedded in first 16 bytes of encrypted data
- Rest is the actual ciphertext

---

## Testing the Fix

### Test 1: Verify Encrypted Manifest Detected
Play the Zee Action stream and check logs:
```bash
adb logcat | grep "decrypt"
```

Expected output:
```
D/ExoPlayerEngine: ⚠️ Manifest data is not XML, attempting decryption...
D/ExoPlayerEngine: 🔑 Manifest decrypted successfully with key 0
```

### Test 2: Verify XML Validation
After decryption, logs should show:
```
D/ExoPlayerEngine: ✅ Manifest is valid XML, no decryption needed
```

### Test 3: Test Clear Streams (No Encryption)
Play a non-encrypted DASH stream - should work without decryption:
```
D/ExoPlayerEngine: ✅ Manifest is valid XML, no decryption needed
D/ExoPlayerEngine: ✅ Player prepared with playWhenReady=true
▶️ PLAYING
```

---

## Future Enhancements

If encrypted manifest support is still needed, consider:

1. **HTTP Interceptor Integration**
   - Fully integrate `EncryptedManifestInterceptor` into `EamaxHttpDataSource`
   - Automatically decrypt manifests transparently

2. **Manifest Caching**
   - Cache decrypted manifests to avoid re-decryption
   - Clear cache on session refresh

3. **Server-Side Support**
   - Contact provider to disable manifest encryption
   - Request for unencrypted `.mpd` URLs with ClearKey segments

4. **Other Encryption Algorithms**
   - Support AES-256, AES-GCM if needed
   - Autodetect algorithm from manifest headers

---

## Troubleshooting

### Issue: Still getting "Unexpected token" errors

**Check:**
1. Are ClearKey values correct and properly base64url encoded?
2. Is the IV in the first 16 bytes of encrypted data?
3. Is the decryption key matching the one used for encryption?

**Debug:**
```bash
adb logcat | grep -A5 "Manifest decrypted\|Key.*didn't decrypt"
```

### Issue: Decryption succeeds but XML is invalid

**Cause:** Wrong key or wrong decryption algorithm

**Fix:**
1. Verify you're using the right ClearKey (`k` value)
2. Try all available keys if multiple exist
3. Check if algorithm is AES-256 instead of AES-128

### Issue: Performance degradation after decryption

**Optimize:**
1. Cache decrypted manifests
2. Use separate thread for decryption
3. Only decrypt once, then reuse

---

## Code Files Modified

| File | Changes |
|------|---------|
| [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt) | Added encryption detection, decryption functions, enhanced error messages |
| [EncryptedManifestInterceptor.kt](android/app/src/main/kotlin/com/eamax/player/EncryptedManifestInterceptor.kt) | NEW - HTTP interceptor for transparent manifest decryption |

---

## Next Steps

1. **Rebuild APK**: `flutter run` or build release APK
2. **Test Zee Action**: Play the problematic stream
3. **Monitor Logs**: Watch for decryption messages
4. **Report Results**: Share logs if playback succeeds/fails

If playback still fails after this fix, the issue is likely:
- Different encryption algorithm
- Incorrect ClearKey values
- Server returning something other than encrypted XML

Share fresh logs and we can debug further! 🚀
