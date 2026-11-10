import 'package:flutter/cupertino.dart' show CupertinoTheme;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/design/nobo_colors.dart';
import '../core/design/nobo_theme.dart';
import '../core/platform/nobo_platform.dart';
import '../core/providers.dart';
import '../core/ui/boot_splash.dart';
import 'router.dart';

/// Root widget.
///
/// One token set, two themes, two navigation bars. Everything below this point
/// decides its own layout per platform, but never its own colours.
class NoboApp extends ConsumerWidget {
  const NoboApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeMode mode = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'Nobogent',
      debugShowCheckedModeBanner: false,
      routerConfig: ref.watch(routerProvider),
      themeMode: mode,
      theme: NoboTheme.material(brightness: Brightness.light),
      darkTheme: NoboTheme.material(brightness: Brightness.dark),
      builder: (BuildContext context, Widget? child) {
        final ThemeData theme = Theme.of(context);
        final Brightness brightness = theme.brightness;
        final NoboColors c = theme.extension<NoboColors>() ?? NoboColors.light;

        // Clamp Dynamic Type to a range the dense screens can honour without
        // clipping. Past ~1.5x, tabular data and media grids stop being usable
        // long before they stop being readable.
        final MediaQueryData mq = MediaQuery.of(context);
        final double scale = mq.textScaler.scale(1).clamp(1.0, 1.5);

        final SystemUiOverlayStyle overlay = SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: brightness == Brightness.dark
              ? Brightness.light
              : Brightness.dark,
          statusBarBrightness: brightness == Brightness.dark
              ? Brightness.dark
              : Brightness.light,
          systemNavigationBarColor: NoboPlatform.isAndroid
              ? c.surface
              : Colors.transparent,
          systemNavigationBarIconBrightness: brightness == Brightness.dark
              ? Brightness.light
              : Brightness.dark,
          systemNavigationBarDividerColor: Colors.transparent,
        );

        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: overlay,
          child: CupertinoTheme(
            data: NoboTheme.cupertino(brightness: brightness),
            child: MediaQuery.withClampedTextScaling(
              minScaleFactor: 1.0,
              maxScaleFactor: scale,
              // The animated splash sits above the router, so the first screen
              // builds and warms up underneath it and is ready when it lifts.
              // MaterialApp.builder is outside the Navigator and therefore
              // outside every Scaffold, so text here needs its own Material
              // ancestor or Flutter paints its debug overflow bar under it.
              child: Material(
                type: MaterialType.transparency,
                child: NoboBootGate(
                  child: child ?? const SizedBox.shrink(),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
