# Keep the release build from stripping classes Flutter or the plugins need
# reflectively. These are the standard rules for a Flutter release build.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-dontwarn io.flutter.embedding.**

# video_player / ExoPlayer
-dontwarn com.google.android.exoplayer2.**
-keep class com.google.android.exoplayer2.** { *; }

# Keep annotations used by AndroidX
-keepattributes *Annotation*
-keepattributes Signature
