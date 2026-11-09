import 'package:flutter/material.dart';

import '../../data/repositories/auth_repository.dart';
import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import 'controls.dart';
import 'orbit_mark.dart';

/// Shimmering placeholder block. Skeletons must match the real layout's
/// geometry, otherwise the content visibly jumps when it arrives.
class NoboSkeleton extends StatefulWidget {
  const NoboSkeleton({
    this.width,
    this.height = 14,
    this.radius = NoboRadius.xs,
    super.key,
  });

  final double? width;
  final double height;
  final double radius;

  @override
  State<NoboSkeleton> createState() => _NoboSkeletonState();
}

class _NoboSkeletonState extends State<NoboSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final bool reduceMotion =
        MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    // A perpetually repeating controller would keep `pumpAndSettle` spinning
    // forever in tests, and would ignore the user's reduce-motion preference.
    if (reduceMotion) {
      if (_c.isAnimating) _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors n = context.nobo;
    // Respect the OS "reduce motion" preference: no shimmer, just a flat block.
    final bool reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;

    return AnimatedBuilder(
      animation: _c,
      builder: (BuildContext context, Widget? child) {
        if (reduceMotion) {
          return _box(n.skeleton);
        }
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (Rect bounds) {
            final double t = _c.value;
            return LinearGradient(
              begin: Alignment(-1.5 + t * 3, -0.4),
              end: Alignment(-0.5 + t * 3, 0.4),
              colors: <Color>[
                n.skeleton,
                n.skeletonHighlight,
                n.skeleton,
              ],
              stops: const <double>[0.25, 0.5, 0.75],
            ).createShader(bounds);
          },
          child: _box(n.skeleton),
        );
      },
    );
  }

  Widget _box(Color color) => Container(
    width: widget.width,
    height: widget.height,
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(widget.radius),
    ),
  );
}

/// Empty state that actually helps: an explanation, a reason, and one action.
/// The brief calls these out as a failure mode when generic, so they are
/// authored per screen rather than reused with different strings.
class NoboEmptyState extends StatelessWidget {
  const NoboEmptyState({
    required this.title,
    required this.message,
    this.icon,
    this.actionLabel,
    this.onAction,
    this.compact = false,
    super.key,
  });

  final String title;
  final String message;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Center(
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: NoboSpace.xl,
          vertical: compact ? NoboSpace.xl : NoboSpace.huge,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (icon != null)
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: c.primaryWash,
                  borderRadius: BorderRadius.circular(NoboRadius.md),
                ),
                child: Icon(icon, size: 24, color: c.primary),
              )
            else
              const OrbitMark(size: 46),
            const SizedBox(height: NoboSpace.lg),
            Text(
              title,
              textAlign: TextAlign.center,
              style: NoboType.subtitle.copyWith(color: c.ink),
            ),
            const SizedBox(height: NoboSpace.sm),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 320),
              child: Text(
                message,
                textAlign: TextAlign.center,
                style: NoboType.body.copyWith(color: c.inkSecondary),
              ),
            ),
            if (actionLabel != null) ...<Widget>[
              const SizedBox(height: NoboSpace.xl),
              NoboButton(
                label: actionLabel!,
                onPressed: onAction,
                variant: NoboButtonVariant.tonal,
                size: NoboButtonSize.small,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Error state driven by the app's typed failures, so the copy is specific
/// ("you're offline") instead of the usual "something went wrong".
class NoboErrorState extends StatelessWidget {
  const NoboErrorState({required this.error, this.onRetry, super.key});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final NoboFailure f = mapError(error);

    final (IconData icon, String title) = switch (f.kind) {
      NoboFailureKind.offline => (Icons.wifi_off_rounded, 'You are offline'),
      NoboFailureKind.unauthorized => (Icons.lock_outline, 'Session expired'),
      NoboFailureKind.forbidden => (Icons.shield_outlined, 'Not available'),
      NoboFailureKind.notFound => (Icons.search_off_rounded, 'Not found'),
      NoboFailureKind.rateLimited => (
        Icons.hourglass_bottom_rounded,
        'Slow down a moment',
      ),
      NoboFailureKind.server => (Icons.cloud_off_rounded, 'Server problem'),
      NoboFailureKind.invalidCredentials => (
        Icons.key_off_outlined,
        'Sign-in failed',
      ),
      NoboFailureKind.unknown => (Icons.error_outline_rounded, 'Something broke'),
    };

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(NoboSpace.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: c.dangerWash,
                borderRadius: BorderRadius.circular(NoboRadius.md),
              ),
              child: Icon(icon, size: 24, color: c.danger),
            ),
            const SizedBox(height: NoboSpace.lg),
            Text(title, style: NoboType.subtitle.copyWith(color: c.ink)),
            const SizedBox(height: NoboSpace.sm),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 320),
              child: Text(
                f.message,
                textAlign: TextAlign.center,
                style: NoboType.body.copyWith(color: c.inkSecondary),
              ),
            ),
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: NoboSpace.xl),
              NoboButton(
                label: 'Try again',
                onPressed: onRetry,
                variant: NoboButtonVariant.tonal,
                size: NoboButtonSize.small,
                icon: Icons.refresh_rounded,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Full-screen brand loading state. Uses the orbit mark rather than a spinner.
class NoboLoading extends StatelessWidget {
  const NoboLoading({this.label, super.key});

  final String? label;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const OrbitMark(size: 46, active: true),
          if (label != null) ...<Widget>[
            const SizedBox(height: NoboSpace.base),
            Text(
              label!,
              style: NoboType.caption.copyWith(color: c.inkTertiary),
            ),
          ],
        ],
      ),
    );
  }
}

/// Inline, non-blocking error strip for a failed side action.
class NoboInlineError extends StatelessWidget {
  const NoboInlineError({required this.message, this.onDismiss, super.key});

  final String message;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: NoboSpace.md,
        vertical: NoboSpace.sm,
      ),
      decoration: BoxDecoration(
        color: c.dangerWash,
        borderRadius: NoboRadius.rSm,
        border: Border.all(color: c.danger.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.error_outline_rounded, size: 16, color: c.danger),
          const SizedBox(width: NoboSpace.sm),
          Expanded(
            child: Text(
              message,
              style: NoboType.caption.copyWith(color: c.danger),
            ),
          ),
          if (onDismiss != null)
            GestureDetector(
              onTap: onDismiss,
              child: Icon(Icons.close_rounded, size: 15, color: c.danger),
            ),
        ],
      ),
    );
  }
}

/// Thin determinate progress meter used for agent execution.
class NoboProgressBar extends StatelessWidget {
  const NoboProgressBar({required this.value, this.height = 4, super.key});

  final double value;
  final double height;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return ClipRRect(
      borderRadius: NoboRadius.rPill,
      child: SizedBox(
        height: height,
        child: Stack(
          children: <Widget>[
            Container(color: c.surfaceSunken),
            FractionallySizedBox(
              widthFactor: value.clamp(0.0, 1.0),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: <Color>[c.primary, c.primary.withValues(alpha: 0.65)],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}