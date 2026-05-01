# ExoPlayer DASH + ClearKey - Troubleshooting Guide

## Problem: "Invalid stream manifest. Server may have returned login page or wrong file"

This error occurs when ExoPlayer fails to parse the `.mpd` (DASH manifest) file, typically due to:
1. Server returning HTML/login page instead of XML manifest
2. Incorrect ClearKey credentials
3. DRM session not properly initialized
4. Missing/incorrect MIME type declaration

---

## Solutions Applied ✅

### 1. **Enhanced DRM Session Manager Attachment**
- **File**: [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt#L485)
- **Issue**: DRM must be attached BEFORE the media source processes the manifest
- **Fix**: 
  - `createDashMediaSource()` - Now attaches DRM session manager with error logging
  - `createSniffingMediaSource()` - Now marks DRM as CRITICAL and logs DRM type
  - Better error messages for manifest parsing failures

### 2. **Explicit MIME Type Declaration** 
- **File**: [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt#L349)
- **Issue**: `.mpd` files may not be recognized without `application/dash+xml` MIME type
- **Fix**: 
  ```kotlin
  StreamFormat.DASH -> "application/dash+xml"      // CRITICAL
  StreamFormat.SNIFFING -> {
      // Try to detect from URL if obvious (.mpd or .m3u8)
      when {
          streamSession.mpdUrl.contains(".mpd", ignoreCase = true) -> "application/dash+xml"
          streamSession.mpdUrl.contains(".m3u8", ignoreCase = true) -> "application/x-mpegurl"
          else -> null
      }
  }
  ```

### 3. **ClearKey Validation and Multi-Session Support**
- **File**: [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt#L608)
- **Issues Fixed**:
  - Added `isValidBase64Url()` validation to catch malformed keys early
  - Changed `setMultiSession(false)` → `setMultiSession(true)` for proper segment decryption
  - Better error messages when keys are missing/invalid

### 4. **Improved Error Logging**
- All DRM operations now log the DRM type being used
- Manifest parsing errors are caught with specific messages
- Base64url validation provides clear feedback on key format issues

---

## Debugging Steps

### Step 1: Check Logcat for ClearKey Issues
```bash
# Look for these patterns:
adb logcat | grep -E "ClearKey|CLEARKEY|buildClearKeyJson|isValidBase64Url"
```

**Expected logs:**
```
D/ExoPlayerEngine: 🔑 Building ClearKey JSON with 1 key(s)
D/ExoPlayerEngine: ✅ ClearKey JSON payload created successfully
D/ExoPlayerEngine: 🔑 Creating ClearKey DRM session manager
```

**Error patterns to fix:**
```
❌ Invalid ClearKey format at index 0 - kid/k must be base64url encoded
❌ ClearKey stream missing keys in drmData
```

### Step 2: Check MIME Type Handling
```bash
adb logcat | grep -E "createDashMediaSource|application/dash"
```

**Expected logs:**
```
D/ExoPlayerEngine: 🎬 Creating DASH media source
D/ExoPlayerEngine: ✅ DRM session manager attached to DASH source (CLEARKEY)
```

### Step 3: Check StreamProbe Detection
```bash
adb logcat | grep -E "StreamProbe|resolveForSession|probeHttp"
```

**Look for these checks:**
- ✅ Is `Content-Type` detection working?
- ✅ Is manifest body being checked (not HTML)?
- ✅ Is `.mpd` URL properly identified?

---

## Common Issues & Fixes

### Issue 1: "Content-Type claims DASH but body is not MPD"
**Root Cause**: Server returns `Content-Type: application/dash+xml` but body is HTML login page

**Fix**: Check your channel data for:
- Is authentication token being passed?
- Are required headers present (Referer, Authorization)?
- Does the proxy/relay accept the current token?

```dart
// In combined_home.dart, verify:
final token = _extractPlaybackToken(channelData);
final playbackHeaders = _extractPlaybackHeaders(channelData);
// These should not be empty for DRM streams
```

### Issue 2: "ClearKey stream missing keys in drmData"
**Root Cause**: ClearKey data not properly parsed from channel info

**Fix**: Verify the channel data includes:
```dart
channelData?['drmType'] == 'CLEARKEY'
channelData?['drmClearKey'] // Contains the keys
```

The clearKey format should be:
- **Single key**: `kid:key` or `kid,key`
- **Multiple keys**: `kid1:key1;kid2:key2`
- **JSON format**: `{"keys":[{"kid":"...", "k":"..."}]}`

### Issue 3: "Invalid ClearKey format - kid/k must be base64url encoded"
**Root Cause**: Keys are not in base64url format (should only contain: A-Z, a-z, 0-9, -, _)

**Fix**: Verify key format:
```kotlin
// ✅ Valid format (base64url)
kid: "ooPUbuuOOuuuouo-Uw"
k:   "lxIvlBZOgIlpuuuuOuuo"

// ❌ Invalid (hex or standard base64)
kid: "a0b1c2d3e4f5a6b7"     // hex
k:   "a0b1c2d3e4f5a6b7=="  // standard base64 with padding
```

To convert hex to base64url:
```kotlin
// This is handled by StreamSessionBuilder.normalizeClearKeyValue()
// It auto-converts 32+ character hex strings to base64url
```

### Issue 4: Manifest Still Fails Even With DRM Fixed
**Root Cause**: Server returning HTML/login page on manifest request

**Debug**: Check the actual response:
```bash
# Test manifest request directly
curl -I -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Referer: YOUR_REFERER" \
     "https://your-mpd-url.mpd"

# Should return: Content-Type: application/dash+xml
# NOT: Content-Type: text/html
```

---

## ClearKey Format Validation

The new `isValidBase64Url()` function validates:

```kotlin
✅ Valid:  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_="
❌ Invalid: Special chars except dash/underscore
❌ Invalid: + or / (use base64url, not base64)
```

---

## Multi-Session Fix Explanation

**Changed from:**
```kotlin
MediaItem.DrmConfiguration.Builder(C.CLEARKEY_UUID)
    .setMultiSession(false)  // Only one key session
    .build()
```

**To:**
```kotlin
MediaItem.DrmConfiguration.Builder(C.CLEARKEY_UUID)
    .setMultiSession(true)   // Allows multiple key sessions
    .setForceDefaultLicenseUri(false)  // ClearKey doesn't need URI
    .build()
```

**Why**: DASH manifests often have multiple segments encrypted with the same or different keys. Multi-session allows ExoPlayer to properly manage key lifecycle and reuse without crashes.

---

## Testing Steps

### Test 1: Verify Keys Are Present
Add this before playback starts:
```kotlin
val session = StreamSession(...)
Log.d("DEBUG", "Keys in session: ${session.drmData.keys?.size}")
session.drmData.keys?.forEach { key ->
    Log.d("DEBUG", "kid=${key.kid}, k=${key.k}")
}
```

### Test 2: Enable Verbose Logging
In ExoPlayerEngine, change one line temporarily:
```kotlin
Log.v(TAG, "✅ ClearKey JSON payload created successfully")
// This will now show the full JSON (already includes Log.v call)
```

### Test 3: Test with Known Good Stream
Find a DASH + ClearKey test stream and verify it plays. If it works, the issue is with your specific stream's keys or server configuration.

---

## When to Check StreamProbe

If the manifest parsing fails BEFORE DRM issues:

**File**: [StreamProbe.kt](android/app/src/main/kotlin/com/eamax/player/StreamProbe.kt#L215)

The probe may detect:
1. ✅ `EXO_DASH` - Proper manifest detected
2. ✅ `EXO_SNIFF` - Not a manifest, let ExoPlayer figure it out
3. ✅ `WEB_VIEW_PAGE` - HTML/login page detected (fallback to WebView)

Check logs:
```bash
adb logcat | grep "StreamProbe.*probe"
```

---

## Summary of Changes

| File | Change | Why |
|------|--------|-----|
| [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt) | Added validation to ClearKey JSON | Catch malformed keys early |
| [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt) | Changed multiSession from false → true | Support multiple key segments |
| [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt) | Enhanced MIME type for SNIFFING | Auto-detect DASH/HLS from URL |
| [ExoPlayerEngine.kt](android/app/src/main/kotlin/com/eamax/player/ExoPlayerEngine.kt) | Better error logging | Identify exact failure point |

---

## Next Steps

1. **Rebuild and test**: `flutter run`
2. **Monitor logs**: Watch for the new error messages
3. **Fix issues**: Use the table above to address specific problems
4. **Test with multiple streams**: Ensure fix is general, not stream-specific

Good luck! 🚀
