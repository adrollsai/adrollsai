import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/core/platform/nobo_platform.dart';
import 'package:nobogent_mobile/core/ui/boot_splash.dart';

import '../helpers/pump_app.dart';

/// The animated splash runs before anything else the person sees, on every
/// supported device, at every point of its timeline. A layout blow-up there is
/// uniquely bad: it happens before the app has drawn a single screen.
void main() {
  /// Instants that exercise each beat: the formed lockup on frame zero, the
  /// dissolve, the dot field rebuilding, the arc drawing, the satellite
  /// launching, the wordmark rising, and the hold before the fade.
  const List<double> beats = <double>[
    0.00,
    0.13,
    0.26,
    0.42,
    0.60,
    0.78,
    0.96,
    1.14,
    1.30,
    1.55,
    1.80,
    NoboSplashTiming.total,
  ];

  const List<Size> sizes = <Size>[
    Devices.androidCompact,
    Devices.androidStandard,
    Devices.iphoneSmall,
    Devices.iphoneLarge,
  ];

  /// The splash locks up "nobogent" plus ".com", one Text per glyph.
  const int glyphCount = 9;

  group('splash', () {
    noboTestWidgets('renders every beat on every device size', (
      WidgetTester tester,
    ) async {
      for (final Size size in sizes) {
        for (final double t in beats) {
          await pumpNobo(
            tester,
            NoboBootSplash(t: t, background: const Color(0xFFFFFFFF)),
            size: size,
            platform: NoboPlatformKind.android,
          );
          expectNoLayoutError(tester);
        }
      }
    });

    noboTestWidgets('renders in dark mode', (WidgetTester tester) async {
      for (final double t in beats) {
        await pumpNobo(
          tester,
          NoboBootSplash(t: t, background: const Color(0xFF020617)),
          brightness: Brightness.dark,
          platform: NoboPlatformKind.android,
        );
        expectNoLayoutError(tester);
      }
    });

    noboTestWidgets('survives 1.5x Dynamic Type', (WidgetTester tester) async {
      await pumpNobo(
        tester,
        const NoboBootSplash(t: 1.80, background: Color(0xFFFFFFFF)),
        size: Devices.iphoneSmall,
        platform: NoboPlatformKind.ios,
        textScale: 1.5,
      );
      expectNoLayoutError(tester);
    });

    noboTestWidgets('opens on the complete, fully visible lockup', (
      WidgetTester tester,
    ) async {
      // The native launch screen draws the whole lockup, so the animated splash
      // must open on it too: nothing may be mid-fade at t = 0, or the logo would
      // appear to vanish the instant Flutter takes over from the OS.
      await pumpNobo(
        tester,
        const NoboBootSplash(
          t: 0,
          background: Color(0xFFFFFFFF),
          showDomain: true,
        ),
        platform: NoboPlatformKind.android,
      );
      expectNoLayoutError(tester);

      final Finder splash = find.byType(NoboBootSplash);
      expect(
        find.descendant(of: splash, matching: find.byType(Text)),
        findsNWidgets(glyphCount),
      );

      final Finder glyphOpacities = find.descendant(
        of: splash,
        matching: find.byType(Opacity),
      );
      expect(glyphOpacities, findsNWidgets(glyphCount));
      for (final Opacity o in tester.widgetList<Opacity>(glyphOpacities)) {
        expect(o.opacity, 1.0, reason: 'a glyph is faded out on frame zero');
      }
    });

    noboTestWidgets('the lockup has cleared away mid-dissolve', (
      WidgetTester tester,
    ) async {
      // By the end of the dissolve window the forming mark is alone on screen;
      // this is the beat the bloom and the shockwave live in.
      const double t = NoboSplashTiming.dissolveEnd + 0.02;
      await pumpNobo(
        tester,
        const NoboBootSplash(
          t: t,
          background: Color(0xFFFFFFFF),
          showDomain: true,
        ),
        platform: NoboPlatformKind.android,
      );
      expectNoLayoutError(tester);

      final Finder glyphOpacities = find.descendant(
        of: find.byType(NoboBootSplash),
        matching: find.byType(Opacity),
      );
      for (final Opacity o in tester.widgetList<Opacity>(glyphOpacities)) {
        expect(o.opacity, lessThan(0.01));
      }
    });

    noboTestWidgets('reduce motion skips the show entirely', (
      WidgetTester tester,
    ) async {
      // Someone who has asked the OS to reduce motion must never be trapped
      // behind a 2 s animation they did not ask for.
      await tester.pumpWidget(
        const MediaQuery(
          data: MediaQueryData(
            size: Size(393, 852),
            disableAnimations: true,
          ),
          child: Directionality(
            textDirection: TextDirection.ltr,
            child: Material(
              type: MaterialType.transparency,
              child: NoboBootGate(child: Text('the app')),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('the app'), findsOneWidget);
      expect(find.byType(NoboBootSplash), findsNothing);
    });

    noboTestWidgets('the splash plays, then lifts to the app', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        const MediaQuery(
          data: MediaQueryData(size: Size(393, 852)),
          child: Directionality(
            textDirection: TextDirection.ltr,
            child: Material(
              type: MaterialType.transparency,
              child: NoboBootGate(child: Text('the app')),
            ),
          ),
        ),
      );
      await tester.pump();

      // On the first frame the splash covers the app.
      expect(find.byType(NoboBootSplash), findsOneWidget);

      // A tap skips it, which is the escape hatch the person always has.
      await tester.tap(find.byType(NoboBootSplash));
      await tester.pump();

      expect(find.text('the app'), findsOneWidget);
      expect(find.byType(NoboBootSplash), findsNothing);
    });

    noboTestWidgets('the splash lifts on its own when it finishes', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        const MediaQuery(
          data: MediaQueryData(size: Size(393, 852)),
          child: Directionality(
            textDirection: TextDirection.ltr,
            child: Material(
              type: MaterialType.transparency,
              child: NoboBootGate(child: Text('the app')),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(NoboBootSplash), findsOneWidget);

      for (int i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }

      expect(find.byType(NoboBootSplash), findsNothing);
      expect(find.text('the app'), findsOneWidget);
    });
  });
}
