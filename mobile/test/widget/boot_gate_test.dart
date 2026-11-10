import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/core/ui/boot_splash.dart';
import 'package:nobogent_mobile/core/ui/nobo_mark_loader.dart';

import '../helpers/pump_app.dart';

/// Owns a repeating clock the way [NoboRoot] does, so the gate is exercised with
/// exactly the kind of animation it gets in production: one that loops.
class _LoopingHarness extends StatefulWidget {
  const _LoopingHarness({required this.ready});

  final bool ready;

  @override
  State<_LoopingHarness> createState() => _LoopingHarnessState();
}

class _LoopingHarnessState extends State<_LoopingHarness>
    with SingleTickerProviderStateMixin {
  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: NoboSplashTiming.loopMs),
  )..repeat();

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MediaQuery(
      data: const MediaQueryData(size: Size(393, 852)),
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Material(
          type: MaterialType.transparency,
          child: NoboBootGate(
            animation: _clock,
            ready: widget.ready,
            child: const Text('the app'),
          ),
        ),
      ),
    );
  }
}

void main() {
  group('boot gate', () {
    noboTestWidgets('keeps looping while the app is still starting', (
      WidgetTester tester,
    ) async {
      // A cold start on a slow phone can take seconds. The old gate played once
      // and then sat on a still frame; the splash must instead keep running
      // until it is told the app is ready.
      await tester.pumpWidget(const _LoopingHarness(ready: false));
      await tester.pump();

      for (int i = 0; i < 12; i++) {
        expect(
          find.byType(NoboBootSplash),
          findsOneWidget,
          reason: 'the splash lifted before the app was ready',
        );
        await tester.pump(const Duration(milliseconds: 500));
      }

      // Six seconds is roughly four cycles. The app is mounted underneath the
      // whole time — that is how it warms up — but it stays covered.
      expect(find.byType(NoboBootSplash), findsOneWidget);
    });

    noboTestWidgets('lifts once the app reports it is ready', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(const _LoopingHarness(ready: true));
      await tester.pump();
      expect(find.byType(NoboBootSplash), findsOneWidget);

      // The fade-out is what the owner actually sees; it has to finish.
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.byType(NoboBootSplash), findsNothing);
      expect(find.text('the app'), findsOneWidget);
    });
  });

  group('mark loader', () {
    noboTestWidgets('draws the mark instead of a platform spinner', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: Center(child: NoboMarkLoader(size: 40))),
        ),
      );
      await tester.pump();

      expect(find.byType(NoboMarkLoader), findsOneWidget);
      expect(find.byType(CustomPaint), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    noboTestWidgets('renders at every size the app asks for', (
      WidgetTester tester,
    ) async {
      // 12 px (tool rows) through 40 px (full-panel) — none may overflow or
      // throw, because these sit inside tight rows and buttons.
      for (final double size in <double>[12, 15, 17, 26, 40]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Center(child: NoboMarkLoader(size: size)),
            ),
          ),
        );
        await tester.pump();
        expectNoLayoutError(tester);
        expect(find.byType(NoboMarkLoader), findsOneWidget);
      }
    });

    noboTestWidgets('captions itself for the reader', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: NoboMarkLoading(label: 'Loading leads…')),
        ),
      );
      await tester.pump();

      expect(find.text('Loading leads…'), findsOneWidget);
      // The mark is decorative to a screen reader; the label carries the state.
      final Semantics semantics = tester.widget<Semantics>(
        find
            .descendant(
              of: find.byType(NoboMarkLoader),
              matching: find.byType(Semantics),
            )
            .first,
      );
      expect(semantics.properties.label, 'Loading leads…');
    });
  });
}
