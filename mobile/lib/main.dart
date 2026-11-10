import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/boot_root.dart';

/// Entry point.
///
/// Startup order matters, and it is deliberately short: bindings, an error
/// handler that cannot crash a business owner's phone, and the widget tree.
/// Nothing is awaited before `runApp`, because every millisecond spent awaiting
/// here is a millisecond the OS launch screen — a still image — is holding the
/// screen. The animated splash paints on the first frame, and [NoboRoot] does
/// the slow work (preferences, the backend, storage paths) underneath it.
void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Errors must be visible in development and survivable in release — never
  // crash to a white screen.
  FlutterError.onError = (FlutterErrorDetails details) {
    if (kDebugMode) FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    if (kDebugMode) debugPrint('Uncaught: $error\n$stack');
    return true;
  };

  // Edge-to-edge is part of the launch frame: setting it after the first frame
  // would make the splash jump when the bars fade in.
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  runApp(const ProviderScope(child: NoboRoot()));
}
