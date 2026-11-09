import '../../core/utils/json.dart';

/// Lifecycle of a generated asset.
///
/// Audited quirk: the backend uses **two** success states — `Ready` and
/// `Draft` — and in-flight rows sometimes carry the sentinel URL
/// `.../processing`. Treating only `ready` as terminal would leave the UI
/// spinning forever on Remotion renders, so both are folded into [ready].
enum AssetStatus {
  queued,
  processing,
  rendering,
  ready,
  failed;

  static AssetStatus parse(String? raw, String? url) {
    final String s = (raw ?? '').toLowerCase().trim();
    if (s == 'failed' || s == 'error') return AssetStatus.failed;
    if (s == 'ready' || s == 'draft' || s == 'completed' || s == 'complete') {
      return AssetStatus.ready;
    }
    if (s == 'rendering') return AssetStatus.rendering;
    if (s == 'processing' || s == 'in_progress') return AssetStatus.processing;
    if (s == 'queued' || s == 'pending') return AssetStatus.queued;
    // Unknown status: fall back to the URL sentinel the backend writes.
    if (url != null && url.contains('/processing')) return AssetStatus.processing;
    return AssetStatus.ready;
  }

  bool get isTerminal => this == AssetStatus.ready || this == AssetStatus.failed;
  bool get isBusy => !isTerminal;
}

enum AssetKind {
  image,
  video,
  other;

  static AssetKind parse(String? raw) {
    final String s = (raw ?? '').toLowerCase().trim();
    if (s == 'video' || s == 'reel' || s == 'mp4') return AssetKind.video;
    if (s == 'image' || s == 'photo' || s == 'creative' || s == 'poster') {
      return AssetKind.image;
    }
    return AssetKind.other;
  }
}

/// A generated creative — image or video — in the workspace asset library.
class NoboAsset {
  const NoboAsset({
    required this.id,
    required this.kind,
    required this.status,
    required this.url,
    required this.caption,
    required this.createdAt,
    required this.projectId,
    required this.thumbnailUrl,
    required this.durationSeconds,
    required this.headline,
    required this.primaryText,
    required this.engine,
    required this.error,
  });

  final String id;
  final AssetKind kind;
  final AssetStatus status;
  final String? url;
  final String? caption;
  final DateTime? createdAt;
  final String? projectId;
  final String? thumbnailUrl;
  final int? durationSeconds;
  final String? headline;
  final String? primaryText;
  final String? engine;
  final String? error;

  bool get isVideo => kind == AssetKind.video;

  /// Poster frame: explicit thumbnail, else the video stream itself for images.
  String? get previewUrl {
    if (status != AssetStatus.ready) return null;
    return isVideo ? thumbnailUrl : url;
  }

  String? get playableUrl => status == AssetStatus.ready ? url : null;

  /// The single best line of copy to show under a creative.
  String? get displayTitle {
    final String? h = jStr(headline);
    if (h != null) return h;
    final String? p = jStr(primaryText);
    if (p != null) return p;
    final String? c = jStr(caption);
    if (c != null) {
      final String trimmed = c.trim();
      return trimmed.length > 90 ? '${trimmed.substring(0, 90)}…' : trimmed;
    }
    return null;
  }

  factory NoboAsset.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> meta = jMap(json['metadata']);
    final String? rawUrl = jStr(json['url']);
    return NoboAsset(
      id: jStrOr(json['id']),
      kind: AssetKind.parse(jStr(json['type'])),
      status: AssetStatus.parse(jStr(json['status']), rawUrl),
      url: rawUrl,
      caption: jStr(json['caption']),
      createdAt: jDate(json['created_at']),
      projectId: jStr(json['property_id']),
      thumbnailUrl: jStr(meta['thumbnailUrl']),
      durationSeconds: jIntN(meta['duration']),
      headline: jStr(meta['headline']),
      primaryText: jStr(meta['primary_text']),
      engine: jStr(meta['engine']) ?? jStr(meta['videoModel']),
      error: jStr(meta['error']),
    );
  }
}
