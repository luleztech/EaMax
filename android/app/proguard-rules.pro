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

# WorkManager + Room (flutter_local_notifications / FCM background work).
# Without these, release R8 strips WorkDatabase_Impl → instant crash on launch.
-keep class * extends androidx.work.Worker
-keep class * extends androidx.work.ListenableWorker
-keep class * extends androidx.work.InputMerger
-keep class androidx.work.** { *; }
-keep class androidx.work.impl.** { *; }
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-keepclassmembers class * {
    @androidx.room.* <methods>;
}
-dontwarn androidx.work.**
-dontwarn androidx.room.**

# Flutter local notifications plugin.
-keep class com.dexterous.** { *; }
