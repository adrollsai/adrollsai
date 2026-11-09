import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app/app.dart';
import 'core/config/nobo_env.dart';
import 'core/platform/nobo_platform.dart';
import 'core/providers.dart';
import 'data/local/session_repository.dart';

/// Entry point.
///
/// Startup order matters: bindings, system chrome, persisted preferences,
/// backend, then the widget tree. The first frame never waits on the network, so
/// the UI is on screen while Supabase restores a session.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Errors must be visible in development and survivable in release — never
  // crash to a white screen in a business owner's hands.
  FlutterError.onError = (FlutterErrorDetails details) {
    if (kDebugMode) FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    if (kDebugMode) debugPrint('Uncaught: $error\n$stack');
    return true;
  };

  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  // Resolve the app-support directory once, up front: the session store reads and
  // writes synchronously, so it needs the path before the first frame.
  try {
    await primeAppSupportDirectory();
  } catch (e) {
    debugPrint('Could not resolve app support directory: $e');
  }

  // QA affordance: render the iOS experience on a non-Apple device so it can be
  // screenshot-verified without macOS. Debug-only by construction.
  if (kDebugMode && NoboEnv.forceIosExperience) {
    NoboPlatform.debugSet(NoboPlatformKind.ios);
  }

  final SharedPreferences prefs = await SharedPreferences.getInstance();
  final ThemeMode initialMode = switch (prefs.getString('nobo.themeMode')) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };

  if (NoboEnv.isConfigured && !NoboEnv.demoMode) {
    try {
      await Supabase.initialize(
        url: NoboEnv.supabaseUrl,
        publishableKey: NoboEnv.supabaseAnonKey,
        authOptions: const FlutterAuthClientOptions(autoRefreshToken: true),
      );    } catch (e) {
      // Misconfiguration must not brick the app: fall through to demo data.
      debugPrint('Supabase init failed, continuing without it: $e');
    }
  }

  runApp(
    ProviderScope(
      overrides: [
        themeModeProvider.overrideWith(
          () => ThemeModeController(initial: initialMode),
        ),
      ],
      child: const NoboBootstrap(),
    ),
  );
}

/// Persists the appearance choice whenever it changes, and otherwise just hosts
/// the app.
class NoboBootstrap extends ConsumerWidget {
  const NoboBootstrap({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<ThemeMode>(themeModeProvider, (ThemeMode? prev, ThemeMode next) {
      unawaited(() async {
        final SharedPreferences prefs = await SharedPreferences.getInstance();
        await prefs.setString('nobo.themeMode', next.name);
      }());
    });
    return const NoboApp();
  }
}
