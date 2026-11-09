# Android build guide

## Identity

| Field | Value | Why |
|---|---|---|
| `applicationId` | `com.nobogent.app` | Reuses the identifier of the shipping Capacitor shell. A Play Store application id is **permanent**, so keeping it lets this native build publish as an update to the existing listing instead of as a new app with zero installs |
| `namespace` | `com.nobogent.app` | Must match `MainActivity`'s Kotlin package |
| App label | `Nobogent` | |
| `versionName` / `versionCode` | `2.0.0` / `4` | Continues the shell's `1.0.2` / `3` |
| `minSdk` | Flutter default (24) | Matches the existing shell |
| `compileSdk` | **37** | `permission_handler_android` requires 37 |
| `targetSdk` | Flutter default (36) | |

---

## Verified on this machine

```bash
flutter analyze                         # 0 issues
flutter test                            # all suites pass
flutter build apk --debug               # succeeds
adb install -r -t build/app/outputs/flutter-apk/app-debug.apk
adb shell am start -n com.nobogent.app/com.nobogent.app.MainActivity
```

Emulator: AVD `Medium_Phone`, API 37, x86_64, 1080×2400 @ 420dpi (411×914 dp),
hardware accelerated via WHPX.

---

## Environment required

| Variable | Value used |
|---|---|
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | `%LOCALAPPDATA%\Android\Sdk` |
| `JAVA_HOME` | Android Studio JBR (JDK 25) |
| `PUB_CACHE` | outside the project (disk-space constraint on the build machine) |
| `GRADLE_USER_HOME` | outside the project — Gradle caches reach ~1.5 GB |

---

## Memory configuration — read this before changing it

`android/gradle.properties` is deliberately sized for a **modest** machine:

```properties
org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m -XX:ReservedCodeCacheSize=192m
kotlin.daemon.jvmargs=-Xmx768m
kotlin.compiler.execution.strategy=in-process
org.gradle.parallel=false
org.gradle.workers.max=1
kotlin.incremental=false
```

The Flutter template ships `-Xmx8G`. On the 7.7 GB machine this was developed on,
that crashed the Gradle daemon with a native `insufficient memory` OOM as soon as
an emulator was also running. `kotlin.incremental=false` exists because the Kotlin
incremental cache was corrupted by that crash.

On a machine with 16 GB or more you can restore the defaults; builds will be
noticeably faster. **Do not run the emulator and the build simultaneously on a
low-memory machine** — quit the emulator, build, then restart it.

---

## Permissions

Declared: `INTERNET`, `ACCESS_NETWORK_STATE`. Nothing else.

The app requests **no runtime permission**, because nothing it currently does
needs one — media is streamed over HTTPS, not captured. When camera, microphone or
photo-library support ships, add the permission **and** an in-app rationale at the
same time; see `docs/LIMITATIONS.md` for the specific features that were deferred.

Also present in the manifest:
- `android:enableOnBackInvokedCallback="true"` — predictive back. Paired with
  `PredictiveBackPageTransitionsBuilder` in the theme.
- A `nobogent://auth-callback` intent filter for Supabase OAuth / recovery.
- `<queries>` for `tel:` and `https:` so `url_launcher` can resolve the dialer and
  WhatsApp.

---

## App icon and launch screen

Generated, not hand-exported:

```bash
pwsh -File tools/generate_icons.ps1
```

The script draws the orbital mark with the same vector geometry the app renders at
runtime (`lib/core/ui/orbit_mark.dart`), so the launcher icon and the in-app mark
cannot drift apart. It writes:

- `mipmap-*/ic_launcher.png` — legacy icons, 48 → 192 px
- `mipmap-*/ic_launcher_foreground.png` — adaptive foreground, 108 → 432 px, with
  the mark inset inside the 66 % safe zone so launcher masks cannot clip it
- `mipmap-anydpi-v26/ic_launcher.xml` — adaptive icon referencing the brand colour
- iOS `AppIcon.appiconset`, all 15 sizes

Launch screen: brand gradient with the centred mark
(`res/drawable/launch_background.xml`), plus `res/values-v31/styles.xml` using the
Android 12+ `windowSplashScreen*` API so the branded first frame survives on modern
devices.

---

## Release build

### 1. Create a keystore (once)

```bash
keytool -genkey -v -keystore nobogent-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias nobogent
```

Store it **outside** the repository, and back it up: losing it means you can never
update the app on Play again.

### 2. Point the build at it

Create `android/key.properties` (**gitignored**):

```properties
storePassword=…
keyPassword=…
keyAlias=nobogent
storeFile=/absolute/path/to/nobogent-release.jks
```

### 3. Wire the signing config

`android/app/build.gradle.kts` currently sets
`signingConfig = signingConfigs.getByName("debug")` in the release block so local
release builds work. Replace it with a real config:

```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) load(FileInputStream(f))
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
    buildTypes {
        release { signingConfig = signingConfigs.getByName("release") }
    }
}
```

### 4. Build

```bash
# App bundle for Play (preferred — Play generates per-device APKs)
flutter build appbundle --release \
  --dart-define-from-file=dart_defines.json

# Or a universal APK for direct distribution / internal testing
flutter build apk --release --split-per-abi \
  --dart-define-from-file=dart_defines.json
```

Release builds are minified (R8) with resource shrinking; keep rules live in
`android/app/proguard-rules.pro`.

### 5. Play Console checklist

- [ ] `targetSdk` ≥ the current Play requirement (36 here — verify at submission)
- [ ] AAB signed with the **upload key**, Play App Signing enrolled
- [ ] Data safety form completed (the app stores an auth token and task transcripts
      on-device; it does not sell data)
- [ ] Content rating questionnaire
- [ ] Store listing: title, short description, screenshots, 512×512 icon, 1024×500
      feature graphic
- [ ] Privacy policy URL (`https://nobogent.com/privacy-policy`)
- [ ] Because `applicationId` already exists on the listing, verify the version code
      increments above the last Capacitor release (`3` → `4`)

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Gradle build daemon disappeared unexpectedly` | JVM OOM. Quit the emulator, keep `-Xmx1536m`, retry |
| `Could not close incremental caches` | Corrupt Kotlin cache. `rm -rf build android/.gradle`, ensure `kotlin.incremental=false` |
| `ClassNotFoundException: com.nobogent.app.MainActivity` | The Kotlin package under `src/main/kotlin` must match `namespace` |
| `plugin requires compileSdk 37` | Keep `compileSdk = 37` |
