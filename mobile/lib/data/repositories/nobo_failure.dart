import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Why an operation failed, in terms the UI can act on.
enum NoboFailureKind {
  offline,
  unauthorized,
  forbidden,
  notFound,
  rateLimited,
  server,
  invalidCredentials,
  unknown,
}

/// A user-presentable failure.
///
/// No raw exception ever reaches a widget: [message] is written for a business
/// owner, [detail] is for logs only and is never rendered.
class NoboFailure implements Exception {
  const NoboFailure(this.kind, this.message, {this.detail});

  final NoboFailureKind kind;
  final String message;
  final String? detail;

  bool get isAuth => kind == NoboFailureKind.unauthorized;

  @override
  String toString() => 'NoboFailure(${kind.name}): $message';
}

/// Maps any thrown object to a [NoboFailure].
NoboFailure mapError(Object error) {
  if (error is NoboFailure) return error;

  if (error is AuthException) {
    final String code = (error.code ?? '').toLowerCase();
    final String msg = error.message.toLowerCase();
    if (code.contains('invalid_credentials') ||
        msg.contains('invalid login credentials')) {
      return NoboFailure(
        NoboFailureKind.invalidCredentials,
        'That email and password combination did not match.',
        detail: error.message,
      );
    }
    if (code.contains('email_not_confirmed')) {
      return NoboFailure(
        NoboFailureKind.unauthorized,
        'Please confirm your email address first — check your inbox.',
        detail: error.message,
      );
    }
    return NoboFailure(
      NoboFailureKind.unauthorized,
      'We could not sign you in. Please try again.',
      detail: error.message,
    );
  }

  if (error is PostgrestException) {
    final String code = error.code ?? '';
    if (code == '401' || code == 'PGRST301') {
      return NoboFailure(
        NoboFailureKind.unauthorized,
        'Your session has expired. Please sign in again.',
        detail: error.message,
      );
    }
    if (code == '403' || code == '42501') {
      return NoboFailure(
        NoboFailureKind.forbidden,
        'You do not have access to that.',
        detail: error.message,
      );
    }
    return NoboFailure(
      NoboFailureKind.server,
      'Something went wrong loading your data.',
      detail: error.message,
    );
  }

  final String s = error.toString();
  if (s.contains('SocketException') ||
      s.contains('Failed host lookup') ||
      s.contains('ClientException')) {
    return NoboFailure(
      NoboFailureKind.offline,
      'You appear to be offline. Check your connection and try again.',
      detail: s,
    );
  }

  if (kDebugMode) debugPrint('Unmapped error: $s');
  return NoboFailure(
    NoboFailureKind.unknown,
    'Something unexpected happened. Please try again.',
    detail: s,
  );
}
