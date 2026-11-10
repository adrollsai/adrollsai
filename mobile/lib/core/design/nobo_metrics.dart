import 'package:flutter/material.dart';

/// Spacing, shape, elevation and motion — tuned to match the web app.
///
/// The PWA is a 4pt-grid design with generous padding, cards separated by a
/// hairline border rather than a shadow, and gently rounded corners (16–24).
/// Matching those values is what makes the native port read as the same product.
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

  /// The web app uses a 16px page gutter on phones.
  static const double gutter = 16;

  static const double sectionGap = 24;

  static const double minTapTarget = 48;
}

/// Corner radii. The PWA's Tailwind overrides: xl = 16, 2xl = 24, 3xl = 32.
abstract final class NoboRadius {
  const NoboRadius._();

  static const double xs = 6;
  static const double sm = 10;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double sheet = 24;
  static const double pill = 999;

  static const BorderRadius rXs = BorderRadius.all(Radius.circular(xs));
  static const BorderRadius rSm = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius rMd = BorderRadius.all(Radius.circular(md));
  static const BorderRadius rLg = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius rXl = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius rXxl = BorderRadius.all(Radius.circular(xxl));
  static const BorderRadius rPill = BorderRadius.all(Radius.circular(pill));

  static const BorderRadius rSheetTop = BorderRadius.vertical(
    top: Radius.circular(sheet),
  );
}

/// Motion. Short and quiet — the web app has almost no animation, so the native
/// layer adds only the transitions the platforms themselves expect.
abstract final class NoboMotion {
  const NoboMotion._();

  static const Duration instant = Duration(milliseconds: 90);
  static const Duration fast = Duration(milliseconds: 140);
  static const Duration base = Duration(milliseconds: 200);
  static const Duration medium = Duration(milliseconds: 280);
  static const Duration slow = Duration(milliseconds: 400);
  static const Duration hero = Duration(milliseconds: 560);

  static const Curve standard = Cubic(0.2, 0.0, 0.0, 1.0);
  static const Curve decelerate = Cubic(0.05, 0.7, 0.1, 1.0);
  static const Curve accelerate = Cubic(0.3, 0.0, 0.8, 0.15);
  static const Curve emphasized = Cubic(0.21, 1.02, 0.35, 1.0);
  static const Curve ios = Curves.easeOutCubic;
}

/// Elevation. The PWA separates surfaces with a 1px slate-200 border and, at
/// most, a very faint shadow. Heavy shadows would immediately look wrong.
abstract final class NoboElevation {
  const NoboElevation._();

  static const List<BoxShadow> none = <BoxShadow>[];

  /// Card resting state — matches `shadow-sm`.
  static const List<BoxShadow> low = <BoxShadow>[
    BoxShadow(
      color: Color(0x0A0F172A),
      blurRadius: 3,
      offset: Offset(0, 1),
    ),
  ];

  /// Raised surfaces (dropdowns, sticky bars) — matches `shadow-md`.
  static const List<BoxShadow> medium = <BoxShadow>[
    BoxShadow(
      color: Color(0x140F172A),
      blurRadius: 12,
      offset: Offset(0, 4),
    ),
  ];

  /// Sheets and dialogs.
  static const List<BoxShadow> high = <BoxShadow>[
    BoxShadow(
      color: Color(0x1F0F172A),
      blurRadius: 32,
      offset: Offset(0, 10),
    ),
  ];

  /// Blue glow used under the primary call-to-action, as the web app does.
  static List<BoxShadow> glow(Color color) => <BoxShadow>[
    BoxShadow(
      color: color.withValues(alpha: 0.25),
      blurRadius: 18,
      offset: const Offset(0, 6),
    ),
  ];
}

abstract final class NoboBorder {
  const NoboBorder._();

  static Border all(Color color, {double width = 1}) =>
      Border.all(color: color, width: width);

  static Border bottom(Color color, {double width = 1}) =>
      Border(bottom: BorderSide(color: color, width: width));
}
