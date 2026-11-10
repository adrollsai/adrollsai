import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_mark_geometry.dart';

/// The Nobogent mark as a loading indicator.
///
/// The same geometry the splash and the app icon use, so a screen that is
/// fetching data still looks like this product rather than like every other
/// Material app waiting on a network call. It is deliberately not the platform
/// spinner: an indefinite circular progress indicator is the single most
/// generic thing an app can draw, and it appears exactly when the owner is
/// staring at the screen.
///
/// The motion is a highlight travelling the ring arc — the identity's own
/// gesture — with the core breathing gently underneath. Cheap enough to run
/// per list row: no blur, no shadows, one arc plus a handful of circles.
class NoboMarkLoader extends StatefulWidget {
  const NoboMarkLoader({
    this.size = 26,
    this.color,
    this.semanticLabel = 'Loading',
    super.key,
  });

  /// Width and height of the mark. Anything under ~18 px loses the arc.
  final double size;

  /// Overrides the brand violet — used when the loader sits on a filled button
  /// or a dark plate.
  final Color? color;

  final String semanticLabel;

  @override
  State<NoboMarkLoader> createState() => _NoboMarkLoaderState();
}

class _NoboMarkLoaderState extends State<NoboMarkLoader>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  );

  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    // Reduced motion still needs a busy signal, just not a moving one: the
    // static mark carries it, and the label says the rest.
    if (!(MediaQuery.maybeDisableAnimationsOf(context) ?? false)) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final Color tint = widget.color ?? NoboSplashInk.violet;

    return Semantics(
      label: widget.semanticLabel,
      liveRegion: true,
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: RepaintBoundary(
          child: AnimatedBuilder(
            animation: _controller,
            builder: (BuildContext context, Widget? _) => CustomPaint(
              painter: _NoboMarkLoaderPainter(
                progress: _controller.value,
                tint: tint,
                detailed: widget.size >= 44,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Brand constants the loader shares with the splash.
abstract final class NoboSplashInk {
  const NoboSplashInk._();

  /// `NoboColors` carries the app palette, but the loader must stay on-brand
  /// wherever it is placed, including outside a themed subtree.
  static const Color violet = Color(0xFF6D5BF0);
  static const Color ring = Color(0xFF4B47D4);
}

class _NoboMarkLoaderPainter extends CustomPainter {
  _NoboMarkLoaderPainter({
    required this.progress,
    required this.tint,
    required this.detailed,
  });

  final double progress;
  final Color tint;

  /// Draws the full dot field. Off at small sizes, where the dots land under a
  /// pixel each and only muddy the silhouette.
  final bool detailed;

  static const double _arcStart = NoboMark.arcStartDeg * math.pi / 180.0;
  static const double _arcSweep = NoboMark.arcSweepDeg * math.pi / 180.0;
  static const double _headSweep = 1.15;

  @override
  void paint(Canvas canvas, Size size) {
    final double u = size.shortestSide / (2 * NoboMark.extent);
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);

    // Breathing core: a 4% swell, well under the threshold that reads as a
    // layout jump.
    final double breath = 1 + 0.04 * math.sin(progress * 2 * math.pi);

    if (detailed) {
      final Paint dotPaint = Paint();
      for (final NoboMarkDot d in NoboMark.dots) {
        // The field twinkles: each dot peaks a fraction of a cycle after its
        // neighbour, which keeps the mark alive without moving it.
        final double phase = (progress + d.delay) % 1.0;
        final double ease = 0.55 + 0.45 * math.sin(phase * 2 * math.pi);
        dotPaint.color = Color(d.color).withValues(alpha: ease);
        canvas.drawCircle(Offset(d.x * u, d.y * u), d.r * u, dotPaint);
      }
    }

    final Rect ring = Rect.fromCircle(center: Offset.zero, radius: u);
    final Paint stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = NoboMark.ringStroke * u
      ..strokeCap = StrokeCap.round;

    // The dormant ring, so the mark is whole even mid-sweep.
    stroke.color = tint.withValues(alpha: detailed ? 0.22 : 0.28);
    canvas.drawArc(ring, _arcStart, _arcSweep, false, stroke);

    // The travelling highlight, eased so it does not step at the wrap. Twice per
    // cycle keeps the sweep brisk without making it a blur at small sizes.
    final double travel = Curves.easeInOut.transform((progress * 2) % 1.0);
    stroke
      ..color = tint
      ..strokeWidth = NoboMark.ringStroke * u * 1.15;
    canvas.drawArc(
      ring,
      _arcStart + _arcSweep * travel,
      _arcSweep > _headSweep ? _headSweep : _arcSweep,
      false,
      stroke,
    );

    // Core, lit from the top-left exactly as the splash lights it.
    final double coreR = NoboMark.coreRadius * breath * u;
    canvas.drawCircle(
      Offset.zero,
      coreR,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(-0.22, -0.30),
          radius: 0.95,
          colors: <Color>[
            tint,
            Color.lerp(tint, const Color(0xFF3F2FBE), 0.55)!,
          ],
        ).createShader(Rect.fromCircle(center: Offset.zero, radius: coreR)),
    );

    // The satellite orbits the core, doubling the read of motion.
    final double orbit = progress * 2 * math.pi;
    canvas.drawCircle(
      Offset(
        NoboMark.satelliteX * u * math.cos(orbit) -
            NoboMark.satelliteY * u * math.sin(orbit),
        NoboMark.satelliteX * u * math.sin(orbit) +
            NoboMark.satelliteY * u * math.cos(orbit),
      ),
      NoboMark.satelliteRadius * u,
      Paint()..color = const Color(NoboMark.satelliteColor),
    );

    canvas.restore();
  }

  @override
  bool shouldRepaint(_NoboMarkLoaderPainter old) =>
      old.progress != progress || old.tint != tint || old.detailed != detailed;
}

/// Convenience: the loader with the app's standard caption underneath.
class NoboMarkLoading extends StatelessWidget {
  const NoboMarkLoading({
    this.label = 'Loading…',
    this.size = 28,
    super.key,
  });

  final String label;
  final double size;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          NoboMarkLoader(size: size, semanticLabel: label),
          const SizedBox(height: 14),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w500,
              letterSpacing: 0.1,
              color: c.inkTertiary,
            ),
          ),
        ],
      ),
    );
  }
}
