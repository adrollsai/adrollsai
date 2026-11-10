import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config/nobo_env.dart';
import '../core/design/nobo_theme.dart';
import '../core/platform/nobo_platform.dart';
import '../core/providers.dart';
import '../core/ui/boot_splash.dart';
import '../data/local/session_repository.dart';
import 'app.dart';

/// The very first widget, and the owner of the cold start.
///
/// It paints the animated splash on the first frame and *then* initialises the
/// data layer, rather than initialising first and painting afterwards. That
/// reordering is the whole point: `Supabase.initialize`, the shared preferences
/// read and the app-support lookup are all async, so awaiting them before
/// `runApp` left the OS launch screen — a static image — holding the screen for
/// as long as they took. Now the brand motion starts immediately and simply
/// keeps going until the app can serve its first query.
///
/// The splash is shared rather than restarted: this widget owns one clock and
/// hands it to [NoboApp], so the hand-off from "still booting" to "app running,
/// splash fading" is a single uninterrupted animation.
class NoboRoot extends ConsumerStatefulWidget {
  const NoboRoot({super.key});

  @override
  ConsumerState<NoboRoot> createState() => _NoboRootState();
}

class _NoboRootState extends ConsumerState<NoboRoot>
    with SingleTickerProviderStateMixin {
  /// One full dissolve-and-rebuild pass. Both ends are the finished lockup, so
  /// repeating this is seamless.
  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: NoboSplashTiming.loopMs),
  );

  /// A cold start always gets to see the animation once. Without a floor, a
  /// warm start would flash the splash for a couple of frames, which reads as a
  /// glitch rather than as branding. At 1.7 s the owner sees a full
  /// dissolve-and-rebuild cycle plus the start of the next, which reads as
  /// deliberate rather than brief.
  static const Duration _minOnScreen = Duration(milliseconds: 1700);

  /// Nothing about a cold start should be able to trap the owner behind a
  /// logo, so the splash gives up waiting and shows the app regardless.
  static const Duration _giveUp = Duration(seconds: 12);

  @override
  void initState() {
    super.initState();
    _clock.repeat();
    unawaited(_start());
  }

  Future<void> _start() async {
    final Future<void> floor = Future<void>.delayed(_minOnScreen);

    final Future<void> init = _initialise();
    // Whichever settles first: the work, or the safety valve.
    await Future.any(<Future<void>>[init, Future<void>.delayed(_giveUp)]);
    // Never lift before the animation has been seen once.
    await floor;

    if (mounted) ref.read(noboBootPhaseProvider.notifier).markReady();

    // The gateway fades out on its own clock from here; the intro loop has no
    // audience left, so stop paying for it.
    Timer(const Duration(milliseconds: 700), () {
      if (mounted) _clock.stop();
    });
  }

  /// Everything that must be true before the first query can run.
  ///
  /// Nothing here is awaited by the splash — it is awaited by the *splash's
  /// dismissal*, which is why it must stay off the first frame. In particular
  /// edge-to-edge is set by `main()` without blocking: awaiting a system-chrome
  /// round trip here measurably delayed the whole boot for a purely cosmetic
  /// result.
  Future<void> _initialise() async {
    // Resolve the app-support directory once, up front: the session store reads
    // and writes synchronously, so it needs the path before the first query.
    try {
      await primeAppSupportDirectory();
    } catch (e) {
      debugPrint('Could not resolve app support directory: $e');
    }

    // QA affordance: render the iOS experience on a non-Apple device so it can
    // be screenshot-verified without macOS. Debug-only by construction.
    if (kDebugMode && NoboEnv.forceIosExperience) {
      NoboPlatform.debugSet(NoboPlatformKind.ios);
    }

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final ThemeMode mode = switch (prefs.getString('nobo.themeMode')) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };
      // The app is already painting by now, so the stored appearance is applied
      // as a change rather than as a construction argument.
      if (mounted) ref.read(themeModeProvider.notifier).set(mode);
    } catch (e) {
      debugPrint('Could not read preferences: $e');
    }

    if (NoboEnv.isConfigured && !NoboEnv.demoMode) {
      try {
        await Supabase.initialize(
          url: NoboEnv.supabaseUrl,
          publishableKey: NoboEnv.supabaseAnonKey,
          authOptions: const FlutterAuthClientOptions(autoRefreshToken: true),
        );
      } catch (e) {
        // Misconfiguration must not brick the app: fall through to demo data.
        debugPrint('Supabase init failed, continuing without it: $e');
      }
    }
  }

  /// Writes the appearance choice so the next launch opens the way it was left.
  Future<void> _persistTheme(ThemeMode mode) async {
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      await prefs.setString('nobo.themeMode', mode.name);
    } catch (e) {
      debugPrint('Could not persist appearance: $e');
    }
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Persists every appearance change, including the one restored from disk
    // above, so the setting survives a launch.
    ref.listen<ThemeMode>(themeModeProvider, (ThemeMode? prev, ThemeMode next) {
      unawaited(_persistTheme(next));
    });

    final NoboBootPhase phase = ref.watch(noboBootPhaseProvider);

    if (phase == NoboBootPhase.starting) {
      // No router yet: GoRouter and the repositories read Supabase, which may
      // still be starting. This is a whole MaterialApp of its own so the splash
      // has the text, alignment and media query it needs.
      return MaterialApp(
        title: 'Nobogent',
        debugShowCheckedModeBanner: false,
        theme: NoboTheme.material(brightness: Brightness.light),
        home: AnimatedBuilder(
          animation: _clock,
          builder: (BuildContext context, Widget? _) => NoboBootSplash(
            t: _clock.value * NoboSplashTiming.loop,
            background: NoboSplashBrand.plate,
            showDomain: true,
            loop: true,
          ),
        ),
      );
    }

    return NoboApp(bootAnimation: _clock);
  }
}
