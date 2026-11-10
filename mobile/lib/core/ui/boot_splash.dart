import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_mark_geometry.dart';

/// The animated Nobogent splash: the orbital mark dissolving into its own dot
/// field and reassembling, then the wordmark rising into place.
///
/// This is the motion of the brand's video sting, rebuilt as live vector art so
/// it is sharp at every pixel density and costs no video decode on cold start.
/// Both draw the same geometry from `nobo_mark_geometry.dart`, so the app and the
/// video can never drift apart.
///
/// It opens on the *formed* lockup — exactly what the native launch screen
/// draws — so the hand-off from the OS splash to Flutter is invisible: the logo
/// is already there, then it comes apart and rebuilds.
///
/// Timings are in seconds and mirror the video's beat map, compressed to fit a
/// cold start. [NoboBootGate] owns the clock.
abstract final class NoboSplashTiming {
  const NoboSplashTiming._();

  /// Total length in milliseconds, including the fade-out.
  static const int totalMs = 1900;

  /// The same length in seconds, which is what every beat below is measured in.
  static const double total = totalMs / 1000.0;

  /// The formed lockup scatters back into particles over this window.
  static const double dissolveStart = 0.00;
  static const double dissolveEnd = 0.26;

  /// The wordmark peels away just ahead of the dot field, left to right.
  static const double letterOutStart = 0.02;
  static const double letterOutStagger = 0.010;
  static const double letterOutEach = 0.14;

  /// The dot field spirals back into place. Each dot starts at
  /// `dotsInStart + delay * dotsInStagger` and takes [dotsInEach] to land.
  static const double dotsInStart = 0.24;
  static const double dotsInStagger = 0.44;
  static const double dotsInEach = 0.40;

  /// The ring arc draws on.
  static const double arcStart = 0.55;
  static const double arcEnd = 0.95;

  /// The satellite launches from the core into the arc's gap.
  static const double satStart = 0.90;
  static const double satEnd = 1.10;

  /// Wordmark letters rise, staggered.
  static const double wordStart = 1.00;
  static const double wordStagger = 0.035;
  static const double wordEach = 0.32;

  /// A highlight glides once around the finished arc.
  static const double glintStart = 1.30;
  static const double glintEnd = 1.52;

  /// The soft halo settles in.
  static const double auraStart = 0.95;
  static const double auraEnd = 1.45;

  /// The splash starts fading to the app here, and is gone at [total].
  static const double fadeStart = 1.58;
}

/// Shared brand values the splash needs. The lockup is always set on the brand's
/// white plate, so its ink does not follow the app theme.
abstract final class NoboSplashBrand {
  const NoboSplashBrand._();

  /// The logotype ink sampled from the shipped logo.
  static const Color logotypeInk = Color(0xFF081327);

  /// The plate the native launch screen draws, in both light and dark mode.
  static const Color plate = Color(0xFFFFFFFF);

  static const Color violet = Color(0xFF6D5BF0);
  static const Color ring = Color(0xFF4B47D4);
}

/// Fraction of the window `[a, b]` elapsed at time [t], eased.
double _window(double t, double a, double b, [Curve curve = Curves.easeOut]) {
  if (t <= a) return 0;
  if (t >= b) return 1;
  return curve.transform((t - a) / (b - a));
}

/// The splash's visual, driven by [t] (seconds since boot).
///
/// It is a plain widget rather than the owner of a controller so the gate can
/// drive one clock for the mark, the wordmark and the fade together.
class NoboBootSplash extends StatelessWidget {
  const NoboBootSplash({
    required this.t,
    required this.background,
    this.showDomain = false,
    super.key,
  });

  /// Seconds elapsed since the splash began.
  final double t;

  /// Colour behind the lockup. The gate lerps this from the brand's white plate
  /// to the app's canvas, so a dark-mode user is not flashed by a hard cut.
  final Color background;

  /// Whether the lockup includes ".com".
  ///
  /// Off in the app: a splash introducing the product reads better as the name
  /// alone. On when the same widget should double as the video's end card.
  final bool showDomain;

  @override
  Widget build(BuildContext context) {
    final Size screen = MediaQuery.sizeOf(context);

    // Brand lockup proportions, taken from the shipped logo: the wordmark's ink
    // width is ~1.77x the mark's drawn diameter and its cap height ~0.28x. Those
    // ratios describe the FULL lockup including ".com", which is why the splash
    // shows the domain: dropping it while keeping these ratios would leave the
    // mark oversized against the name and the whole lockup too small.
    final double lockupWidth = math.min(screen.width * 0.78, 460.0);
    final double markDiameter = lockupWidth / 1.773;
    final double fontSize = markDiameter * 0.284;
    final double unit = markDiameter / (2 * NoboMark.extent);

    // The gap the logo itself uses is ~0.09 of the mark's height, measured
    // between ink and ink. A text box sits above its cap height by roughly
    // 0.13em, so that much comes back off the spacing.
    final double gap =
        (markDiameter * 0.0901) - (fontSize * 0.13);

    final List<String> glyphs = <String>[
      'n', 'o', 'b', 'o', 'g', 'e', 'n', 't',
      if (showDomain) '.com',
    ];

    return ColoredBox(
      color: background,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            SizedBox(
              width: markDiameter,
              height: markDiameter,
              child: CustomPaint(
                painter: _NoboMarkPainter(t: t, unit: unit),
              ),
            ),
            SizedBox(height: gap < 0 ? 0 : gap),
            _NoboWordmarkReveal(
              t: t,
              glyphs: glyphs,
              fontSize: fontSize,
              showDomain: showDomain,
            ),
          ],
        ),
      ),
    );
  }
}

/// The wordmark: one span per glyph, each rising on its own beat.
class _NoboWordmarkReveal extends StatelessWidget {
  const _NoboWordmarkReveal({
    required this.t,
    required this.glyphs,
    required this.fontSize,
    required this.showDomain,
  });

  final double t;
  final List<String> glyphs;
  final double fontSize;
  final bool showDomain;

  @override
  Widget build(BuildContext context) {
    final TextStyle style = TextStyle(
      fontFamily: 'NoboLogotype',
      fontWeight: FontWeight.w300,
      fontSize: fontSize,
      height: 1,
      color: NoboSplashBrand.logotypeInk,
      // The shipped logotype is set tighter than Outfit's default tracking.
      letterSpacing: -0.025 * fontSize,
    );

    final int domainIndex = showDomain ? glyphs.length - 1 : -1;
    final List<Widget> children = <Widget>[];
    for (int i = 0; i < glyphs.length; i++) {
      // ".com" is a separate beat: it lands after the name has settled.
      final double inStart = i == domainIndex
          ? NoboSplashTiming.wordStart +
              (glyphs.length - 1) * NoboSplashTiming.wordStagger
          : NoboSplashTiming.wordStart + i * NoboSplashTiming.wordStagger;

      // Two regimes rather than one blend: the lockup is fully present on the
      // very first frame, because that is exactly what the native launch screen
      // drew. It then peels away letter by letter before the mark rebuilds.
      final double opacity;
      final double dy;
      if (t < NoboSplashTiming.dissolveEnd) {
        final double out = _window(
          t,
          NoboSplashTiming.letterOutStart +
              i * NoboSplashTiming.letterOutStagger,
          NoboSplashTiming.letterOutStart +
              i * NoboSplashTiming.letterOutStagger +
              NoboSplashTiming.letterOutEach,
          Curves.easeInCubic,
        );
        opacity = 1 - out;
        dy = out * fontSize * 0.16;
      } else {
        final double p = _window(
          t,
          inStart,
          inStart + NoboSplashTiming.wordEach,
          Curves.easeOutCubic,
        );
        opacity = p;
        dy = (1 - p) * fontSize * 0.26;
      }

      children.add(
        Opacity(
          opacity: opacity.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, dy),
            child: Text(
              glyphs[i],
              style: style,
              textScaler: TextScaler.noScaling,
            ),
          ),
        ),
      );
    }

    return FittedBox(
      fit: BoxFit.scaleDown,
      child: Row(mainAxisSize: MainAxisSize.min, children: children),
    );
  }
}

/// Paints the orbital mark at time [t], in ring-radius units scaled by [unit].
class _NoboMarkPainter extends CustomPainter {
  _NoboMarkPainter({required this.t, required this.unit});

  final double t;
  final double unit;

  static const Color _violet = NoboSplashBrand.violet;
  static const Color _ring = NoboSplashBrand.ring;

  /// The arc's start and full sweep in radians. Both are compile-time constants
  /// derived from the generated geometry, so they cannot fall out of step with
  /// the satellite's resting place.
  static const double _arcStartRad = NoboMark.arcStartDeg * math.pi / 180.0;
  static const double _arcSweepRad = NoboMark.arcSweepDeg * math.pi / 180.0;

  /// Angular length of the travelling glint, in radians.
  static const double _glintRadians = 0.62;

  @override
  void paint(Canvas canvas, Size size) {
    final double u = unit;
    canvas.save();
    canvas.translate(size.center(Offset.zero).dx, size.center(Offset.zero).dy);

    _paintAura(canvas, u);
    _paintBloom(canvas, u);
    _paintShockwave(canvas, u);
    _paintDots(canvas, u);
    _paintArc(canvas, u);
    _paintGlint(canvas, u);
    _paintSatellite(canvas, u);
    _paintCore(canvas, u);

    canvas.restore();
  }

  /// The soft halo that ties the mark to the plate.
  void _paintAura(Canvas canvas, double u) {
    final double p = _window(
      t,
      NoboSplashTiming.auraStart,
      NoboSplashTiming.auraEnd,
    );
    if (p <= 0) return;
    final double radius = u * NoboMark.extent * 1.9;
    canvas.drawCircle(
      Offset.zero,
      radius,
      Paint()
        ..shader = ui.Gradient.radial(
          Offset.zero,
          radius,
          <Color>[
            _violet.withValues(alpha: 0.20 * p),
            _violet.withValues(alpha: 0.07 * p),
            _violet.withValues(alpha: 0),
          ],
          <double>[0, 0.42, 1],
        ),
    );
  }

  /// The appear-flash on the core, swelling out of the dissolve.
  void _paintBloom(Canvas canvas, double u) {
    final double up = _window(t, 0.02, 0.20);
    final double down = _window(t, 0.24, 0.72, Curves.easeInOut);
    final double opacity = up * 0.85 * (1 - down);
    if (opacity <= 0.002) return;
    final double radius = u * (0.30 + 1.95 * up);
    canvas.drawCircle(
      Offset.zero,
      radius,
      Paint()
        ..shader = ui.Gradient.radial(
          Offset.zero,
          radius,
          <Color>[
            Colors.white.withValues(alpha: opacity),
            const Color(0xFFC9BCFF).withValues(alpha: opacity * 0.75),
            _violet.withValues(alpha: 0),
          ],
          <double>[0, 0.24, 1],
        ),
    );
  }

  void _paintShockwave(Canvas canvas, double u) {
    final double p = _window(t, 0.06, 0.62);
    if (p <= 0 || p >= 1) return;
    final double opacity = (1 - p) * 0.5;
    if (opacity <= 0.002) return;
    canvas.drawCircle(
      Offset.zero,
      u * (0.42 + 2.1 * p),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = u * (0.055 * (1 - p) + 0.008)
        ..color = _violet.withValues(alpha: opacity),
    );
  }

  /// The dot field: scattering out of the formed mark, then spiralling back in.
  void _paintDots(Canvas canvas, double u) {
    final Paint paint = Paint();

    if (t < NoboSplashTiming.dissolveEnd) {
      for (final NoboMarkDot d in NoboMark.dots) {
        final double p = _window(
          t,
          NoboSplashTiming.dissolveStart + d.delay * 0.14,
          NoboSplashTiming.dissolveEnd,
          Curves.easeInCubic,
        );
        if (p >= 1) continue;
        final double r = d.r * (1 - 0.55 * p) * u;
        final double a = 1 - p;
        if (r <= 0.05 || a <= 0.004) continue;
        paint.color = Color(d.color).withValues(alpha: a);
        canvas.drawCircle(
          Offset((d.x + d.startX * 0.5 * p) * u, (d.y + d.startY * 0.5 * p) * u),
          r,
          paint,
        );
      }
      return;
    }

    for (final NoboMarkDot d in NoboMark.dots) {
      final double start =
          NoboSplashTiming.dotsInStart + d.delay * NoboSplashTiming.dotsInStagger;
      final double p = _window(
        t,
        start,
        start + NoboSplashTiming.dotsInEach,
        Curves.easeOutCubic,
      );
      if (p <= 0) continue;

      // A little overshoot on the radius gives the field its pop.
      final double scale = _window(
        t,
        start,
        start + NoboSplashTiming.dotsInEach * 0.8,
        Curves.easeOutBack,
      );
      final double r = d.r * (0.35 + 0.65 * scale) * u;
      if (r <= 0.05) continue;
      paint.color = Color(d.color).withValues(alpha: (p * 1.6).clamp(0.0, 1.0));
      canvas.drawCircle(
        Offset((d.x + d.startX * (1 - p)) * u, (d.y + d.startY * (1 - p)) * u),
        r,
        paint,
      );
    }
  }

  /// The ring arc: retracts with the dissolve, then redraws from its start.
  void _paintArc(Canvas canvas, double u) {
    final Rect rect = Rect.fromCircle(center: Offset.zero, radius: u);
    final Paint paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = NoboMark.ringStroke * u
      ..strokeCap = StrokeCap.round
      ..color = _ring;

    if (t < NoboSplashTiming.dissolveEnd) {
      final double p = _window(
        t,
        NoboSplashTiming.dissolveStart,
        NoboSplashTiming.dissolveEnd,
        Curves.easeInCubic,
      );
      if (p < 1) canvas.drawArc(rect, _arcStartRad, _arcSweepRad * (1 - p), false, paint);
      return;
    }

    final double p = _window(
      t,
      NoboSplashTiming.arcStart,
      NoboSplashTiming.arcEnd,
      Curves.easeInOut,
    );
    if (p > 0) canvas.drawArc(rect, _arcStartRad, _arcSweepRad * p, false, paint);
  }

  /// A highlight gliding once around the finished arc.
  void _paintGlint(Canvas canvas, double u) {
    final double p = _window(
      t,
      NoboSplashTiming.glintStart,
      NoboSplashTiming.glintEnd,
      Curves.easeInOut,
    );
    if (p <= 0 || p >= 1) return;
    // Fading on a sine means the glint never appears or stops dead.
    final double opacity = math.sin(p * math.pi) * 0.85;
    if (opacity <= 0.004) return;

    final Rect rect = Rect.fromCircle(center: Offset.zero, radius: u);
    canvas.drawArc(
      rect,
      _arcStartRad + _arcSweepRad * p,
      _glintRadians,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = u * 0.062
        ..strokeCap = StrokeCap.round
        ..color = Colors.white.withValues(alpha: opacity),
    );
  }

  /// The satellite: pulled back into the core by the dissolve, then launched.
  void _paintSatellite(Canvas canvas, double u) {
    final Paint paint = Paint()..color = const Color(NoboMark.satelliteColor);

    if (t < NoboSplashTiming.dissolveEnd) {
      final double p = _window(
        t,
        NoboSplashTiming.dissolveStart,
        NoboSplashTiming.dissolveEnd,
        Curves.easeInCubic,
      );
      if (p >= 1) return;
      final double r = NoboMark.satelliteRadius * (1 - p) * u;
      if (r <= 0.05) return;
      canvas.drawCircle(
        Offset(
          NoboMark.satelliteX * (1 - p) * u,
          NoboMark.satelliteY * (1 - p) * u,
        ),
        r,
        paint,
      );
      return;
    }

    final double p = _window(
      t,
      NoboSplashTiming.satStart,
      NoboSplashTiming.satEnd,
      Curves.easeOutBack,
    );
    if (p <= 0) return;
    final double r = NoboMark.satelliteRadius * p.clamp(0.0, 1.35) * u;
    if (r <= 0.05) return;
    canvas.drawCircle(
      Offset(NoboMark.satelliteX * p * u, NoboMark.satelliteY * p * u),
      r,
      paint,
    );
  }

  /// The core. It is on screen from the first frame — the native launch screen
  /// drew it too — so it recoils and settles rather than appearing.
  void _paintCore(Canvas canvas, double u) {
    final double recoil = _window(t, 0.04, 0.20);
    final double surge = _window(t, 0.20, 0.46);
    final double settle = _window(t, 0.46, 0.68, Curves.easeInOut);
    final double scale = 1.0 - 0.10 * recoil + 0.14 * surge - 0.04 * settle;

    final double radius = NoboMark.coreRadius * scale * u;
    canvas.drawCircle(
      Offset.zero,
      radius,
      Paint()
        ..shader = ui.Gradient.radial(
          Offset(-radius * 0.22, -radius * 0.30),
          radius * 1.75,
          <Color>[
            const Color(0xFF6D5BF0),
            const Color(0xFF4F3ED6),
            const Color(0xFF3F2FBE),
          ],
          <double>[0, 0.58, 1],
        ),
    );

    // The ring inside edge catches a little of the core's light.
    final double halo = _window(t, 0.30, 0.60);
    if (halo > 0) {
      canvas.drawCircle(
        Offset.zero,
        radius * 1.22,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = u * 0.03
          ..color = _violet.withValues(alpha: 0.18 * halo),
      );
    }
  }

  @override
  bool shouldRepaint(_NoboMarkPainter old) => old.t != t || old.unit != unit;
}

/// Hosts the animated splash above the app and lifts it once it has played.
///
/// Put it in [MaterialApp.builder] so the router's first screen renders and warms
/// up underneath: by the time the splash lifts, the app is ready.
class NoboBootGate extends StatefulWidget {
  const NoboBootGate({required this.child, super.key});

  final Widget child;

  @override
  State<NoboBootGate> createState() => _NoboBootGateState();
}

class _NoboBootGateState extends State<NoboBootGate>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: NoboSplashTiming.totalMs),
  );

  bool _done = false;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    // Someone who asked the OS to reduce motion gets the app, not a show.
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      _done = true;
      return;
    }
    _controller.forward().whenCompleteOrCancel(() {
      if (mounted) setState(() => _done = true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _skip() {
    if (_done) return;
    _controller.stop();
    setState(() => _done = true);
  }

  @override
  Widget build(BuildContext context) {
    if (_done) return widget.child;

    final Color canvas = context.nobo.canvas;

    return AnimatedBuilder(
      animation: _controller,
      builder: (BuildContext context, Widget? child) {
        final double t = _controller.value * NoboSplashTiming.total;
        final double fade = _window(
          t,
          NoboSplashTiming.fadeStart,
          NoboSplashTiming.total,
          Curves.easeInOut,
        );

        return Stack(
          children: <Widget>[
            if (child != null) child,
            Positioned.fill(
              child: Opacity(
                opacity: (1 - fade).clamp(0.0, 1.0),
                // Opaque behaviour stops the hit test here, so the app below
                // cannot take a tap meant to skip the splash.
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _skip,
                  child: NoboBootSplash(
                    t: t,
                    background:
                        Color.lerp(NoboSplashBrand.plate, canvas, fade)!,
                    showDomain: true,
                  ),
                ),
              ),
            ),
          ],
        );
      },
      child: widget.child,
    );
  }
}
