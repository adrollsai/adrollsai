import 'package:flutter/material.dart';

/// Nobogent brand palette.
///
/// The identity is derived from the actual Nobogent logomark, which is an
/// orbital swirl rendered as a violet -> indigo gradient (#6020D0 -> #4840D0).
/// The marketing site's navy / crimson / gold are retained as *accent* roles,
/// not as the primary brand colour, because the logomark is the authoritative
/// brand asset and violet is what a user actually recognises.
abstract final class NoboBrand {
  const NoboBrand._();

  // Violet — primary. Sampled directly from the logomark.
  static const Color violet50 = Color(0xFFF4F0FF);
  static const Color violet100 = Color(0xFFE9E1FF);
  static const Color violet200 = Color(0xFFD6C7FF);
  static const Color violet300 = Color(0xFFB9A0FF);
  static const Color violet400 = Color(0xFF9670FA);
  static const Color violet500 = Color(0xFF7B45F0);
  static const Color violet600 = Color(0xFF5F27DC);
  static const Color violet700 = Color(0xFF4E1CB8);
  static const Color violet800 = Color(0xFF3F1895);
  static const Color violet900 = Color(0xFF331375);

  // Indigo — the cool end of the logomark gradient.
  static const Color indigo400 = Color(0xFF7A73F0);
  static const Color indigo500 = Color(0xFF5A50E2);
  static const Color indigo600 = Color(0xFF4338CA);
  static const Color indigo700 = Color(0xFF372DA6);

  // Crimson — approval / irreversible action. From the marketing brand.
  static const Color crimson500 = Color(0xFFD43B41);
  static const Color crimson600 = Color(0xFFB31B20);
  static const Color crimson700 = Color(0xFF902227);

  // Gold — credits, streaks, achievement.
  static const Color gold400 = Color(0xFFE8BB55);
  static const Color gold500 = Color(0xFFD4AF37);
  static const Color gold600 = Color(0xFFB08F22);

  // Navy — brand depth; used for dark canvas tint and editorial surfaces.
  static const Color navy700 = Color(0xFF0C3157);
  static const Color navy800 = Color(0xFF003D6F);
  static const Color navy900 = Color(0xFF00284D);

  // Success / warning, tuned to sit beside violet without clashing.
  static const Color positive500 = Color(0xFF0F9D76);
  static const Color positive600 = Color(0xFF0B7D5E);
  static const Color caution500 = Color(0xFFE0A32E);
  static const Color caution600 = Color(0xFFB77E14);
}

/// The orbital gradient used by the logomark.
abstract final class NoboGradients {
  const NoboGradients._();

  /// Primary brand gradient: violet -> indigo, 135 degrees.
  static const LinearGradient orbit = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[Color(0xFF6220D8), Color(0xFF3F3FE0)],
  );

  /// Softer variant for large fills and washed surfaces.
  static const LinearGradient orbitSoft = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[Color(0xFF7B45F0), Color(0xFF5A50E2)],
  );

  /// Warm accent gradient for credits / achievement moments.
  static const LinearGradient gold = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[Color(0xFFE8BB55), Color(0xFFC99A22)],
  );
}

/// Semantic colour roles, resolved per brightness.
///
/// Installed as a [ThemeExtension] so every widget reads colour through the
/// theme rather than reaching for a constant. Light and dark are separately
/// art-directed — dark is not a naive inversion.
@immutable
class NoboColors extends ThemeExtension<NoboColors> {
  const NoboColors({
    required this.canvas,
    required this.surface,
    required this.surfaceSunken,
    required this.surfaceRaised,
    required this.border,
    required this.borderStrong,
    required this.ink,
    required this.inkSecondary,
    required this.inkTertiary,
    required this.inkInverse,
    required this.primary,
    required this.primaryPressed,
    required this.onPrimary,
    required this.primaryWash,
    required this.accent,
    required this.accentWash,
    required this.positive,
    required this.positiveWash,
    required this.caution,
    required this.cautionWash,
    required this.danger,
    required this.dangerWash,
    required this.credit,
    required this.creditWash,
    required this.scrim,
    required this.hairline,
    required this.skeleton,
    required this.skeletonHighlight,
  });

  /// Page background behind everything.
  final Color canvas;

  /// Default content surface (cards, sheets, bars).
  final Color surface;

  /// Recessed area — inset wells, track backgrounds, grouped lists.
  final Color surfaceSunken;

  /// Raised above [surface] — floating sheets, menus, hovered rows.
  final Color surfaceRaised;

  /// 1px hairline used for most separation.
  final Color border;

  /// Stronger border for inputs and emphasis.
  final Color borderStrong;

  /// Primary text.
  final Color ink;

  /// Supporting text.
  final Color inkSecondary;

  /// Metadata, placeholders, disabled.
  final Color inkTertiary;

  /// Text placed on brand-coloured fills.
  final Color inkInverse;

  /// Brand action colour.
  final Color primary;

  /// Pressed/hovered brand colour.
  final Color primaryPressed;

  /// Foreground on [primary].
  final Color onPrimary;

  /// Tinted brand background for selectable/selected states.
  final Color primaryWash;

  /// Secondary emphasis (crimson family).
  final Color accent;

  /// Tinted accent background.
  final Color accentWash;

  final Color positive;
  final Color positiveWash;
  final Color caution;
  final Color cautionWash;
  final Color danger;
  final Color dangerWash;

  /// Credits / achievement (gold family).
  final Color credit;
  final Color creditWash;

  /// Modal barrier.
  final Color scrim;

  /// Barely-there divider inside a surface.
  final Color hairline;

  /// Skeleton base.
  final Color skeleton;

  /// Skeleton shimmer highlight.
  final Color skeletonHighlight;

  /// Light theme: paper-white canvas with a violet cast so brand colours feel
  /// native rather than pasted on. Never pure #FFFFFF for the page itself —
  /// cards need somewhere to sit.
  static const NoboColors light = NoboColors(
    canvas: Color(0xFFF6F5FA),
    surface: Color(0xFFFFFFFF),
    surfaceSunken: Color(0xFFF0EFF6),
    surfaceRaised: Color(0xFFFFFFFF),
    border: Color(0xFFE5E3EE),
    borderStrong: Color(0xFFD2CFDF),
    ink: Color(0xFF14131C),
    inkSecondary: Color(0xFF56536A),
    inkTertiary: Color(0xFF8A879B),
    inkInverse: Color(0xFFFFFFFF),
    primary: NoboBrand.violet600,
    primaryPressed: NoboBrand.violet700,
    onPrimary: Color(0xFFFFFFFF),
    primaryWash: Color(0xFFEFE9FE),
    accent: NoboBrand.crimson600,
    accentWash: Color(0xFFFBE9EA),
    positive: NoboBrand.positive500,
    positiveWash: Color(0xFFE4F5EF),
    caution: NoboBrand.caution600,
    cautionWash: Color(0xFFFBF0DA),
    danger: Color(0xFFC62F35),
    dangerWash: Color(0xFFFCE8E8),
    credit: NoboBrand.gold600,
    creditWash: Color(0xFFFBF2D8),
    scrim: Color(0x6612101C),
    hairline: Color(0xFFF0EEF5),
    skeleton: Color(0xFFE9E7F0),
    skeletonHighlight: Color(0xFFF5F3F9),
  );

  /// Dark theme: deep violet-black, not grey. Surfaces lift by tint rather
  /// than by shadow, which is what reads as "native dark" on both platforms.
  static const NoboColors dark = NoboColors(
    canvas: Color(0xFF0A0910),
    surface: Color(0xFF141320),
    surfaceSunken: Color(0xFF0E0D16),
    surfaceRaised: Color(0xFF1C1A2B),
    border: Color(0xFF2A2740),
    borderStrong: Color(0xFF3B3757),
    ink: Color(0xFFF4F2FA),
    inkSecondary: Color(0xFFA9A5BE),
    inkTertiary: Color(0xFF6F6B85),
    inkInverse: Color(0xFF14131C),
    primary: NoboBrand.violet400,
    primaryPressed: NoboBrand.violet300,
    onPrimary: Color(0xFF180B3A),
    primaryWash: Color(0xFF241A45),
    accent: Color(0xFFE8696E),
    accentWash: Color(0xFF33161A),
    positive: Color(0xFF3FD0A6),
    positiveWash: Color(0xFF10312A),
    caution: NoboBrand.gold400,
    cautionWash: Color(0xFF332609),
    danger: Color(0xFFF07379),
    dangerWash: Color(0xFF361619),
    credit: NoboBrand.gold400,
    creditWash: Color(0xFF31260B),
    scrim: Color(0x99000000),
    hairline: Color(0xFF211E33),
    skeleton: Color(0xFF1E1B2E),
    skeletonHighlight: Color(0xFF282440),
  );

  @override
  NoboColors copyWith({
    Color? canvas,
    Color? surface,
    Color? surfaceSunken,
    Color? surfaceRaised,
    Color? border,
    Color? borderStrong,
    Color? ink,
    Color? inkSecondary,
    Color? inkTertiary,
    Color? inkInverse,
    Color? primary,
    Color? primaryPressed,
    Color? onPrimary,
    Color? primaryWash,
    Color? accent,
    Color? accentWash,
    Color? positive,
    Color? positiveWash,
    Color? caution,
    Color? cautionWash,
    Color? danger,
    Color? dangerWash,
    Color? credit,
    Color? creditWash,
    Color? scrim,
    Color? hairline,
    Color? skeleton,
    Color? skeletonHighlight,
  }) {
    return NoboColors(
      canvas: canvas ?? this.canvas,
      surface: surface ?? this.surface,
      surfaceSunken: surfaceSunken ?? this.surfaceSunken,
      surfaceRaised: surfaceRaised ?? this.surfaceRaised,
      border: border ?? this.border,
      borderStrong: borderStrong ?? this.borderStrong,
      ink: ink ?? this.ink,
      inkSecondary: inkSecondary ?? this.inkSecondary,
      inkTertiary: inkTertiary ?? this.inkTertiary,
      inkInverse: inkInverse ?? this.inkInverse,
      primary: primary ?? this.primary,
      primaryPressed: primaryPressed ?? this.primaryPressed,
      onPrimary: onPrimary ?? this.onPrimary,
      primaryWash: primaryWash ?? this.primaryWash,
      accent: accent ?? this.accent,
      accentWash: accentWash ?? this.accentWash,
      positive: positive ?? this.positive,
      positiveWash: positiveWash ?? this.positiveWash,
      caution: caution ?? this.caution,
      cautionWash: cautionWash ?? this.cautionWash,
      danger: danger ?? this.danger,
      dangerWash: dangerWash ?? this.dangerWash,
      credit: credit ?? this.credit,
      creditWash: creditWash ?? this.creditWash,
      scrim: scrim ?? this.scrim,
      hairline: hairline ?? this.hairline,
      skeleton: skeleton ?? this.skeleton,
      skeletonHighlight: skeletonHighlight ?? this.skeletonHighlight,
    );
  }

  @override
  NoboColors lerp(ThemeExtension<NoboColors>? other, double t) {
    if (other is! NoboColors) return this;
    return NoboColors(
      canvas: Color.lerp(canvas, other.canvas, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceSunken: Color.lerp(surfaceSunken, other.surfaceSunken, t)!,
      surfaceRaised: Color.lerp(surfaceRaised, other.surfaceRaised, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      inkSecondary: Color.lerp(inkSecondary, other.inkSecondary, t)!,
      inkTertiary: Color.lerp(inkTertiary, other.inkTertiary, t)!,
      inkInverse: Color.lerp(inkInverse, other.inkInverse, t)!,
      primary: Color.lerp(primary, other.primary, t)!,
      primaryPressed: Color.lerp(primaryPressed, other.primaryPressed, t)!,
      onPrimary: Color.lerp(onPrimary, other.onPrimary, t)!,
      primaryWash: Color.lerp(primaryWash, other.primaryWash, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentWash: Color.lerp(accentWash, other.accentWash, t)!,
      positive: Color.lerp(positive, other.positive, t)!,
      positiveWash: Color.lerp(positiveWash, other.positiveWash, t)!,
      caution: Color.lerp(caution, other.caution, t)!,
      cautionWash: Color.lerp(cautionWash, other.cautionWash, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      dangerWash: Color.lerp(dangerWash, other.dangerWash, t)!,
      credit: Color.lerp(credit, other.credit, t)!,
      creditWash: Color.lerp(creditWash, other.creditWash, t)!,
      scrim: Color.lerp(scrim, other.scrim, t)!,
      hairline: Color.lerp(hairline, other.hairline, t)!,
      skeleton: Color.lerp(skeleton, other.skeleton, t)!,
      skeletonHighlight: Color.lerp(
        skeletonHighlight,
        other.skeletonHighlight,
        t,
      )!,
    );
  }
}

/// Convenience accessor: `context.nobo.ink`.
///
/// Falls back to the palette matching the ambient brightness instead of throwing.
/// A missing extension should degrade to the right colours, not crash a screen —
/// and it keeps widget tests that mount a component without the full theme stack
/// from failing on a null check.
extension NoboColorsX on BuildContext {
  NoboColors get nobo {
    final ThemeData theme = Theme.of(this);
    return theme.extension<NoboColors>() ??
        (theme.brightness == Brightness.dark
            ? NoboColors.dark
            : NoboColors.light);
  }
}
