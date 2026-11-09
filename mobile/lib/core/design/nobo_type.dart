import 'package:flutter/material.dart';

/// Typographic system.
///
/// Inter is shipped as a single variable font, so weight is applied through
/// [FontVariation] rather than through synthetic bolding. Letter spacing is
/// negative throughout, matching the Nobogent web product (`-0.011em` body,
/// `-0.022em` display) — Inter at default tracking looks loose and cheap.
abstract final class NoboType {
  const NoboType._();

  static const String family = 'Inter';

  /// Builds an Inter style at an exact variable weight and optical size.
  static TextStyle _inter({
    required double size,
    required double lineHeight,
    required int weight,
    double tracking = 0,
  }) {
    return TextStyle(
      fontFamily: family,
      fontSize: size,
      height: lineHeight / size,
      letterSpacing: tracking,
      fontWeight: FontWeight.values[_weightIndex(weight)],
      fontVariations: <FontVariation>[
        FontVariation('wght', weight.toDouble()),
        FontVariation('opsz', size.clamp(14, 32).toDouble()),
      ],
    );
  }

  /// FontWeight.lerp-free mapping: closest canonical weight bucket.
  static int _weightIndex(int w) {
    const List<int> buckets = <int>[100, 200, 300, 400, 500, 600, 700, 800, 900];
    int best = 3;
    int bestDelta = 1 << 30;
    for (int i = 0; i < buckets.length; i++) {
      final int d = (buckets[i] - w).abs();
      if (d < bestDelta) {
        bestDelta = d;
        best = i;
      }
    }
    return best;
  }

  // ---- Ramp -------------------------------------------------------------

  /// 34/40 — used once per screen at most, for the single most important line.
  static final TextStyle display = _inter(
    size: 34,
    lineHeight: 40,
    weight: 700,
    tracking: -0.75,
  );

  /// 26/32 — screen titles.
  static final TextStyle title = _inter(
    size: 26,
    lineHeight: 32,
    weight: 700,
    tracking: -0.57,
  );

  /// 21/27 — section heads, sheet titles.
  static final TextStyle headline = _inter(
    size: 21,
    lineHeight: 27,
    weight: 600,
    tracking: -0.42,
  );

  /// 17/24 — card titles, list primary text.
  static final TextStyle subtitle = _inter(
    size: 17,
    lineHeight: 24,
    weight: 600,
    tracking: -0.3,
  );

  /// 15/22 — reading text.
  static final TextStyle body = _inter(
    size: 15,
    lineHeight: 22,
    weight: 400,
    tracking: -0.165,
  );

  /// 15/22 emphasised.
  static final TextStyle bodyStrong = _inter(
    size: 15,
    lineHeight: 22,
    weight: 600,
    tracking: -0.165,
  );

  /// 13/18 — buttons, dense rows.
  static final TextStyle label = _inter(
    size: 13,
    lineHeight: 18,
    weight: 600,
    tracking: -0.13,
  );

  /// 12/16 — metadata, timestamps.
  static final TextStyle caption = _inter(
    size: 12,
    lineHeight: 16,
    weight: 400,
    tracking: -0.08,
  );

  /// 11/14 — uppercase section eyebrows. Tracked *out*, not in.
  static final TextStyle micro = _inter(
    size: 11,
    lineHeight: 14,
    weight: 600,
    tracking: 0.9,
  );

  /// Tabular figures for credits, counts and metrics, so digits do not jitter.
  static TextStyle numeric(TextStyle base) => base.copyWith(
    fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
  );

  /// Material [TextTheme] bridged from the ramp, so any framework-supplied
  /// text (dialogs, snackbars, tooltips) inherits Nobogent type instead of
  /// falling back to Roboto/SF.
  static TextTheme textTheme(Color ink, Color inkSecondary) {
    return TextTheme(
      displayLarge: display.copyWith(color: ink),
      displayMedium: title.copyWith(color: ink),
      displaySmall: headline.copyWith(color: ink),
      headlineLarge: title.copyWith(color: ink),
      headlineMedium: headline.copyWith(color: ink),
      headlineSmall: subtitle.copyWith(color: ink),
      titleLarge: subtitle.copyWith(color: ink),
      titleMedium: bodyStrong.copyWith(color: ink),
      titleSmall: label.copyWith(color: ink),
      bodyLarge: body.copyWith(color: ink),
      bodyMedium: body.copyWith(color: ink),
      bodySmall: caption.copyWith(color: inkSecondary),
      labelLarge: label.copyWith(color: ink),
      labelMedium: caption.copyWith(color: ink),
      labelSmall: micro.copyWith(color: inkSecondary),
    );
  }
}
