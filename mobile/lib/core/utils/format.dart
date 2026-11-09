import 'package:intl/intl.dart';

/// Human time, the way a person says it.
String timeAgo(DateTime? when, {DateTime? now}) {
  if (when == null) return '';
  final DateTime ref = now ?? DateTime.now();
  final Duration d = ref.difference(when);
  if (d.isNegative) {
    final Duration ahead = when.difference(ref);
    if (ahead.inMinutes < 1) return 'now';
    if (ahead.inMinutes < 60) return 'in ${ahead.inMinutes}m';
    if (ahead.inHours < 24) return 'in ${ahead.inHours}h';
    return 'in ${ahead.inDays}d';
  }
  if (d.inSeconds < 45 || d.inMinutes < 1) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes}m ago';
  if (d.inHours < 24) return '${d.inHours}h ago';
  if (d.inDays == 1) return 'yesterday';
  if (d.inDays < 7) return '${d.inDays}d ago';
  if (d.inDays < 30) return '${(d.inDays / 7).floor()}w ago';
  return DateFormat('d MMM').format(when);
}

/// True when [when] falls on an earlier calendar day than [now].
///
/// Used for "overdue" so that something due at 5pm today is not flagged overdue
/// at 5:01pm — the user still has today to act on it.
bool isBeforeToday(DateTime when, {DateTime? now}) {
  final DateTime ref = now ?? DateTime.now();
  final DateTime a = DateTime(when.year, when.month, when.day);
  final DateTime b = DateTime(ref.year, ref.month, ref.day);
  return a.isBefore(b);
}

/// Day label for grouping lists: Today / Yesterday / weekday / date.
String dayLabel(DateTime when, {DateTime? now}) {
  final DateTime ref = now ?? DateTime.now();
  final DateTime a = DateTime(when.year, when.month, when.day);
  final DateTime b = DateTime(ref.year, ref.month, ref.day);
  final int diff = b.difference(a).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  if (diff < 7) return DateFormat('EEEE').format(when);
  if (when.year == ref.year) return DateFormat('d MMM').format(when);
  return DateFormat('d MMM yyyy').format(when);
}

String clockTime(DateTime when) => DateFormat('h:mm a').format(when);

String fullDate(DateTime when) => DateFormat('EEE, d MMM yyyy').format(when);

/// Compact duration: 15s, 1m 20s.
String shortDuration(Duration? d) {
  if (d == null) return '';
  final int s = d.inSeconds;
  if (s < 60) return '${s}s';
  final int m = s ~/ 60;
  final int rest = s % 60;
  if (rest == 0) return '${m}m';
  return '${m}m ${rest}s';
}

/// Shortens a count for dense UI: 1.2k, 18k.
String compactCount(int n) {
  if (n < 1000) return '$n';
  if (n < 1000000) {
    final double v = n / 1000;
    return v < 10 ? '${v.toStringAsFixed(1)}k' : '${v.round()}k';
  }
  final double v = n / 1000000;
  return '${v.toStringAsFixed(1)}M';
}

/// Trims to a sentence boundary-ish length for previews.
String excerpt(String? text, {int max = 120}) {
  if (text == null) return '';
  final String t = text.trim().replaceAll(RegExp(r'\s+'), ' ');
  if (t.length <= max) return t;
  final String cut = t.substring(0, max);
  final int lastSpace = cut.lastIndexOf(' ');
  return '${lastSpace > max * 0.6 ? cut.substring(0, lastSpace) : cut}…';
}

/// Initials for avatar fallbacks.
String initialsOf(String? name) {
  final String n = (name ?? '').trim();
  if (n.isEmpty) return '?';
  final List<String> parts = n
      .split(RegExp(r'\s+'))
      .where((String p) => p.isNotEmpty)
      .toList();
  if (parts.length == 1) {
    return parts.first.substring(0, 1).toUpperCase();
  }
  return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
}
