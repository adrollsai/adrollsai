import 'package:flutter/material.dart';

/// Spacing, shape, elevation and motion constants.
///
/// Spacing is a strict 4pt grid — every value below is a multiple of 4, and
/// layout code should only ever use these constants. Ad-hoc values are what
/// make generated interfaces look unconsidered.
abstract final class NoboSpace {
  const NoboSpace._();

  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double base = 16;
  static const double lg = 20;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 40;
  static const double huge = 48;
  static const double giant = 64;

  /// Horizontal page gutter. 20 is the sweet spot on phones: wide enough to
  /// feel airy, tight enough that a 360dp device still fits real content.
  static const double gutter = 20;

  /// Gap between unrelated content groups (2x the related gap, per rhythm rule).
  static const double sectionGap = 32;

  /// Minimum interactive target, per both Apple HIG (44pt) and Material (48dp).
  static const double minTapTarget = 48;
}

/// Corner radii.
///
/// Deliberately restrained: the brief calls out over-rounded cards as a
/// failure mode. Large radii are reserved for sheets and hero media only.
abstract final class NoboRadius {
  const NoboRadius._();

  static const double xs = 6;
  static const double sm = 10;
  static const double md = 14;
  static const double lg = 18;
  static const double xl = 22;

  /// Sheets and full-bleed media.
  static const double sheet = 28;

  static const double pill = 999;

  static const BorderRadius rXs = BorderRadius.all(Radius.circular(xs));
  static const BorderRadius rSm = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius rMd = BorderRadius.all(Radius.circular(md));
  static const BorderRadius rLg = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius rXl = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius rPill = BorderRadius.all(Radius.circular(pill));

  static const BorderRadius rSheetTop = BorderRadius.vertical(
    top: Radius.circular(sheet),
  );
}

/// Motion.
///
/// Durations are short on purpose. Snappy reads as "native"; long easing reads
/// as "web app". Every animation in the app must resolve through these.
abstract final class NoboMotion {
  const NoboMotion._();

  static const Duration instant = Duration(milliseconds: 90);
  static const Duration fast = Duration(milliseconds: 140);
  static const Duration base = Duration(milliseconds: 200);
  static const Duration medium = Duration(milliseconds: 280);
  static const Duration slow = Duration(milliseconds: 400);
  static const Duration hero = Duration(milliseconds: 560);

  /// Standard: fast out, gentle settle. Matches Material 3 emphasized-decelerate
  /// closely enough to feel native on Android and calm on iOS.
  static const Curve standard = Cubic(0.2, 0.0, 0.0, 1.0);

  /// Entering content.
  static const Curve decelerate = Cubic(0.05, 0.7, 0.1, 1.0);

  /// Leaving content.
  static const Curve accelerate = Cubic(0.3, 0.0, 0.8, 0.15);

  /// Playful settle for confirmations and haptic-adjacent beats.
  static const Curve emphasized = Cubic(0.21, 1.02, 0.35, 1.0);

  /// iOS-style ease for Cupertino transitions.
  static const Curve ios = Curves.easeOutCubic;
}

/// Elevation.
///
/// Shadows are tinted with the brand violet-black rather than neutral grey —
/// a pure grey shadow over a violet-tinted canvas reads as dirty.
abstract final class NoboElevation {
  const NoboElevation._();

  static const List<BoxShadow> none = <BoxShadow>[];

  /// Resting cards. Barely visible; defines an edge, not a "floating card".
  static const List<BoxShadow> low = <BoxShadow>[
    BoxShadow(
      color: Color(0x0D160C33),
      blurRadius: 12,
      offset: Offset(0, 2),
    ),
  ];

  /// Sticky headers, floating action surfaces.
  static const List<BoxShadow> medium = <BoxShadow>[
    BoxShadow(
      color: Color(0x14160C33),
      blurRadius: 24,
      offset: Offset(0, 6),
    ),
  ];

  /// Bottom sheets, dialogs, navigation bars.
  static const List<BoxShadow> high = <BoxShadow>[
    BoxShadow(
      color: Color(0x1F160C33),
      blurRadius: 40,
      offset: Offset(0, 12),
    ),
  ];

  /// Brand-tinted glow beneath primary actions. Used sparingly.
  static List<BoxShadow> glow(Color color) => <BoxShadow>[
    BoxShadow(
      color: color.withValues(alpha: 0.28),
      blurRadius: 24,
      offset: const Offset(0, 8),
    ),
  ];
}

/// Border helpers — hairlines are the primary separator in this design, not
/// shadows. 1 physical pixel wide regardless of density.
abstract final class NoboBorder {
  const NoboBorder._();

  static Border all(Color color, {double width = 1}) =>
      Border.all(color: color, width: width);

  static Border bottom(Color color, {double width = 1}) =>
      Border(bottom: BorderSide(color: color, width: width));
}
