import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'nobo_colors.dart';
import 'nobo_metrics.dart';
import 'nobo_type.dart';

/// Builds the two platform themes from the shared token set.
///
/// Business logic, tokens and components are shared; only the *styling and
/// motion* differ per platform. Nothing here branches on colour — both
/// platforms draw from the same art-directed palette.
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
      onSecondary: c.inkInverse,
      secondaryContainer: c.accentWash,
      onSecondaryContainer: c.accent,
      tertiary: c.credit,
      onTertiary: c.inkInverse,
      error: c.danger,
      onError: c.inkInverse,
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
      shadow: const Color(0xFF160C33),
      scrim: c.scrim,
      inverseSurface: c.ink,
      onInverseSurface: c.canvas,
      inversePrimary: isDark ? NoboBrand.violet600 : NoboBrand.violet300,
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
      // Android reads as native when the system bars are drawn by content
      // (edge-to-edge) and the app paints behind them.
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
        titleTextStyle: NoboType.headline.copyWith(color: c.ink),
      ),
      cardTheme: CardThemeData(
        color: c.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rLg),
      ),
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
          textStyle: NoboType.label.copyWith(fontSize: 14),
          shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rSm),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.ink,
          minimumSize: const Size(0, NoboSpace.minTapTarget),
          padding: const EdgeInsets.symmetric(
            horizontal: NoboSpace.lg,
            vertical: NoboSpace.md,
          ),
          textStyle: NoboType.label.copyWith(fontSize: 14),
          side: BorderSide(color: c.borderStrong),
          shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rSm),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: c.primary,
          minimumSize: const Size(0, NoboSpace.minTapTarget),
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.md),
          textStyle: NoboType.label.copyWith(fontSize: 14),
          shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rSm),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: NoboSpace.md,
          vertical: NoboSpace.md,
        ),
        hintStyle: NoboType.body.copyWith(color: c.inkTertiary),
        labelStyle: NoboType.body.copyWith(color: c.inkSecondary),
        floatingLabelStyle: NoboType.label.copyWith(color: c.primary),
        errorStyle: NoboType.caption.copyWith(color: c.danger),
        helperStyle: NoboType.caption.copyWith(color: c.inkTertiary),
        border: OutlineInputBorder(
          borderRadius: NoboRadius.rSm,
          borderSide: BorderSide(color: c.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rSm,
          borderSide: BorderSide(color: c.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rSm,
          borderSide: BorderSide(color: c.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rSm,
          borderSide: BorderSide(color: c.danger),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: NoboRadius.rSm,
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
        backgroundColor: c.surfaceRaised,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rLg),
        titleTextStyle: NoboType.headline.copyWith(color: c.ink),
        contentTextStyle: NoboType.body.copyWith(color: c.inkSecondary),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: c.ink,
        contentTextStyle: NoboType.body.copyWith(color: c.canvas),
        behavior: SnackBarBehavior.floating,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rSm),
        insetPadding: const EdgeInsets.all(NoboSpace.base),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: c.surfaceSunken,
        selectedColor: c.primaryWash,
        side: BorderSide(color: c.border),
        labelStyle: NoboType.label.copyWith(color: c.inkSecondary),
        secondaryLabelStyle: NoboType.label.copyWith(color: c.primary),
        padding: const EdgeInsets.symmetric(
          horizontal: NoboSpace.sm,
          vertical: NoboSpace.xs,
        ),
        shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rPill),
        showCheckmark: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: c.primaryWash,
        elevation: 0,
        height: 64,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final bool selected = states.contains(WidgetState.selected);
          return NoboType.micro.copyWith(
            fontSize: 11.5,
            letterSpacing: 0.1,
            color: selected ? c.primary : c.inkTertiary,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final bool selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 23,
            color: selected ? c.primary : c.inkTertiary,
          );
        }),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? Colors.white
              : c.surface,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? c.primary
              : c.surfaceSunken,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? Colors.transparent
              : c.borderStrong,
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: c.primary,
        linearTrackColor: c.surfaceSunken,
        circularTrackColor: c.surfaceSunken,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: c.ink,
          borderRadius: NoboRadius.rXs,
        ),
        textStyle: NoboType.caption.copyWith(color: c.canvas),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: <TargetPlatform, PageTransitionsBuilder>{
          TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        },
      ),
    );
  }

  /// Cupertino theme for the iOS experience.
  ///
  /// Translucent-bar colours are resolved from the same palette so the two
  /// platforms stay one product.
  static CupertinoThemeData cupertino({required Brightness brightness}) {
    final bool isDark = brightness == Brightness.dark;
    final NoboColors c = isDark ? NoboColors.dark : NoboColors.light;

    return CupertinoThemeData(
      brightness: brightness,
      primaryColor: c.primary,
      primaryContrastingColor: c.onPrimary,
      scaffoldBackgroundColor: c.canvas,
      barBackgroundColor: c.surface.withValues(alpha: isDark ? 0.82 : 0.86),
      textTheme: CupertinoTextThemeData(
        textStyle: NoboType.body.copyWith(color: c.ink),
        navTitleTextStyle: NoboType.subtitle.copyWith(color: c.ink),
        navLargeTitleTextStyle: NoboType.display.copyWith(color: c.ink),
        navActionTextStyle: NoboType.label
            .copyWith(color: c.primary)
            .copyWith(fontSize: 17),
        tabLabelTextStyle: NoboType.micro.copyWith(
          fontSize: 10,
          letterSpacing: 0,
          color: c.inkTertiary,
        ),
        actionTextStyle: NoboType.label.copyWith(color: c.primary),
        pickerTextStyle: NoboType.body.copyWith(color: c.ink),
        dateTimePickerTextStyle: NoboType.body.copyWith(color: c.ink),
      ),
    );
  }
}
