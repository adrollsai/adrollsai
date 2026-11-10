import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'nobo_colors.dart';
import 'nobo_metrics.dart';
import 'nobo_type.dart';

/// Builds the platform themes from the shared token set.
///
/// The visual language is the web app's — white surfaces, slate hairlines, blue
/// action colour, pill-shaped buttons. Only the *behaviour* is platform-specific:
/// ripple and Material controls on Android, Cupertino controls and transitions on
/// iOS. Nothing here changes the look between platforms.
abstract final class NoboTheme {
  const NoboTheme._();

  static ThemeData material({required Brightness brightness}) {
    final bool isDark = brightness == Brightness.dark;
    final NoboColors c = isDark ? NoboColors.dark : NoboColors.light;

    final ColorScheme scheme = ColorScheme(
      brightness: brightness,
      primary: c.primary,
      onPrimary: c.onPrimary,
      primaryContainer: c.primaryWash,
      onPrimaryContainer: c.primary,
      secondary: c.accent,
      onSecondary: Colors.white,
      secondaryContainer: c.accentWash,
      onSecondaryContainer: c.accent,
      tertiary: c.positive,
      onTertiary: Colors.white,
      error: c.danger,
      onError: Colors.white,
      errorContainer: c.dangerWash,
      onErrorContainer: c.danger,
      surface: c.surface,
      onSurface: c.ink,
      surfaceContainerLowest: c.canvas,
      surfaceContainerLow: c.surfaceSunken,
      surfaceContainer: c.surface,
      surfaceContainerHigh: c.surfaceRaised,
      surfaceContainerHighest: c.surfaceRaised,
      onSurfaceVariant: c.inkSecondary,
      outline: c.borderStrong,
      outlineVariant: c.border,
      shadow: const Color(0xFF0F172A),
      scrim: c.scrim,
      inverseSurface: c.navy,
      onInverseSurface: c.onNavy,
      inversePrimary: NoboBrand.blue200,
    );

    final TextTheme text = NoboType.textTheme(c.ink, c.inkSecondary);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.canvas,
      canvasColor: c.canvas,
      splashFactory: InkSparkle.splashFactory,
      textTheme: text,
      primaryTextTheme: text,
      fontFamily: NoboType.family,
      extensions: <ThemeExtension<dynamic>>[c],
      visualDensity: VisualDensity.standard,
      dividerTheme: DividerThemeData(
        color: c.hairline,
        thickness: 1,
        space: 1,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: c.canvas,
        surfaceTintColor: Colors.transparent,
        foregroundColor: c.ink,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: NoboType.subtitle.copyWith(color: c.ink),
      ),
      cardTheme: CardThemeData(
        color: c.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rLg),
      ),
      // The web app's CTAs are pills: "Add Product", "Upload Assets",
      // "Enable Now", "Open Active Chat".
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: c.primary,
          foregroundColor: c.onPrimary,
          disabledBackgroundColor: c.surfaceSunken,
          disabledForegroundColor: c.inkTertiary,
          minimumSize: const Size(0, NoboSpace.minTapTarget),
          padding: const EdgeInsets.symmetric(
            horizontal: NoboSpace.lg,
            vertical: NoboSpace.md,
          ),
          textStyle: NoboType.label.copyWith(fontSize: 14.5),
          shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rPill),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.ink,
          backgroundColor: c.surface,
          minimumSize: const Size(0, NoboSpace.minTapTarget),
          padding: const EdgeInsets.symmetric(
            horizontal: NoboSpace.lg,
            vertical: NoboSpace.md,
          ),
          textStyle: NoboType.label.copyWith(fontSize: 14.5),
          side: BorderSide(color: c.border),
          shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rPill),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: c.primary,
          minimumSize: const Size(0, 40),
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.md),
          textStyle: NoboType.label.copyWith(fontSize: 14, color: c.primary),
          shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rPill),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: NoboSpace.base,
          vertical: 14,
        ),
        hintStyle: NoboType.body.copyWith(color: c.inkTertiary),
        labelStyle: NoboType.body.copyWith(color: c.inkSecondary),
        floatingLabelStyle: NoboType.label.copyWith(color: c.primary),
        errorStyle: NoboType.caption.copyWith(color: c.danger),
        helperStyle: NoboType.caption.copyWith(color: c.inkTertiary),
        border: OutlineInputBorder(
          borderRadius: NoboRadius.rLg,
          borderSide: BorderSide(color: c.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rLg,
          borderSide: BorderSide(color: c.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rLg,
          borderSide: BorderSide(color: c.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rLg,
          borderSide: BorderSide(color: c.danger),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rLg,
          borderSide: BorderSide(color: c.danger, width: 1.5),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: c.surface,
        modalBarrierColor: c.scrim,
        showDragHandle: false,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rSheetTop),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rXl),
        titleTextStyle: NoboType.subtitle.copyWith(color: c.ink),
        contentTextStyle: NoboType.body.copyWith(color: c.inkSecondary),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: c.navy,
        contentTextStyle: NoboType.body.copyWith(color: c.onNavy),
        behavior: SnackBarBehavior.floating,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rMd),
        insetPadding: const EdgeInsets.all(NoboSpace.base),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: c.surface,
        selectedColor: c.navy,
        side: BorderSide(color: c.border),
        labelStyle: NoboType.label.copyWith(color: c.inkSecondary),
        secondaryLabelStyle: NoboType.label.copyWith(color: c.onNavy),
        padding: const EdgeInsets.symmetric(
          horizontal: NoboSpace.md,
          vertical: NoboSpace.sm,
        ),
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rPill),
        showCheckmark: false,
      ),
      // Android bottom navigation, styled to the web app's bar: white surface,
      // hairline top border, blue active pill.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: c.primaryWash,
        elevation: 0,
        height: 64,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith((Set<WidgetState> s) {
          final bool selected = s.contains(WidgetState.selected);
          return NoboType.caption.copyWith(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            color: selected ? c.primary : c.inkTertiary,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((Set<WidgetState> s) {
          final bool selected = s.contains(WidgetState.selected);
          return IconThemeData(
            size: 22,
            color: selected ? c.primary : c.inkTertiary,
          );
        }),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (Set<WidgetState> s) =>
              s.contains(WidgetState.selected) ? Colors.white : c.surface,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (Set<WidgetState> s) =>
              s.contains(WidgetState.selected) ? c.primary : c.surfaceSunken,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (Set<WidgetState> s) =>
              s.contains(WidgetState.selected) ? Colors.transparent : c.border,
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: c.primary,
        linearTrackColor: c.surfaceSunken,
        circularTrackColor: c.surfaceSunken,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(color: c.navy, borderRadius: NoboRadius.rXs),
        textStyle: NoboType.caption.copyWith(color: c.onNavy),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: <TargetPlatform, PageTransitionsBuilder>{
          TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        },
      ),
    );
  }

  static CupertinoThemeData cupertino({required Brightness brightness}) {
    final bool isDark = brightness == Brightness.dark;
    final NoboColors c = isDark ? NoboColors.dark : NoboColors.light;

    return CupertinoThemeData(
      brightness: brightness,
      primaryColor: c.primary,
      primaryContrastingColor: c.onPrimary,
      scaffoldBackgroundColor: c.canvas,
      barBackgroundColor: c.surface.withValues(alpha: isDark ? 0.86 : 0.92),
      textTheme: CupertinoTextThemeData(
        textStyle: NoboType.body.copyWith(color: c.ink),
        navTitleTextStyle: NoboType.subtitle.copyWith(
          color: c.ink,
          fontSize: 17,
        ),
        navLargeTitleTextStyle: NoboType.display.copyWith(color: c.ink),
        navActionTextStyle: NoboType.body.copyWith(
          color: c.primary,
          fontSize: 17,
        ),
        tabLabelTextStyle: NoboType.caption.copyWith(
          fontSize: 10,
          fontWeight: FontWeight.w500,
          color: c.inkTertiary,
        ),
        actionTextStyle: NoboType.label.copyWith(color: c.primary),
        pickerTextStyle: NoboType.body.copyWith(color: c.ink),
        dateTimePickerTextStyle: NoboType.body.copyWith(color: c.ink),
      ),
    );
  }
}