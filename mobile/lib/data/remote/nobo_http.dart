import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/nobo_env.dart';
import '../repositories/auth_repository.dart';

/// Thin JSON client for the existing Nobogent Next.js backend.
///
/// Authenticates with `Authorization: Bearer <supabase access token>`. Only the
/// endpoints that hold server-side secrets (AI agent, campaigns, lead actions)
/// go through here — ordinary CRUD goes straight to Supabase so it stays fast
/// and works offline-ish.
class NoboHttp {
  NoboHttp({
    required AuthRepository auth,
    http.Client? client,
    String? baseUrl,
  }) : _auth = auth,
       _client = client ?? http.Client(),
       _baseUrl = baseUrl ?? NoboEnv.apiBaseUrl;

  final AuthRepository _auth;
  final http.Client _client;
  final String _baseUrl;

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  Future<Map<String, String>> _headers({bool json = true}) async {
    await _auth.ensureFreshSession();
    final String? token = _auth.accessToken;
    return <String, String>{
      if (json) 'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, String>? query,
  }) async {
    final Uri base = _uri(path);
    final Uri uri = query == null
        ? base
        : base.replace(queryParameters: <String, String>{
            ...base.queryParameters,
            ...query,
          });
    final http.Response res = await _client
        .get(uri, headers: await _headers())
        .timeout(const Duration(seconds: 30));
    return _decode(res);
  }

  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body, {
    Map<String, String>? query,
  }) async {
    final Uri base = _uri(path);
    final Uri uri = query == null
        ? base
        : base.replace(queryParameters: <String, String>{
            ...base.queryParameters,
            ...query,
          });
    final http.Response res = await _client
        .post(uri, headers: await _headers(), body: jsonEncode(body))
        .timeout(const Duration(seconds: 45));
    return _decode(res);
  }

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic>? parsed;
    if (res.body.isNotEmpty) {
      try {
        final Object? decoded = jsonDecode(res.body);
        if (decoded is Map<String, dynamic>) parsed = decoded;
      } catch (_) {
        // Non-JSON body; handled below by status code.
      }
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return parsed ?? <String, dynamic>{'success': true};
    }

    final String serverMessage =
        (parsed?['error'] as String?) ??
        (parsed?['message'] as String?) ??
        '';

    switch (res.statusCode) {
      case 401:
        throw NoboFailure(
          NoboFailureKind.unauthorized,
          'Your session has expired. Please sign in again.',
          detail: serverMessage,
        );
      case 403:
        throw NoboFailure(
          NoboFailureKind.forbidden,
          serverMessage.isNotEmpty
              ? serverMessage
              : 'You do not have access to this feature on your account.',
          detail: serverMessage,
        );
      case 404:
        throw NoboFailure(
          NoboFailureKind.notFound,
          serverMessage.isNotEmpty ? serverMessage : 'Not found.',
          detail: serverMessage,
        );
      case 429:
        throw const NoboFailure(
          NoboFailureKind.rateLimited,
          'Too many requests just now. Give it a moment.',
        );
      default:
        throw NoboFailure(
          res.statusCode >= 500
              ? NoboFailureKind.server
              : NoboFailureKind.unknown,
          serverMessage.isNotEmpty
              ? serverMessage
              : 'The request could not be completed.',
          detail: 'HTTP ${res.statusCode}',
        );
    }
  }

  /// Streaming POST for the agent SSE endpoint.
  Stream<String> postLines(
    String path,
    Map<String, dynamic> body, {
    Map<String, String>? query,
    Duration timeout = const Duration(seconds: 120),
  }) async* {
    final Uri base = _uri(path);
    final Uri uri = query == null
        ? base
        : base.replace(queryParameters: <String, String>{
            ...base.queryParameters,
            ...query,
          });
    final http.Request req = http.Request('POST', uri);
    req.headers.addAll(await _headers());
    req.body = jsonEncode(body);

    final http.StreamedResponse res = await _client
        .send(req)
        .timeout(const Duration(seconds: 30));

    if (res.statusCode != 200) {
      final String errBody = await res.stream.bytesToString();
      String message = '';
      try {
        final Object? d = jsonDecode(errBody);
        if (d is Map<String, dynamic>) {
          message = (d['error'] as String?) ?? '';
        }
      } catch (_) {}
      if (res.statusCode == 403) {
        throw NoboFailure(
          NoboFailureKind.forbidden,
          message.isNotEmpty
              ? message
              : 'Nobogent AI is not enabled for this account yet.',
          detail: message,
        );
      }
      if (res.statusCode == 401) {
        throw NoboFailure(
          NoboFailureKind.unauthorized,
          'Your session has expired. Please sign in again.',
          detail: message,
        );
      }
      throw NoboFailure(
        NoboFailureKind.server,
        message.isNotEmpty ? message : 'The assistant is unavailable.',
        detail: 'HTTP ${res.statusCode}',
      );
    }

    // The server caps the stream at 60s; keep a generous client bound.
    yield* res.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .timeout(timeout);
  }

  /// Uploads raw bytes to a presigned storage URL (R2/S3).
  ///
  /// Deliberately does **not** send the app's auth headers: the presigned URL
  /// carries its own signature, and adding an Authorization header invalidates
  /// that signature on S3-compatible storage.
  Future<void> putBytes(
    String url,
    List<int> bytes, {
    required String contentType,
  }) async {
    final http.Response res = await _client
        .put(
          Uri.parse(url),
          headers: <String, String>{'Content-Type': contentType},
          body: bytes,
        )
        .timeout(const Duration(minutes: 2));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw NoboFailure(
        NoboFailureKind.server,
        'The file could not be uploaded.',
        detail: 'PUT ${res.statusCode}',
      );
    }
  }

  void dispose() => _client.close();
}
