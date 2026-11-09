import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/platform/nobo_platform.dart';
import '../../core/ui/feedback.dart';
import '../../core/ui/media.dart';
import '../../core/ui/orbit_mark.dart';

/// Full-screen media viewer for generated images and videos.
///
/// Video is played with the native player (ExoPlayer / AVPlayer via
/// `video_player`) so hardware decoding and platform controls are used — a
/// generated film must never stall the UI thread.
class MediaViewerScreen extends StatefulWidget {
  const MediaViewerScreen({
    required this.source,
    this.isVideo = false,
    super.key,
  });

  final String source;
  final bool isVideo;

  @override
  State<MediaViewerScreen> createState() => _MediaViewerScreenState();
}

class _MediaViewerScreenState extends State<MediaViewerScreen> {
  VideoPlayerController? _controller;
  bool _ready = false;
  String? _error;

  bool get _canPlayVideo =>
      widget.isVideo &&
      widget.source.isNotEmpty &&
      !isBundledAsset(widget.source);

  @override
  void initState() {
    super.initState();
    if (_canPlayVideo) _initVideo();
  }

  Future<void> _initVideo() async {
    try {
      final VideoPlayerController c = VideoPlayerController.networkUrl(
        Uri.parse(widget.source),
      );
      await c.initialize();
      await c.setLooping(true);
      await c.play();
      if (!mounted) {
        await c.dispose();
        return;
      }
      setState(() {
        _controller = c;
        _ready = true;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07060C),
      body: SafeArea(
        child: Stack(
          children: <Widget>[
            Positioned.fill(
              child: Center(
                child: widget.source.isEmpty
                    ? const NoboEmptyState(
                        title: 'Nothing to show',
                        message: 'This asset has no preview available yet.',
                        icon: Icons.broken_image_outlined,
                      )
                    : _buildMedia(),
              ),
            ),
            Positioned(
              top: NoboSpace.sm,
              left: NoboSpace.sm,
              child: _GlassButton(
                icon: NoboPlatform.isIOS
                    ? Icons.close_rounded
                    : Icons.close_rounded,
                onTap: () => context.pop(),
              ),
            ),
            Positioned(
              top: NoboSpace.sm,
              right: NoboSpace.sm,
              child: Row(
                children: <Widget>[
                  _GlassButton(
                    icon: Icons.share_rounded,
                    onTap: () {
                      if (widget.source.isEmpty) return;
                      SharePlus.instance.share(
                        ShareParams(
                          text: widget.source.startsWith('http')
                              ? widget.source
                              : 'Nobogent',
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            if (_canPlayVideo && _ready && _controller != null)
              Positioned(
                bottom: NoboSpace.lg,
                left: 0,
                right: 0,
                child: _VideoControls(controller: _controller!),
              ),
            if (_error != null)
              Positioned(
                bottom: NoboSpace.xl,
                left: NoboSpace.gutter,
                right: NoboSpace.gutter,
                child: Text(
                  'Video could not be loaded. Check your connection.',
                  textAlign: TextAlign.center,
                  style: NoboType.caption.copyWith(
                    color: Colors.white.withValues(alpha: 0.7),
                  ),
                ),
              ),
            if (widget.isVideo && !_canPlayVideo)
              Positioned(
                bottom: NoboSpace.xl,
                left: NoboSpace.gutter,
                right: NoboSpace.gutter,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(
                      Icons.play_circle_outline_rounded,
                      size: 14,
                      color: Colors.white.withValues(alpha: 0.6),
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        'Poster only — this build has no playable media URL '
                        'for this item.',
                        style: NoboType.caption.copyWith(
                          color: Colors.white.withValues(alpha: 0.6),
                          fontSize: 11.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildMedia() {
    if (_canPlayVideo) {
      if (!_ready || _controller == null) {
        return const OrbitMark(
          size: 54,
          active: true,
          color: Colors.white,
          secondaryColor: Color(0xFFB9A0FF),
        );
      }
      return AspectRatio(
        aspectRatio: _controller!.value.aspectRatio,
        child: VideoPlayer(_controller!),
      );
    }
    return InteractiveViewer(
      maxScale: 4,
      child: isBundledAsset(widget.source)
          ? Image.asset(widget.source, fit: BoxFit.contain)
          : Image.network(
              widget.source,
              fit: BoxFit.contain,
              loadingBuilder:
                  (
                    BuildContext context,
                    Widget child,
                    ImageChunkEvent? progress,
                  ) {
                    if (progress == null) return child;
                    return const OrbitMark(
                      size: 48,
                      active: true,
                      color: Colors.white,
                    );
                  },
              errorBuilder: (_, _, _) => Center(
                child: Text(
                  'Preview unavailable',
                  style: NoboType.caption.copyWith(color: Colors.white70),
                ),
              ),
            ),
    );
  }
}

class _VideoControls extends StatelessWidget {
  const _VideoControls({required this.controller});

  final VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<VideoPlayerValue>(
      valueListenable: controller,
      builder: (BuildContext context, VideoPlayerValue value, Widget? child) {
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.lg),
          child: Row(
            children: <Widget>[
              _GlassButton(
                icon: value.isPlaying
                    ? Icons.pause_rounded
                    : Icons.play_arrow_rounded,
                onTap: () {
                  if (value.isPlaying) {
                    controller.pause();
                  } else {
                    controller.play();
                  }
                },
              ),
              const SizedBox(width: NoboSpace.md),
              Expanded(
                child: VideoProgressIndicator(
                  controller,
                  allowScrubbing: true,
                  colors: VideoProgressColors(
                    playedColor: context.nobo.primary,
                    bufferedColor: Colors.white.withValues(alpha: 0.28),
                    backgroundColor: Colors.white.withValues(alpha: 0.14),
                  ),
                ),
              ),
              const SizedBox(width: NoboSpace.md),
              Text(
                _format(value.position),
                style: NoboType.caption.copyWith(
                  color: Colors.white.withValues(alpha: 0.8),
                  fontSize: 11.5,
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  String _format(Duration d) {
    final int m = d.inMinutes;
    final int s = d.inSeconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }
}

class _GlassButton extends StatelessWidget {
  const _GlassButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.14),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
        ),
        child: Icon(icon, size: 19, color: Colors.white),
      ),
    );
  }
}
