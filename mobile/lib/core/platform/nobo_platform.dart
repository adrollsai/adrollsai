import 'package:flutter/foundation.dart';

/// The two experiences this app ships. One codebase, two genuinely native
/// interfaces — platform conventions take priority over visual uniformity.
enum NoboPlatformKind {
  /// Material 3 / Material 3 Expressive.
  android,

  /// Apple Human Interface Guidelines / Cupertino.
  ios,
}

/// Resolves the runtime platform that drives all adaptive UI decisions.
///
/// Widget and golden tests set [debugDefaultTargetPlatformOverride] to exercise
/// the opposite platform without a second device — which is how the iOS
/// experience is verified on a Windows host.
abstract final class NoboPlatform {
  const NoboPlatform._();

  static NoboPlatformKind get kind {
    switch (defaultTargetPlatform) {
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
        return NoboPlatformKind.ios;
      case TargetPlatform.android:
      case TargetPlatform.fuchsia:
      case TargetPlatform.linux:
      case TargetPlatform.windows:
        return NoboPlatformKind.android;
    }
  }

  static bool get isIOS => kind == NoboPlatformKind.ios;
  static bool get isAndroid => kind == NoboPlatformKind.android;

  /// Switches between the two experiences.
  ///
  /// Used by tests to exercise the opposite platform, and by `main.dart` for the
  /// debug-only QA switch that renders the iOS interface on a non-Apple device
  /// so it can be screenshot-verified without macOS. Release builds ignore it.
  static void debugSet(NoboPlatformKind kind) {
    debugDefaultTargetPlatformOverride = kind == NoboPlatformKind.ios
        ? TargetPlatform.iOS
        : TargetPlatform.android;
  }

  static void debugReset() => debugDefaultTargetPlatformOverride = null;
}
