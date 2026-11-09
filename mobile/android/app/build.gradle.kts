plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    // The application id deliberately reuses `com.nobogent.app` — the identifier
    // already used by the shipping Capacitor shell (see capacitor.config.ts).
    // A Play Store listing's application id is permanent, so this native build
    // must keep it to be published as an update to the existing listing rather
    // than as a brand-new app.
    namespace = "com.nobogent.app"

    // permission_handler_android compiles against API 37, so this project must
    // too. Compiling against a higher SDK is backward compatible.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.nobogent.app"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // Deep links: `nobogent://auth-callback` completes Supabase OAuth and
        // password recovery on both platforms with one scheme.
        manifestPlaceholders["appAuthRedirectScheme"] = "nobogent"
    }

    buildTypes {
        release {
            // Release signing is intentionally NOT configured here. Supply a
            // keystore via android/key.properties (gitignored) — see
            // docs/BUILD_ANDROID.md. Falling back to debug keys keeps
            // `flutter build apk --release` working for local verification, but
            // a debug-signed build will not be accepted by the Play Store.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    // Media is streamed from R2 and never bundled, so trim packaging noise.
    packaging {
        resources {
            excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*")
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
