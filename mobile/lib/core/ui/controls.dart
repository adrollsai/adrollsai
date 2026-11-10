import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import '../platform/nobo_platform.dart';
import 'nobo_mark_loader.dart';

enum NoboButtonVariant { primary, tonal, outline, ghost, danger }

enum NoboButtonSize { small, medium, large }

/// The app's button.
///
/// Visually one product on both platforms, but the *press feedback* is
/// platform-correct: an ink ripple on Android, an opacity/scale dip on iOS.
/// Corner radius also follows platform convention (Material's 12 vs iOS's
/// continuous 14) rather than being identical everywhere.
class NoboButton extends StatefulWidget {
  const NoboButton({
    required this.label,
    this.onPressed,
    this.variant = NoboButtonVariant.primary,
    this.size = NoboButtonSize.medium,
    this.icon,
    this.trailingIcon,
    this.loading = false,
    this.expand = false,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final NoboButtonVariant variant;
  final NoboButtonSize size;
  final IconData? icon;
  final IconData? trailingIcon;
  final bool loading;
  final bool expand;

  @override
  State<NoboButton> createState() => _NoboButtonState();
}

class _NoboButtonState extends State<NoboButton> {
  bool _down = false;

  double get _height => switch (widget.size) {
    NoboButtonSize.small => 36,
    NoboButtonSize.medium => NoboSpace.minTapTarget,
    NoboButtonSize.large => 54,
  };

  double get _hPad => switch (widget.size) {
    NoboButtonSize.small => NoboSpace.md,
    NoboButtonSize.medium => NoboSpace.lg,
    NoboButtonSize.large => NoboSpace.xl,
  };

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool enabled = widget.onPressed != null && !widget.loading;

    late Color bg;
    late Color fg;
    BorderSide side = BorderSide.none;

    switch (widget.variant) {
      case NoboButtonVariant.primary:
        bg = enabled ? c.primary : c.surfaceSunken;
        fg = enabled ? c.onPrimary : c.inkTertiary;
      case NoboButtonVariant.tonal:
        bg = c.primaryWash;
        fg = c.primary;
      case NoboButtonVariant.outline:
        bg = Colors.transparent;
        fg = c.ink;
        side = BorderSide(color: c.borderStrong);
      case NoboButtonVariant.ghost:
        bg = Colors.transparent;
        fg = c.primary;
      case NoboButtonVariant.danger:
        bg = enabled ? c.danger : c.surfaceSunken;
        fg = enabled ? Colors.white : c.inkTertiary;
    }

    final double radius = NoboPlatform.isIOS ? NoboRadius.md : NoboRadius.sm;
    final TextStyle textStyle = NoboType.label.copyWith(
      color: fg,
      fontSize: widget.size == NoboButtonSize.small ? 13 : 14.5,
      fontWeight: FontWeight.w600,
    );

    final Widget content = Row(
      mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        if (widget.loading)
          NoboMarkLoader(size: 15, color: fg, semanticLabel: 'Working')
        else if (widget.icon != null)
          Icon(widget.icon, size: 18, color: fg),
        if (widget.loading || widget.icon != null)
          const SizedBox(width: NoboSpace.sm),
        Flexible(
          child: Text(
            widget.label,
            style: textStyle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (widget.trailingIcon != null) ...<Widget>[
          const SizedBox(width: NoboSpace.sm),
          Icon(widget.trailingIcon, size: 17, color: fg),
        ],
      ],
    );

    final Widget body = AnimatedContainer(
      duration: NoboMotion.instant,
      height: _height,
      padding: EdgeInsets.symmetric(horizontal: _hPad),
      decoration: BoxDecoration(
        color: _down && enabled
            ? Color.alphaBlend(Colors.black.withValues(alpha: 0.08), bg)
            : bg,
        borderRadius: BorderRadius.circular(radius),
        border: side == BorderSide.none ? null : Border.all(color: side.color),
      ),
      child: Center(widthFactor: widget.expand ? 1 : null, child: content),
    );

    final Widget interactive = NoboPlatform.isAndroid
        ? Material(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(radius),
            child: InkWell(
              onTap: enabled ? widget.onPressed : null,
              borderRadius: BorderRadius.circular(radius),
              splashFactory: InkSparkle.splashFactory,
              child: body,
            ),
          )
        : GestureDetector(
            onTapDown: enabled ? (_) => setState(() => _down = true) : null,
            onTapUp: enabled ? (_) => setState(() => _down = false) : null,
            onTapCancel: () => setState(() => _down = false),
            onTap: enabled ? widget.onPressed : null,
            behavior: HitTestBehavior.opaque,
            child: body,
          );

    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      child: widget.expand
          ? SizedBox(width: double.infinity, child: interactive)
          : interactive,
    );
  }
}

/// Circular icon button with a guaranteed 44pt+ target.
class NoboIconButton extends StatelessWidget {
  const NoboIconButton({
    required this.icon,
    this.onPressed,
    this.tooltip,
    this.filled = false,
    this.size = 44,
    this.color,
    super.key,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final bool filled;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final Color fg = color ?? (filled ? c.primary : c.inkSecondary);
    final Widget child = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: filled ? c.primaryWash : Colors.transparent,
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: size * 0.46, color: fg),
    );

    final Widget tappable = NoboPlatform.isAndroid
        ? InkWell(
            onTap: onPressed,
            customBorder: const CircleBorder(),
            child: child,
          )
        : GestureDetector(
            onTap: onPressed,
            behavior: HitTestBehavior.opaque,
            child: child,
          );

    final Widget result = SizedBox(
      width: size,
      height: size,
      child: tappable,
    );

    if (tooltip == null) return result;
    return Tooltip(message: tooltip!, child: result);
  }
}

/// Text input. Renders a Cupertino field on iOS and a Material field on
/// Android so cursor, selection handles and keyboard behaviour feel native.
class NoboTextField extends StatelessWidget {
  const NoboTextField({
    required this.controller,
    this.hint,
    this.label,
    this.obscure = false,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.none,
    this.onSubmitted,
    this.onChanged,
    this.prefixIcon,
    this.suffix,
    this.maxLines = 1,
    this.autofocus = false,
    this.enabled = true,
    this.focusNode,
    this.errorText,
    super.key,
  });

  final TextEditingController controller;
  final String? hint;
  final String? label;
  final bool obscure;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;
  final IconData? prefixIcon;
  final Widget? suffix;
  final int maxLines;
  final bool autofocus;
  final bool enabled;
  final FocusNode? focusNode;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    if (NoboPlatform.isIOS) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (label != null) ...<Widget>[
            Text(
              label!.toUpperCase(),
              style: NoboType.micro.copyWith(color: c.inkTertiary),
            ),
            const SizedBox(height: NoboSpace.sm),
          ],
          Container(
            decoration: BoxDecoration(
              color: c.surface,
              borderRadius: BorderRadius.circular(NoboRadius.md),
              border: Border.all(
                color: errorText != null ? c.danger : c.border,
              ),
            ),
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.md),
            child: Row(
              children: <Widget>[
                if (prefixIcon != null) ...<Widget>[
                  Icon(prefixIcon, size: 18, color: c.inkTertiary),
                  const SizedBox(width: NoboSpace.sm),
                ],
                Expanded(
                  child: CupertinoTextField.borderless(
                    controller: controller,
                    focusNode: focusNode,
                    placeholder: hint,
                    placeholderStyle: NoboType.body.copyWith(
                      color: c.inkTertiary,
                    ),
                    style: NoboType.body.copyWith(color: c.ink),
                    obscureText: obscure,
                    keyboardType: keyboardType,
                    textCapitalization: textCapitalization,
                    onSubmitted: onSubmitted,
                    onChanged: onChanged,
                    maxLines: maxLines,
                    autofocus: autofocus,
                    enabled: enabled,
                    padding: const EdgeInsets.symmetric(
                      vertical: NoboSpace.md,
                    ),
                  ),
                ),
                if (suffix != null) suffix!,
              ],
            ),
          ),
          if (errorText != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              errorText!,
              style: NoboType.caption.copyWith(color: c.danger),
            ),
          ],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (label != null) ...<Widget>[
          Text(
            label!.toUpperCase(),
            style: NoboType.micro.copyWith(color: c.inkTertiary),
          ),
          const SizedBox(height: NoboSpace.sm),
        ],
        TextField(
          controller: controller,
          focusNode: focusNode,
          obscureText: obscure,
          keyboardType: keyboardType,
          textCapitalization: textCapitalization,
          onSubmitted: onSubmitted,
          onChanged: onChanged,
          maxLines: maxLines,
          autofocus: autofocus,
          enabled: enabled,
          style: NoboType.body.copyWith(color: c.ink),
          cursorColor: c.primary,
          decoration: InputDecoration(
            hintText: hint,
            errorText: errorText,
            prefixIcon: prefixIcon == null
                ? null
                : Icon(prefixIcon, size: 19, color: c.inkTertiary),
            suffixIcon: suffix,
          ),
        ),
      ],
    );
  }
}

/// Two-to-four option switch. Android uses Material's segmented button; iOS uses
/// the sliding segmented control — both are the native affordance users know.
class NoboSegmented<T extends Object> extends StatelessWidget {
  const NoboSegmented({
    required this.segments,
    required this.selected,
    required this.onChanged,
    super.key,
  });

  final List<({T value, String label})> segments;
  final T selected;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    if (NoboPlatform.isIOS) {
      return CupertinoSlidingSegmentedControl<T>(
        groupValue: selected,
        backgroundColor: c.surfaceSunken,
        thumbColor: c.surface,
        padding: const EdgeInsets.all(2),
        children: <T, Widget>{
          for (final ({T value, String label}) s in segments)
            s.value: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                s.label,
                style: NoboType.label.copyWith(
                  fontSize: 13,
                  color: s.value == selected ? c.ink : c.inkSecondary,
                ),
              ),
            ),
        },
        onValueChanged: (T? v) {
          if (v != null) onChanged(v);
        },
      );
    }

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: c.surfaceSunken,
        borderRadius: BorderRadius.circular(NoboRadius.sm),
      ),
      child: Row(
        children: <Widget>[
          for (final ({T value, String label}) s in segments)
            Expanded(
              child: Semantics(
                selected: s.value == selected,
                button: true,
                child: GestureDetector(
                  onTap: () => onChanged(s.value),
                  behavior: HitTestBehavior.opaque,
                  child: AnimatedContainer(
                    duration: NoboMotion.fast,
                    curve: NoboMotion.standard,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: s.value == selected
                          ? c.surface
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(NoboRadius.xs),
                      boxShadow: s.value == selected
                          ? NoboElevation.low
                          : NoboElevation.none,
                    ),
                    child: Center(
                      child: Text(
                        s.label,
                        style: NoboType.label.copyWith(
                          fontSize: 13,
                          color: s.value == selected
                              ? c.ink
                              : c.inkSecondary,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Small semantic label. Tone maps to the palette's meaning, not to raw colour
/// names, so "positive" always reads as success across the app.
enum NoboPillTone { neutral, brand, positive, caution, danger, credit, accent }

class NoboPill extends StatelessWidget {
  const NoboPill({
    required this.label,
    this.tone = NoboPillTone.neutral,
    this.icon,
    this.dense = false,
    super.key,
  });

  final String label;
  final NoboPillTone tone;
  final IconData? icon;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final (Color fg, Color bg) = switch (tone) {
      NoboPillTone.brand => (c.primary, c.primaryWash),
      NoboPillTone.positive => (c.positive, c.positiveWash),
      NoboPillTone.caution => (c.caution, c.cautionWash),
      NoboPillTone.danger => (c.danger, c.dangerWash),
      NoboPillTone.credit => (c.credit, c.creditWash),
      NoboPillTone.accent => (c.accent, c.accentWash),
      NoboPillTone.neutral => (c.inkSecondary, c.surfaceSunken),
    };

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 7 : 9,
        vertical: dense ? 3 : 4,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: NoboRadius.rPill,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: dense ? 10 : 12, color: fg),
            const SizedBox(width: 4),
          ],
          // Flexible + ellipsis: a pill holding a long stage name ("Meeting
          // Scheduled") must shrink rather than overflow its Row when the user
          // has raised their text size.
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: NoboType.micro.copyWith(
                color: fg,
                fontSize: dense ? 10 : 10.5,
                letterSpacing: 0.3,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Numeric count bubble, used on tab icons.
class NoboBadge extends StatelessWidget {
  const NoboBadge({required this.count, this.color, super.key});

  final int count;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return const SizedBox.shrink();
    final NoboColors c = context.nobo;
    final String text = count > 99 ? '99+' : '$count';
    return Container(
      constraints: const BoxConstraints(minWidth: 17),
      height: 17,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      decoration: BoxDecoration(
        color: color ?? c.accent,
        borderRadius: NoboRadius.rPill,
        border: Border.all(color: c.surface, width: 1.5),
      ),
      child: Center(
        child: Text(
          text,
          style: NoboType.micro.copyWith(
            fontSize: 9.5,
            letterSpacing: 0,
            color: Colors.white,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
