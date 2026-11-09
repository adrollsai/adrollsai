import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import '../utils/format.dart';

/// Resolves an asset path to the right Flutter image primitive.
///
/// Bundled demo art uses `assets/...`; generated Nobogent media is an absolute
/// URL on Cloudflare R2. Both must look identical, so this is the single place
/// that decides.
bool isBundledAsset(String path) =>
    path.startsWith('assets/') || path.startsWith('asset:');

Widget _image(
  String path, {
  required BoxFit fit,
  double? cacheWidth,
  Widget? errorWidget,
}) {
  if (isBundledAsset(path)) {
    return Image.asset(
      path.startsWith('asset:') ? path.substring(6) : path,
      fit: fit,
      cacheWidth: cacheWidth?.round(),
      errorBuilder: (_, _, _) =>
          errorWidget ?? const _MediaFallback(),
    );
  }
  return CachedNetworkImage(
    imageUrl: path,
    fit: fit,
    memCacheWidth: cacheWidth?.round(),
    fadeInDuration: NoboMotion.base,
    placeholder: (_, _) => const _MediaSkeleton(),
    errorWidget: (_, _, _) => errorWidget ?? const _MediaFallback(),
  );
}

/// A generated creative as a first-class interface element: fixed aspect,
/// rounded, with an optional video treatment (play affordance + duration).
class NoboMediaTile extends StatelessWidget {
  const NoboMediaTile({
    required this.source,
    this.isVideo = false,
    this.durationSeconds,
    this.aspectRatio = 4 / 5,
    this.onTap,
    this.badge,
    this.radius = NoboRadius.md,
    this.width,
    this.heroTag,
    super.key,
  });

  final String? source;
  final bool isVideo;
  final int? durationSeconds;
  final double aspectRatio;
  final VoidCallback? onTap;
  final Widget? badge;
  final double radius;
  final double? width;
  final Object? heroTag;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final BorderRadius br = BorderRadius.circular(radius);

    Widget content;
    final String? src = source;
    if (src == null || src.isEmpty) {
      content = const _MediaFallback();
    } else {
      content = Stack(
        fit: StackFit.expand,
        children: <Widget>[
          _image(src, fit: BoxFit.cover),
          // Scrim so overlaid chrome stays legible on any photo.
          if (isVideo || badge != null)
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.center,
                  colors: <Color>[
                    Colors.black.withValues(alpha: 0.42),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          if (isVideo) const Center(child: _PlayGlyph()),
          if (isVideo && durationSeconds != null)
            Positioned(
              right: 7,
              bottom: 7,
              child: _DurationChip(seconds: durationSeconds!),
            ),
          if (badge != null) Positioned(right: 7, top: 7, child: badge!),
        ],
      );
    }

    final Widget framed = ClipRRect(
      borderRadius: br,
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: DecoratedBox(
          decoration: BoxDecoration(color: c.surfaceSunken),
          child: content,
        ),
      ),
    );

    final Widget sized = width == null
        ? framed
        : SizedBox(width: width, child: framed);

    final Widget tappable = onTap == null
        ? sized
        : GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: sized,
          );

    if (heroTag == null) return tappable;
    return Hero(tag: heroTag!, child: tappable);
  }
}

class _PlayGlyph extends StatelessWidget {
  const _PlayGlyph();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        shape: BoxShape.circle,
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.22),
            blurRadius: 12,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: const Icon(
        Icons.play_arrow_rounded,
        size: 24,
        color: Color(0xFF14131C),
      ),
    );
  }
}

class _DurationChip extends StatelessWidget {
  const _DurationChip({required this.seconds});

  final int seconds;

  @override
  Widget build(BuildContext context) {
    final int m = seconds ~/ 60;
    final int s = seconds % 60;
    final String label = m > 0 ? '$m:${s.toString().padLeft(2, '0')}' : '0:${s.toString().padLeft(2, '0')}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.66),
        borderRadius: NoboRadius.rXs,
      ),
      child: Text(
        label,
        style: NoboType.micro.copyWith(
          color: Colors.white,
          fontSize: 10,
          letterSpacing: 0,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _MediaSkeleton extends StatelessWidget {
  const _MediaSkeleton();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(color: context.nobo.surfaceSunken);
  }
}

class _MediaFallback extends StatelessWidget {
  const _MediaFallback();

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return ColoredBox(
      color: c.surfaceSunken,
      child: Center(
        child: Icon(
          Icons.image_outlined,
          size: 22,
          color: c.inkTertiary,
        ),
      ),
    );
  }
}

/// Avatar with a deterministic tint derived from the name, so the same person
/// always gets the same colour without needing a stored preference.
class NoboAvatar extends StatelessWidget {
  const NoboAvatar({
    required this.name,
    this.imageUrl,
    this.size = 40,
    this.square = false,
    super.key,
  });

  final String name;
  final String? imageUrl;
  final double size;
  final bool square;

  static const List<Color> _tints = <Color>[
    Color(0xFF5F27DC),
    Color(0xFF4338CA),
    Color(0xFF0F9D76),
    Color(0xFFB31B20),
    Color(0xFFB77E14),
    Color(0xFF0C3157),
  ];

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final int hash = name.codeUnits.fold<int>(0, (int a, int b) => a + b);
    final Color tint = _tints[hash % _tints.length];
    final BorderRadius br = BorderRadius.circular(
      square ? NoboRadius.sm : size / 2,
    );

    final Widget content;
    final String? url = imageUrl;
    if (url != null && url.isNotEmpty) {
      content = _image(url, fit: BoxFit.cover);
    } else {
      content = ColoredBox(
        color: tint.withValues(alpha: 0.14),
        child: Center(
          child: Text(
            initialsOf(name),
            style: NoboType.label.copyWith(
              color: tint,
              fontSize: size * 0.36,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      );
    }

    return SizedBox(
      width: size,
      height: size,
      child: ClipRRect(
        borderRadius: br,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border.all(color: c.border),
          ),
          child: content,
        ),
      ),
    );
  }
}
