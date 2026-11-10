import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';

/// The Nobogent orbital mark, drawn as live vector art.
///
/// The logomark is a dotted spiral with an inner ring and a solid core. Drawing
/// it rather than shipping a bitmap means it can animate — which is how the app
/// signals "the agent is thinking" without resorting to a generic spinner.
///
/// [progress] drives rotation (0..1). When [active] is true the mark rotates
/// continuously; when false it rests at [progress].
class OrbitMark extends StatefulWidget {
  const OrbitMark({
    required this.size,
    this.active = false,
    this.progress,
    this.color,
    this.secondaryColor,
    this.duration = const Duration(milliseconds: 2200),
    super.key,
  });

  final double size;

  /// Whether the mark should spin (agent working).
  final bool active;

  /// Optional fixed rotation 0..1 (used by golden tests for determinism).
  final double? progress;

  final Color? color;
  final Color? secondaryColor;
  final Duration duration;

  @override
  State<OrbitMark> createState() => _OrbitMarkState();
}

class _OrbitMarkState extends State<OrbitMark>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: widget.duration,
  );

  @override
  void initState() {
    super.initState();
  }

  bool _reduceMotion = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Honour the OS "reduce motion" accessibility setting. This also makes the
    // widget deterministic under test, where an endless animation would stop
    // `pumpAndSettle` from ever settling.
    _reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    _syncSpin();
  }

  void _syncSpin() {
    final bool shouldSpin =
        widget.active && widget.progress == null && !_reduceMotion;
    if (shouldSpin && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!shouldSpin && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void didUpdateWidget(OrbitMark old) {
    super.didUpdateWidget(old);
    _syncSpin();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final Color primary = widget.color ?? c.primary;
    final Color secondary = widget.secondaryColor ?? NoboBrand.blue500;

    Widget painterAt(double t) => CustomPaint(
      size: Size.square(widget.size),
      painter: _OrbitPainter(
        rotation: t,
        primary: primary,
        secondary: secondary,
        core: c.primary,
      ),
    );

    if (widget.progress != null) {
      return painterAt(widget.progress!);
    }

    if (!widget.active) {
      return painterAt(0);
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (BuildContext context, Widget? child) =>
          painterAt(_controller.value),
    );
  }
}

class _OrbitPainter extends CustomPainter {
  _OrbitPainter({
    required this.rotation,
    required this.primary,
    required this.secondary,
    required this.core,
  });

  final double rotation;
  final Color primary;
  final Color secondary;
  final Color core;

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = size.center(Offset.zero);
    final double extent = size.shortestSide / 2;
    final double inkWeight = size.shortestSide / 24;

    // --- Dotted spiral -----------------------------------------------------
    // Two contrasted arcs: a dense bright wisp and a sparse cool one, matching
    // the logomark's tonal split.
    const int total = 58;
    for (int i = 0; i < total; i++) {
      final double t = i / total;
      final double angle = t * math.pi * 2.0 * 1.9 + rotation * math.pi * 2;
      // Radial breathing creates the wisp rather than a uniform ring.
      final double band = 0.74 + 0.26 * math.sin(t * math.pi);
      final double radius = extent * band;
      final Offset p = Offset(
        center.dx + math.cos(angle) * radius,
        center.dy + math.sin(angle) * radius,
      );
      // Dots shrink toward the tails.
      final double taper = math.sin(t * math.pi).clamp(0.0, 1.0);
      final double dotR = inkWeight * (0.18 + 0.52 * taper);
      final Color dotColor = Color.lerp(
        secondary,
        primary,
        taper,
      )!.withValues(alpha: 0.25 + 0.75 * taper);
      canvas.drawCircle(p, dotR, Paint()..color = dotColor);
    }

    // --- Inner ring with a gap --------------------------------------------
    final double ringR = extent * 0.5;
    final Rect ringRect = Rect.fromCircle(center: center, radius: ringR);
    final Paint ringPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = inkWeight * 0.62
      ..strokeCap = StrokeCap.round;

    // Sweep the ring so the gap rotates with the mark.
    final double start = -math.pi * 0.62 + rotation * math.pi * 2;
    ringPaint.color = primary;
    canvas.drawArc(ringRect, start, math.pi * 1.42, false, ringPaint);

    // --- Core -------------------------------------------------------------
    canvas.drawCircle(
      center,
      extent * 0.2,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[primary, secondary],
        ).createShader(Rect.fromCircle(center: center, radius: extent * 0.2)),
    );

    // Small satellite dot on the ring, like the logomark's accent.
    final Offset sat = Offset(
      center.dx + math.cos(start) * ringR,
      center.dy + math.sin(start) * ringR,
    );
    canvas.drawCircle(sat, inkWeight * 0.5, Paint()..color = core);
  }

  @override
  bool shouldRepaint(_OrbitPainter old) =>
      old.rotation != rotation ||
      old.primary != primary ||
      old.secondary != secondary;
}

/// Static brand lockup: mark + wordmark, used on the sign-in screen and splash.
class NoboWordmark extends StatelessWidget {
  const NoboWordmark({this.markSize = 54, this.showText = true, super.key});

  final double markSize;
  final bool showText;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        OrbitMark(size: markSize),
        if (showText) ...<Widget>[
          const SizedBox(width: 12),
          Text(
            'nobogent',
            style: TextStyle(
              fontSize: markSize * 0.46,
              height: 1,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.9,
              color: c.ink,
            ),
          ),
        ],
      ],
    );
  }
}
