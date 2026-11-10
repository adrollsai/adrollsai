import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/core/design/nobo_theme.dart';
import 'package:nobogent_mobile/core/platform/nobo_platform.dart';
import 'package:nobogent_mobile/core/providers.dart';
import 'package:nobogent_mobile/data/local/session_repository.dart';

/// Device sizes used for layout verification.
///
/// Logical pixels, matching real hardware the app will run on:
/// a compact Android phone, a standard Pixel-class device, a large Android,
/// a small iPhone (SE) and a large iPhone (Pro Max).
class Devices {
  const Devices._();

  static const Size androidCompact = Size(360, 740); // e.g. Galaxy A-series
  static const Size androidStandard = Size(412, 915); // Pixel 8
  static const Size androidLarge = Size(480, 1000); // tablets folded open
  static const Size iphoneSmall = Size(375, 667); // iPhone SE (3rd gen)
  static const Size iphoneStandard = Size(393, 852); // iPhone 15
  static const Size iphoneLarge = Size(430, 932); // iPhone 15 Pro Max

  static const List<Size> android = <Size>[
    androidCompact,
    androidStandard,
    androidLarge,
  ];

  static const List<Size> ios = <Size>[
    iphoneSmall,
    iphoneStandard,
    iphoneLarge,
  ];
}

/// Pumps [child] inside the full Nobogent provider + theme stack.
///
/// Runs against the seeded demo workspace, so no backend or credentials are
/// required. Any RenderFlex overflow thrown during layout is surfaced as a test
/// failure, which is the point: these tests are the automated half of visual QA,
/// catching clipping that a screenshot review can miss on a screen size nobody
/// tried by hand.
Future<void> pumpNobo(
  WidgetTester tester,
  Widget child, {
  Size size = Devices.androidStandard,
  Brightness brightness = Brightness.light,
  NoboPlatformKind platform = NoboPlatformKind.android,
  double textScale = 1.0,
}) async {
  NoboPlatform.debugSet(platform);

  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  // Synchronous temp dir: widget tests run in a fake-async zone where real
  // asynchronous file I/O never completes.
  final Directory tempDir = Directory.systemTemp.createTempSync('nobo-test');
  addTearDown(() {
    if (tempDir.existsSync()) tempDir.deleteSync(recursive: true);
  });
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        demoModeProvider.overrideWithValue(true),
        sessionRepositoryProvider.overrideWithValue(
          SessionRepository(overrideDirectory: tempDir),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: NoboTheme.material(
          brightness: brightness,
        ).copyWith(platform: platform == NoboPlatformKind.ios
            ? TargetPlatform.iOS
            : TargetPlatform.android),
        builder: (BuildContext context, Widget? c) {
          // Reduced motion makes every animated widget deterministic, so a fixed
          // number of pumps is enough and `pumpAndSettle` can never hang.
          final MediaQueryData base = MediaQuery.of(context);
          return MediaQuery(
            data: MediaQueryData(
              size: base.size,
              devicePixelRatio: base.devicePixelRatio,
              padding: base.padding,
              viewPadding: base.viewPadding,
              viewInsets: base.viewInsets,
              textScaler: TextScaler.linear(textScale),
              disableAnimations: true,
              platformBrightness: brightness,
            ),
            child: c ?? const SizedBox.shrink(),
          );
        },
        // Screens are pumped bare; Scaffold supplies the Material ancestor that
        // TextField and InkWell require, exactly as AppShell does at runtime.
        home: Scaffold(body: child),
      ),
    ),
  );

  // Provider futures resolve, then a couple of frames let layout settle. With
  // animations disabled this is deterministic and fast.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump();
}

/// Asserts the widget tree rendered without a layout exception.
void expectNoLayoutError(WidgetTester tester) {
  final Object? error = tester.takeException();
  expect(error, isNull, reason: 'layout threw: $error');
}

/// Wraps [testWidgets] so the platform override is reset **inside** the test body.
///
/// Flutter verifies that foundation debug variables are unset at the end of the
/// test body, which happens *before* `tearDown` runs. Resetting in `addTearDown`
/// therefore fails every test with "The value of a foundation debug variable was
/// changed by the test". Resetting in a `finally` is the correct place.
void noboTestWidgets(
  String description,
  Future<void> Function(WidgetTester tester) body,
) {
  testWidgets(description, (WidgetTester tester) async {
    try {
      await body(tester);
    } finally {
      NoboPlatform.debugReset();
    }
  });
}
