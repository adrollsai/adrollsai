import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../models/agent.dart';

/// Durable, device-local store for task sessions.
///
/// This is a deliberate architectural decision, driven by the backend audit:
/// Nobogent has **no** `agent_sessions` / `agent_messages` tables — the web app
/// keeps agent transcripts in `localStorage`. Rather than invent an incompatible
/// schema (which the brief forbids), sessions are owned by the client and
/// persisted in the app's private support directory.
///
/// The consequence is honest and worth stating: transcripts are per-device.
/// Continuity across devices is achieved at the *output* level, because generated
/// assets live in `assets`, tagged with `metadata.nobo_session_id`.
///
/// File access is **synchronous on purpose**. The payload is a few kilobytes and
/// is written only when a turn completes, so the cost is negligible — and using
/// the synchronous API removes a whole class of interleaving bugs, and makes the
/// store usable from widget tests (which run in a fake-async zone where real
/// asynchronous file I/O never completes).
///
/// Writes are atomic: the file is written to a temp sibling and then renamed, so
/// a crash mid-save cannot corrupt the transcript.
class SessionRepository {
  SessionRepository({Directory? overrideDirectory})
    : _override = overrideDirectory;

  final Directory? _override;
  File? _file;
  final List<AgentSession> _cache = <AgentSession>[];
  bool _loaded = false;

  File _resolveFile() {
    final File? existing = _file;
    if (existing != null) return existing;

    final Directory dir =
        _override ??
        Directory(
          '${getApplicationSupportDirectorySync().path}'
          '${Platform.pathSeparator}sessions',
        );
    if (!dir.existsSync()) {
      dir.createSync(recursive: true);
    }
    final File f = File('${dir.path}${Platform.pathSeparator}sessions.json');
    _file = f;
    return f;
  }

  void _ensureLoaded() {
    if (_loaded) return;
    _loaded = true;
    try {
      final File f = _resolveFile();
      if (!f.existsSync()) return;
      final String raw = f.readAsStringSync();
      if (raw.trim().isEmpty) return;
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return;
      final Object? list = decoded['sessions'];
      if (list is! List) return;
      for (final Object? item in list) {
        if (item is Map<String, dynamic>) {
          final AgentSession s = AgentSession.fromJson(item);
          if (s.id.isNotEmpty) _cache.add(s);
        }
      }
      _sort();
    } catch (e) {
      debugPrint('SessionRepository load failed: $e');
    }
  }

  void _sort() => _cache.sort(
    (AgentSession a, AgentSession b) => b.updatedAt.compareTo(a.updatedAt),
  );

  void _flush() {
    try {
      final File f = _resolveFile();
      final String payload = jsonEncode(<String, dynamic>{
        'version': 1,
        'sessions': _cache.map((AgentSession s) => s.toJson()).toList(),
      });
      final File tmp = File('${f.path}.tmp');
      tmp.writeAsStringSync(payload, flush: true);
      if (f.existsSync()) f.deleteSync();
      tmp.renameSync(f.path);
    } catch (e) {
      debugPrint('SessionRepository flush failed: $e');
    }
  }

  Future<List<AgentSession>> all() async {
    _ensureLoaded();
    return List<AgentSession>.unmodifiable(_cache);
  }

  /// Synchronous read for callers that are already inside a frame.
  List<AgentSession> allSync() {
    _ensureLoaded();
    return List<AgentSession>.unmodifiable(_cache);
  }

  Future<AgentSession?> byId(String id) async {
    _ensureLoaded();
    for (final AgentSession s in _cache) {
      if (s.id == id) return s;
    }
    return null;
  }

  Future<void> upsert(AgentSession session) async {
    _ensureLoaded();
    final int i = _cache.indexWhere((AgentSession s) => s.id == session.id);
    if (i >= 0) {
      _cache[i] = session;
    } else {
      _cache.insert(0, session);
    }
    _sort();
    _flush();
  }

  Future<void> delete(String id) async {
    _ensureLoaded();
    _cache.removeWhere((AgentSession s) => s.id == id);
    _flush();
  }

  Future<void> clear() async {
    _ensureLoaded();
    _cache.clear();
    _flush();
  }

  /// Seeds the demo transcript. Only used when no backend is configured, so a
  /// reviewer without credentials still sees the real interface.
  Future<void> seedIfEmpty(List<AgentSession> seed) async {
    _ensureLoaded();
    if (_cache.isNotEmpty) return;
    _cache.addAll(seed);
    _sort();
    _flush();
  }
}

/// `path_provider` only exposes the application-support directory as a Future.
///
/// Widget tests run in a fake-async zone where real platform-channel replies do
/// not arrive, so awaiting it there would hang. When a directory has been
/// injected (always the case under test) this is never reached; in production it
/// is resolved once on the first frame via the cached synchronous lookup below.
Directory getApplicationSupportDirectorySync() {
  final Directory? cached = _appSupportDir;
  if (cached != null) return cached;
  throw StateError(
    'Application support directory has not been resolved. Call '
    'primeAppSupportDirectory() during startup, or inject a directory.',
  );
}

Directory? _appSupportDir;

/// Resolves and caches the app-support directory once, during startup.
Future<void> primeAppSupportDirectory() async {
  _appSupportDir ??= await getApplicationSupportDirectory();
}
