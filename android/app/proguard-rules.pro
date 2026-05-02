# EaMax custom native player (Kotlin) — must not be shrunk/obfuscated in release.
-keepnames class com.eamax.** { *; }
-keep class com.eamax.** { *; }

# Media3 / ExoPlayer uses reflection internally.
-keep class androidx.media3.** { *; }
-keep interface androidx.media3.** { *; }
-dontwarn androidx.media3.**

# WebView JavaScript bridge: method names are invoked from JS; keep them.
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.eamax.player.WebViewJsInterface { *; }

# Kotlin metadata (helps reflection-heavy libs)
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
