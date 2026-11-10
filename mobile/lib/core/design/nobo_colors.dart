import 'package:flutter/material.dart';

/// Palette lifted from the live Nobogent PWA.
///
/// Values are sampled from the running web app and its Tailwind config, not
/// invented: the whole point of this design pass is that the native app looks
/// like the product people already use. Slate neutrals, blue-600 action colour,
/// slate-900 "navy" for the dark primary buttons, and the accent hues the web
/// dashboard uses to colour-code its stat tiles.
abstract final class NoboBrand {
  const NoboBrand._();

  // Blue — the single action colour across the web app.
  static const Color blue50 = Color(0xFFEFF6FF);
  static const Color blue100 = Color(0xFFDBEAFE);
  static const Color blue200 = Color(0xFFBFDBFE);
  static const Color blue500 = Color(0xFF3B82F6);
  static const Color blue600 = Color(0xFF2563EB);
  static const Color blue700 = Color(0xFF1D4ED8);

  // Slate neutrals — the app's structural colour.
  static const Color slate50 = Color(0xFFF8FAFC);
  static const Color slate100 = Color(0xFFF1F5F9);
  static const Color slate200 = Color(0xFFE2E8F0);
  static const Color slate300 = Color(0xFFCBD5E1);
  static const Color slate400 = Color(0xFF94A3B8);
  static const Color slate500 = Color(0xFF64748B);
  static const Color slate600 = Color(0xFF475569);
  static const Color slate700 = Color(0xFF334155);
  static const Color slate800 = Color(0xFF1E293B);
  static const Color slate900 = Color(0xFF0F172A);
  static const Color slate950 = Color(0xFF020617);

  // Accent hues the dashboard uses to differentiate metrics and actions.
  static const Color violet500 = Color(0xFF8B5CF6);
  static const Color violet600 = Color(0xFF7C3AED);
  static const Color violet50 = Color(0xFFF5F3FF);

  static const Color emerald500 = Color(0xFF10B981);
  static const Color emerald600 = Color(0xFF059669);
  static const Color emerald50 = Color(0xFFECFDF5);

  static const Color amber500 = Color(0xFFF59E0B);
  static const Color amber600 = Color(0xFFD97706);
  static const Color amber50 = Color(0xFFFFFBEB);

  static const Color rose500 = Color(0xFFF43F5E);
  static const Color rose50 = Color(0xFFFFF1F2);

  static const Color red500 = Color(0xFFEF4444);
  static const Color red600 = Color(0xFFDC2626);
  static const Color red50 = Color(0xFFFEF2F2);

  static const Color pink500 = Color(0xFFEC4899);
  static const Color pink50 = Color(0xFFFDF2F8);
  static const Color purple500 = Color(0xFFA855F7);
  static const Color purple50 = Color(0xFFFAF5FF);

  // WhatsApp's own green, used on the WhatsApp actions in the PWA.
  static const Color whatsapp = Color(0xFF25D366);
  static const Color whatsappDark = Color(0xFF128C7E);
}

abstract final class NoboGradients {
  const NoboGradients._();

  /// Primary web button gradient (blue-500 → blue-600).
  static const LinearGradient blue = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[Color(0xFF3B82F6), Color(0xFF2563EB)],
  );

  /// Dark primary button (slate-900).
  static const LinearGradient navy = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[Color(0xFF1E293B), Color(0xFF0F172A)],
  );

  /// Retained alias so screens written against the earlier blue brand gradient
  /// keep compiling while they are migrated to the web app's styling.
  static const LinearGradient orbit = blue;
}

/// Semantic colour roles, resolved per brightness.
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
    required this.navy,
    required this.onNavy,
    required this.info,
    required this.infoWash,
  });

  final Color canvas;
  final Color surface;
  final Color surfaceSunken;
  final Color surfaceRaised;
  final Color border;
  final Color borderStrong;
  final Color ink;
  final Color inkSecondary;
  final Color inkTertiary;
  final Color inkInverse;
  final Color primary;
  final Color primaryPressed;
  final Color onPrimary;
  final Color primaryWash;

  /// Violet accent — the PWA uses it for AI/sparkle affordances and history.
  final Color accent;
  final Color accentWash;
  final Color positive;
  final Color positiveWash;
  final Color caution;
  final Color cautionWash;
  final Color danger;
  final Color dangerWash;
  final Color credit;
  final Color creditWash;
  final Color scrim;
  final Color hairline;
  final Color skeleton;
  final Color skeletonHighlight;

  /// Near-black surface used for the PWA's dark primary actions
  /// ("Upload Assets", "New session", "Enable Now").
  final Color navy;
  final Color onNavy;

  /// Secondary informational tint (the PWA's light-blue pills).
  final Color info;
  final Color infoWash;

  static const NoboColors light = NoboColors(
    canvas: NoboBrand.slate50,
    surface: Color(0xFFFFFFFF),
    surfaceSunken: NoboBrand.slate100,
    surfaceRaised: Color(0xFFFFFFFF),
    border: NoboBrand.slate200,
    borderStrong: NoboBrand.slate300,
    ink: NoboBrand.slate900,
    inkSecondary: NoboBrand.slate500,
    inkTertiary: NoboBrand.slate400,
    inkInverse: Color(0xFFFFFFFF),
    primary: NoboBrand.blue600,
    primaryPressed: NoboBrand.blue700,
    onPrimary: Color(0xFFFFFFFF),
    primaryWash: NoboBrand.blue50,
    accent: NoboBrand.violet600,
    accentWash: NoboBrand.violet50,
    positive: NoboBrand.emerald600,
    positiveWash: NoboBrand.emerald50,
    caution: NoboBrand.amber600,
    cautionWash: NoboBrand.amber50,
    danger: NoboBrand.red600,
    dangerWash: NoboBrand.red50,
    credit: NoboBrand.amber600,
    creditWash: NoboBrand.amber50,
    scrim: Color(0x660F172A),
    hairline: NoboBrand.slate100,
    skeleton: NoboBrand.slate200,
    skeletonHighlight: NoboBrand.slate100,
    navy: NoboBrand.slate900,
    onNavy: Color(0xFFFFFFFF),
    info: NoboBrand.blue600,
    infoWash: NoboBrand.blue50,
  );

  /// The web app is light-only by design (`color-scheme: light`, white canvas).
  /// A dark palette exists so the native app can follow a phone set to dark mode
  /// without looking broken, but light is the canonical experience.
  static const NoboColors dark = NoboColors(
    canvas: NoboBrand.slate950,
    surface: NoboBrand.slate900,
    surfaceSunken: Color(0xFF1E293B),
    surfaceRaised: NoboBrand.slate800,
    border: Color(0xFF1E293B),
    borderStrong: NoboBrand.slate700,
    ink: Color(0xFFF8FAFC),
    inkSecondary: NoboBrand.slate400,
    inkTertiary: NoboBrand.slate500,
    inkInverse: NoboBrand.slate900,
    primary: NoboBrand.blue500,
    primaryPressed: NoboBrand.blue600,
    onPrimary: Color(0xFFFFFFFF),
    primaryWash: Color(0xFF172554),
    accent: NoboBrand.violet500,
    accentWash: Color(0xFF2E1065),
    positive: NoboBrand.emerald500,
    positiveWash: Color(0xFF052E22),
    caution: NoboBrand.amber500,
    cautionWash: Color(0xFF3B2606),
    danger: NoboBrand.red500,
    dangerWash: Color(0xFF3F1216),
    credit: NoboBrand.amber500,
    creditWash: Color(0xFF3B2606),
    scrim: Color(0x99000000),
    hairline: Color(0xFF1E293B),
    skeleton: Color(0xFF1E293B),
    skeletonHighlight: Color(0xFF334155),
    navy: Color(0xFFF8FAFC),
    onNavy: NoboBrand.slate900,
    info: NoboBrand.blue500,
    infoWash: Color(0xFF172554),
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
    Color? navy,
    Color? onNavy,
    Color? info,
    Color? infoWash,
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
      navy: navy ?? this.navy,
      onNavy: onNavy ?? this.onNavy,
      info: info ?? this.info,
      infoWash: infoWash ?? this.infoWash,
    );
  }

  @override
  NoboColors lerp(ThemeExtension<NoboColors>? other, double t) {
    if (other is! NoboColors) return this;
    Color c(Color a, Color b) => Color.lerp(a, b, t)!;
    return NoboColors(
      canvas: c(canvas, other.canvas),
      surface: c(surface, other.surface),
      surfaceSunken: c(surfaceSunken, other.surfaceSunken),
      surfaceRaised: c(surfaceRaised, other.surfaceRaised),
      border: c(border, other.border),
      borderStrong: c(borderStrong, other.borderStrong),
      ink: c(ink, other.ink),
      inkSecondary: c(inkSecondary, other.inkSecondary),
      inkTertiary: c(inkTertiary, other.inkTertiary),
      inkInverse: c(inkInverse, other.inkInverse),
      primary: c(primary, other.primary),
      primaryPressed: c(primaryPressed, other.primaryPressed),
      onPrimary: c(onPrimary, other.onPrimary),
      primaryWash: c(primaryWash, other.primaryWash),
      accent: c(accent, other.accent),
      accentWash: c(accentWash, other.accentWash),
      positive: c(positive, other.positive),
      positiveWash: c(positiveWash, other.positiveWash),
      caution: c(caution, other.caution),
      cautionWash: c(cautionWash, other.cautionWash),
      danger: c(danger, other.danger),
      dangerWash: c(dangerWash, other.dangerWash),
      credit: c(credit, other.credit),
      creditWash: c(creditWash, other.creditWash),
      scrim: c(scrim, other.scrim),
      hairline: c(hairline, other.hairline),
      skeleton: c(skeleton, other.skeleton),
      skeletonHighlight: c(skeletonHighlight, other.skeletonHighlight),
      navy: c(navy, other.navy),
      onNavy: c(onNavy, other.onNavy),
      info: c(info, other.info),
      infoWash: c(infoWash, other.infoWash),
    );
  }
}

/// Convenience accessor: `context.nobo.ink`.
extension NoboColorsX on BuildContext {
  NoboColors get nobo {
    final ThemeData theme = Theme.of(this);
    return theme.extension<NoboColors>() ??
        (theme.brightness == Brightness.dark
            ? NoboColors.dark
            : NoboColors.light);
  }
}
