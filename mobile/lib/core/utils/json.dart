/// Defensive JSON readers.
///
/// The generated Supabase types in the web repo are stale relative to the live
/// schema (audited: routes write columns that `database.types.ts` does not
/// declare), and PostgREST returns `numeric` as String and `jsonb` as a decoded
/// object. Casting blindly would crash on real data, so every field goes
/// through these.
library;

String? jStr(Object? v) {
  if (v == null) return null;
  if (v is String) return v.isEmpty ? null : v;
  return v.toString();
}

String jStrOr(Object? v, [String fallback = '']) => jStr(v) ?? fallback;

int jInt(Object? v, {int fallback = 0}) {
  if (v == null) return fallback;
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse(v.toString()) ?? fallback;
}

int? jIntN(Object? v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse(v.toString());
}

double jDbl(Object? v, {double fallback = 0}) {
  if (v == null) return fallback;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString()) ?? fallback;
}

double? jDblN(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

bool jBool(Object? v, {bool fallback = false}) {
  if (v == null) return fallback;
  if (v is bool) return v;
  if (v is num) return v != 0;
  final String s = v.toString().toLowerCase();
  if (s == 'true' || s == 't' || s == '1') return true;
  if (s == 'false' || s == 'f' || s == '0') return false;
  return fallback;
}

DateTime? jDate(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  final String? s = jStr(v);
  if (s == null) return null;
  return DateTime.tryParse(s)?.toLocal();
}

DateTime jDateOr(Object? v, DateTime fallback) => jDate(v) ?? fallback;

Map<String, dynamic> jMap(Object? v) {
  if (v is Map<String, dynamic>) return v;
  if (v is Map) return v.map((k, val) => MapEntry(k.toString(), val));
  return <String, dynamic>{};
}

Map<String, dynamic>? jMapN(Object? v) {
  if (v == null) return null;
  final Map<String, dynamic> m = jMap(v);
  return m.isEmpty ? null : m;
}

List<Map<String, dynamic>> jListMaps(Object? v) {
  if (v is List) {
    return v.whereType<Object?>().map((e) {
      if (e is Map) return jMap(e);
      return <String, dynamic>{};
    }).where((e) => e.isNotEmpty).toList(growable: false);
  }
  return const <Map<String, dynamic>>[];
}

List<String> jListStrs(Object? v) {
  if (v is List) {
    return v
        .map(jStr)
        .whereType<String>()
        .toList(growable: false);
  }
  final String? single = jStr(v);
  if (single != null) return <String>[single];
  return const <String>[];
}

/// `custom_fields` is a `text` column server-side but the API normalises it to
/// an object. Accept either shape.
Map<String, dynamic> jPossiblyEncodedMap(Object? v) {
  if (v is Map) return jMap(v);
  final String? s = jStr(v);
  if (s == null) return <String, dynamic>{};
  return <String, dynamic>{};
}
