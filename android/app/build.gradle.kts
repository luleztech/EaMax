import java.util.Properties

plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}

// Release signing files live next to this module (copied from legacy RN `EaMax/android/app/`).
val keystorePropertiesFile = file("keystore.properties")
val releaseKeystoreFile = file("eamax-release.keystore")

fun loadReleaseSigningReady(): Boolean {
    if (!keystorePropertiesFile.exists() || !releaseKeystoreFile.exists()) return false
    val p = Properties()
    keystorePropertiesFile.inputStream().use { p.load(it) }
    val alias = (p.getProperty("keyAlias") ?: "").trim()
    val sp = (p.getProperty("storePassword") ?: "").trim()
    val kp = (p.getProperty("keyPassword") ?: "").trim()
    return alias.isNotEmpty() &&
        alias != "your_key_alias" &&
        !sp.contains("your_") &&
        !kp.contains("your_")
}

android {
    namespace = "com.eamax"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.eamax"
        // Match Flutter’s minSdk (usually 21). A hard floor of 24 removed many devices on Play; FCM/ads work on 21+.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    val releaseSigningReady = loadReleaseSigningReady()

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                val p = Properties()
                keystorePropertiesFile.inputStream().use { p.load(it) }
                keyAlias = p.getProperty("keyAlias")!!.trim()
                keyPassword = p.getProperty("keyPassword")!!.trim()
                storePassword = p.getProperty("storePassword")!!.trim()
                storeFile = releaseKeystoreFile
            }
        }
    }

    buildTypes {
        release {
            signingConfig =
                if (releaseSigningReady) {
                    signingConfigs.getByName("release")
                } else {
                    signingConfigs.getByName("debug")
                }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    implementation("androidx.core:core-ktx:1.15.0")
    val media3 = "1.4.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-dash:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-exoplayer-smoothstreaming:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
}
