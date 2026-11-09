import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import '../platform/nobo_platform.dart';

/// Page background. Owns the canvas colour so every screen is consistent, and
/// lets content paint edge-to-edge behind the system bars on Android.
class NoboPage extends StatelessWidget {
  const NoboPage({
    required this.child,
    this.padded = true,
    this.background,
    super.key,
  });

  final Widget child;
  final bool padded;
  final Color? background;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return DecoratedBox(
      decoration: BoxDecoration(color: background ?? c.canvas),
      child: padded
          ? Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              child: child,
            )
          : child,
    );
  }
}

/// The base content surface.
///
/// Separation is carried by a hairline plus a very soft shadow — not by a
/// heavy card with a coloured border. This is what keeps a dense screen from
/// looking like a bootstrap admin panel.
class NoboCard extends StatelessWidget {
  const NoboCard({
    required this.child,
    this.padding = const EdgeInsets.all(NoboSpace.base),
    this.onTap,
    this.onLongPress,
    this.radius = NoboRadius.lg,
    this.color,
    this.border = true,
    this.elevated = false,
    this.clip = true,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double radius;
  final Color? color;
  final bool border;
  final bool elevated;
  final bool clip;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final BorderRadius br = BorderRadius.circular(radius);

    final Widget surface = DecoratedBox(
      decoration: BoxDecoration(
        color: color ?? c.surface,
        borderRadius: br,
        border: border ? Border.all(color: c.border) : null,
        boxShadow: elevated ? NoboElevation.medium : NoboElevation.none,
      ),
      child: Padding(padding: padding, child: child),
    );

    if (onTap == null && onLongPress == null) {
      return clip ? ClipRRect(borderRadius: br, child: surface) : surface;
    }

    return ClipRRect(
      borderRadius: br,
      child: _NoboTappable(
        onTap: onTap,
        onLongPress: onLongPress,
        child: surface,
      ),
    );
  }
}

/// Platform-correct touch feedback.
///
/// Android gets a Material ink ripple; iOS gets the scale-and-dip behaviour
/// users expect from a UIKit cell. Using one for both is the single fastest way
/// to make an app feel foreign on the other platform.
class _NoboTappable extends StatefulWidget {
  const _NoboTappable({
    required this.child,
    this.onTap,
    this.onLongPress,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  State<_NoboTappable> createState() => _NoboTappableState();
}

class _NoboTappableState extends State<_NoboTappable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    if (NoboPlatform.isAndroid) {
      return Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onTap,
          onLongPress: widget.onLongPress,
          splashFactory: InkSparkle.splashFactory,
          child: widget.child,
        ),
      );
    }

    return GestureDetector(
      onTapDown: (_) => setState(() => _down = true),
      onTapCancel: () => setState(() => _down = false),
      onTapUp: (_) => setState(() => _down = false),
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      behavior: HitTestBehavior.opaque,
      child: AnimatedScale(
        scale: _down ? 0.985 : 1,
        duration: NoboMotion.instant,
        curve: NoboMotion.standard,
        child: AnimatedOpacity(
          opacity: _down ? 0.82 : 1,
          duration: NoboMotion.instant,
          child: widget.child,
        ),
      ),
    );
  }
}

/// Section heading: small tracked eyebrow + optional trailing action.
///
/// Eyebrows give a dense screen structure without adding cards or borders.
class NoboSectionHeader extends StatelessWidget {
  const NoboSectionHeader({
    required this.title,
    this.eyebrow,
    this.action,
    this.onAction,
    this.padding = const EdgeInsets.only(
      bottom: NoboSpace.md,
      top: NoboSpace.xl,
    ),
    super.key,
  });

  final String title;
  final String? eyebrow;
  final String? action;
  final VoidCallback? onAction;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (eyebrow != null) ...<Widget>[
                  Text(
                    eyebrow!.toUpperCase(),
                    style: NoboType.micro.copyWith(color: c.inkTertiary),
                  ),
                  const SizedBox(height: 6),
                ],
                Text(title, style: NoboType.headline.copyWith(color: c.ink)),
              ],
            ),
          ),
          if (action != null)
            _TextAction(label: action!, onTap: onAction),
        ],
      ),
    );
  }
}

class _TextAction extends StatelessWidget {
  const _TextAction({required this.label, this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Semantics(
      button: true,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: NoboRadius.rXs,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: NoboSpace.sm,
            vertical: NoboSpace.sm,
          ),
          child: Text(
            label,
            style: NoboType.label.copyWith(color: c.primary),
          ),
        ),
      ),
    );
  }
}

/// A label/value pair for metadata rows.
class NoboMetaRow extends StatelessWidget {
  const NoboMetaRow({
    required this.label,
    required this.value,
    this.icon,
    super.key,
  });

  final String label;
  final String value;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: NoboSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 15, color: c.inkTertiary),
            const SizedBox(width: NoboSpace.sm),
          ],
          SizedBox(
            width: 108,
            child: Text(
              label,
              style: NoboType.caption.copyWith(color: c.inkTertiary),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: NoboType.body.copyWith(color: c.ink),
            ),
          ),
        ],
      ),
    );
  }
}

/// Hairline divider that respects the design's very low contrast.
class NoboDivider extends StatelessWidget {
  const NoboDivider({this.indent = 0, this.vertical = NoboSpace.base, super.key});

  final double indent;
  final double vertical;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: EdgeInsets.symmetric(vertical: vertical),
      child: Container(
        height: 1,
        margin: EdgeInsets.only(left: indent),
        color: c.hairline,
      ),
    );
  }
}
