import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/core/design/nobo_colors.dart';
import 'package:nobogent_mobile/core/design/nobo_theme.dart';
import 'package:nobogent_mobile/core/platform/nobo_platform.dart';

void main() {
  group('design tokens', () {
    test('light and dark palettes are distinct and complete', () {
      expect(NoboColors.light.canvas, isNot(NoboColors.dark.canvas));
      expect(NoboColors.light.ink, isNot(NoboColors.dark.ink));
      expect(NoboColors.light.primary, isNotNull);
      expect(NoboColors.dark.primary, isNotNull);
    });

    test('theme carries the NoboColors extension for both brightnesses', () {
      expect(
        NoboTheme.material(
          brightness: Brightness.light,
        ).extension<NoboColors>(),
        isNotNull,
      );
      expect(
        NoboTheme.material(
          brightness: Brightness.dark,
        ).extension<NoboColors>(),
        isNotNull,
      );
    });

    test('Material and Cupertino themes share the same brand colour', () {
      final ThemeData t = NoboTheme.material(brightness: Brightness.light);
      final NoboColors c = t.extension<NoboColors>()!;
      expect(t.colorScheme.primary, c.primary);
      expect(
        NoboTheme.cupertino(brightness: Brightness.light).primaryColor,
        c.primary,
      );
    });
  });

  group('platform resolution', () {
    tearDown(NoboPlatform.debugReset);

    test('resolves iOS for Apple platforms', () {
      NoboPlatform.debugSet(NoboPlatformKind.ios);
      expect(NoboPlatform.isIOS, isTrue);
      expect(NoboPlatform.isAndroid, isFalse);
    });

    test('resolves Android for non-Apple platforms', () {
      NoboPlatform.debugSet(NoboPlatformKind.android);
      expect(NoboPlatform.isAndroid, isTrue);
      expect(NoboPlatform.isIOS, isFalse);
    });
  });
}
