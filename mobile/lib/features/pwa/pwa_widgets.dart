import 'package:flutter/material.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/platform/nobo_platform.dart';
import '../../core/ui/nobo_mark_loader.dart';

/// Reusable pieces that reproduce the web app's component vocabulary.
///
/// Every value here is taken from the running PWA: white cards with a
/// slate-200 hairline and `shadow-sm`, pill buttons, uppercase micro labels,
/// light-blue tinted icon circles. Screens compose these rather than inventing
/// their own styling, which is what keeps the port visually identical.

/// The white bordered card used for essentially every grouped surface.
class PwaCard extends StatelessWidget {
  const PwaCard({
    required this.child,
    this.padding = const EdgeInsets.all(NoboSpace.base),
    this.onTap,
    this.radius = NoboRadius.lg,
    this.color,
    this.border = true,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final double radius;
  final Color? color;
  final bool border;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final BorderRadius br = BorderRadius.circular(radius);

    final Widget surface = Container(
      decoration: BoxDecoration(
        color: color ?? c.surface,
        borderRadius: br,
        border: border ? Border.all(color: c.border) : null,
        boxShadow: NoboElevation.low,
      ),
      padding: padding,
      child: child,
    );

    if (onTap == null) return surface;

    final Widget tappable = NoboPlatform.isAndroid
        ? Material(
            color: Colors.transparent,
            borderRadius: br,
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap,
              borderRadius: br,
              splashFactory: InkSparkle.splashFactory,
              child: surface,
            ),
          )
        : GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: surface,
          );

    return ClipRRect(borderRadius: br, child: tappable);
  }
}

/// Uppercase micro label — "TOTAL LEADS", "IMAGES SENT TO IMAGE MODEL (1/16)".
class PwaLabel extends StatelessWidget {
  const PwaLabel(this.text, {this.color, super.key});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: NoboType.micro.copyWith(
        color: color ?? context.nobo.inkTertiary,
        fontSize: 10.5,
        letterSpacing: 0.7,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

/// Full-width primary action: blue pill with a leading icon, as "+ Add Product".
class PwaPrimaryButton extends StatelessWidget {
  const PwaPrimaryButton({
    required this.label,
    this.onPressed,
    this.icon,
    this.trailing,
    this.loading = false,
    this.dark = false,
    this.height = 48,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Widget? trailing;
  final bool loading;

  /// The web app also uses a near-black pill for primary actions such as
  /// "Upload Assets" and "Enable Now".
  final bool dark;
  final double height;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool enabled = onPressed != null && !loading;

    final Color bg = dark
        ? (enabled ? c.navy : c.surfaceSunken)
        : (enabled ? c.primary : c.surfaceSunken);
    final Color fg = dark
        ? (enabled ? c.onNavy : c.inkTertiary)
        : (enabled ? c.onPrimary : c.inkTertiary);

    final Widget content = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        if (loading)
          NoboMarkLoader(
            size: 17,
            color: fg,
            semanticLabel: '$label, working',
          )
        else if (icon != null)
          Icon(icon, size: 18, color: fg),
        if (loading || icon != null) const SizedBox(width: NoboSpace.sm),
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: NoboType.label.copyWith(
              color: fg,
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        if (trailing != null) ...<Widget>[
          const SizedBox(width: NoboSpace.sm),
          trailing!,
        ],
      ],
    );

    final Widget body = Container(
      height: height,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: NoboSpace.lg),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: NoboRadius.rPill,
        boxShadow: enabled && !dark ? NoboElevation.glow(c.primary) : null,
      ),
      child: content,
    );

    final Widget tappable = NoboPlatform.isAndroid
        ? Material(
            color: Colors.transparent,
            borderRadius: NoboRadius.rPill,
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: enabled ? onPressed : null,
              borderRadius: NoboRadius.rPill,
              splashFactory: InkSparkle.splashFactory,
              child: body,
            ),
          )
        : GestureDetector(
            onTap: enabled ? onPressed : null,
            behavior: HitTestBehavior.opaque,
            child: body,
          );

    return SizedBox(width: double.infinity, child: tappable);
  }
}

/// Filter pill. The web app fills the active pill dark navy and outlines the
/// rest — "All / Images / Videos / Campaign Ready".
class PwaFilterPill extends StatelessWidget {
  const PwaFilterPill({
    required this.label,
    required this.selected,
    required this.onTap,
    this.count,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final Color bg = selected ? c.navy : c.surface;
    final Color fg = selected ? c.onNavy : c.inkSecondary;

    final Widget body = Container(
      padding: const EdgeInsets.symmetric(
        horizontal: NoboSpace.base,
        vertical: 9,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: NoboRadius.rPill,
        border: Border.all(color: selected ? Colors.transparent : c.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            label,
            style: NoboType.label.copyWith(
              color: fg,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (count != null) ...<Widget>[
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: selected
                    ? Colors.white.withValues(alpha: 0.22)
                    : c.surfaceSunken,
                borderRadius: NoboRadius.rPill,
              ),
              child: Text(
                count! > 999 ? '${(count! / 1000).toStringAsFixed(1)}k' : '$count',
                style: NoboType.caption.copyWith(
                  color: fg,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ],
      ),
    );

    return GestureDetector(onTap: onTap, behavior: HitTestBehavior.opaque, child: body);
  }
}

/// Rounded search field with a leading magnifier, as used on Catalog and CRM.
class PwaSearchField extends StatelessWidget {
  const PwaSearchField({
    required this.hint,
    this.controller,
    this.onChanged,
    this.onSubmitted,
    this.trailing,
    super.key,
  });

  final String hint;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: NoboRadius.rLg,
        border: Border.all(color: c.border),
      ),
      padding: const EdgeInsets.symmetric(horizontal: NoboSpace.base),
      child: Row(
        children: <Widget>[
          Icon(Icons.search_rounded, size: 19, color: c.inkTertiary),
          const SizedBox(width: NoboSpace.sm),
          Expanded(
            child: TextField(
              maxLines: 1,
              textAlignVertical: TextAlignVertical.center,
              controller: controller,
              onChanged: onChanged,
              onSubmitted: onSubmitted,
              style: NoboType.body.copyWith(color: c.ink, fontSize: 14.5),
              cursorColor: c.primary,
              decoration: InputDecoration(
                isDense: true,
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
                hintText: hint,
                hintStyle: NoboType.body.copyWith(
                  color: c.inkTertiary,
                  fontSize: 14.5,
                ),
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// A dashboard metric tile: uppercase label, large colour-coded value, tinted
/// icon circle, and a blue "Click to view list →" affordance.
class PwaStatTile extends StatelessWidget {
  const PwaStatTile({
    required this.label,
    required this.value,
    required this.tint,
    this.icon,
    this.linkLabel = 'Click to view list',
    this.onTap,
    this.badge,
    this.suffix,
    super.key,
  });

  final String label;
  final String value;
  final Color tint;
  final IconData? icon;
  final String linkLabel;
  final VoidCallback? onTap;
  final Widget? badge;

  /// Small trailing detail in the label, e.g. a flag count "(⚑ 0)".
  final String? suffix;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return PwaCard(
      onTap: onTap,
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Row(
                  children: <Widget>[
                    Flexible(
                      child: Text(
                        label.toUpperCase(),
                        style: NoboType.micro.copyWith(
                          color: c.inkTertiary,
                          fontSize: 10,
                          letterSpacing: 0.6,
                          fontWeight: FontWeight.w700,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (suffix != null) ...<Widget>[
                      const SizedBox(width: 4),
                      Text(
                        suffix!,
                        style: NoboType.caption.copyWith(
                          color: c.inkTertiary,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (badge != null) badge!,
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              Expanded(
                child: Text(
                  value,
                  style: NoboType.numeric(
                    NoboType.headline.copyWith(
                      color: tint,
                      fontSize: 28,
                      fontWeight: FontWeight.w700,
                      height: 1.05,
                    ),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (icon != null)
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: tint.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, size: 17, color: tint),
                ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              Flexible(
                child: Text(
                  linkLabel,
                  style: NoboType.caption.copyWith(
                    color: c.primary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 3),
              Icon(Icons.arrow_forward_rounded, size: 12, color: c.primary),
            ],
          ),
        ],
      ),
    );
  }
}

/// Row with an uppercase label and a switch, as on the Catalog product card.
class PwaToggleRow extends StatelessWidget {
  const PwaToggleRow({
    required this.label,
    required this.value,
    this.onChanged,
    this.icon,
    super.key,
  });

  final String label;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 15, color: c.inkTertiary),
            const SizedBox(width: NoboSpace.sm),
          ],
          Expanded(
            child: Text(
              label.toUpperCase(),
              style: NoboType.micro.copyWith(
                color: c.inkSecondary,
                fontSize: 10.5,
                letterSpacing: 0.6,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          SizedBox(
            width: 46,
            child: Switch(
              value: value,
              onChanged: onChanged,
              activeThumbColor: Colors.white,
              activeTrackColor: c.primary,
              inactiveThumbColor: Colors.white,
              inactiveTrackColor: c.surfaceSunken,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        ],
      ),
    );
  }
}

/// Small tinted circular action button (edit / delete / call / chat).
class PwaIconCircle extends StatelessWidget {
  const PwaIconCircle({
    required this.icon,
    this.onTap,
    this.tint,
    this.size = 36,
    this.tooltip,
    this.filled = true,
    super.key,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final Color? tint;
  final double size;
  final String? tooltip;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final Color tone = tint ?? c.inkSecondary;

    final Widget body = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: filled ? tone.withValues(alpha: 0.10) : c.surface,
        shape: BoxShape.circle,
        border: filled ? null : Border.all(color: c.border),
      ),
      child: Icon(icon, size: size * 0.46, color: tone),
    );

    final Widget tappable = NoboPlatform.isAndroid
        ? Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap,
              customBorder: const CircleBorder(),
              child: body,
            ),
          )
        : GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: body,
          );

    final Widget result = SizedBox(width: size, height: size, child: tappable);
    return tooltip == null ? result : Tooltip(message: tooltip!, child: result);
  }
}

/// Rounded select dropdown matching the web app's "All Products" control.
class PwaSelect extends StatelessWidget {
  const PwaSelect({
    required this.label,
    this.value,
    this.icon,
    this.onTap,
    super.key,
  });

  final String label;
  final String? value;
  final IconData? icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return PwaCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: NoboSpace.base,
        vertical: 13,
      ),
      radius: NoboRadius.lg,
      child: Row(
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 17, color: c.inkTertiary),
            const SizedBox(width: NoboSpace.sm),
          ],
          Expanded(
            child: Text(
              value ?? label,
              style: NoboType.body.copyWith(color: c.ink, fontSize: 14.5),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Icon(Icons.expand_more_rounded, size: 20, color: c.inkTertiary),
        ],
      ),
    );
  }
}

/// Full-screen loader: the Nobogent mark in motion with a caption beneath.
///
/// Every screen that waits on the network uses this, so a slow query looks like
/// this product thinking rather than like a generic spinner.
class PwaLoading extends StatelessWidget {
  const PwaLoading({this.label = 'Loading…', super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return NoboMarkLoading(label: label);
  }
}
