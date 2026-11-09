import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/config/nobo_env.dart';
import '../models/profile.dart';
import 'nobo_failure.dart';

// Failure types live in their own library so the sealed agent-event hierarchy
// can reference them; re-exported here so callers have one import.
export 'nobo_failure.dart';

/// Authentication against the same Supabase GoTrue instance the PWA uses, so an
/// existing Nobogent account works unchanged.
///
/// Native clients keep the refresh token in secure storage and send
/// `Authorization: Bearer <accessToken>` to the Next.js API. We deliberately do
/// **not** attempt to replay the web app's SSR cookies: those chunk and rotate,
/// and `/api/*` is excluded from the middleware refresh loop, so a cookie client
/// would silently die after one hour.
class AuthRepository {
  AuthRepository(this._client);

  final SupabaseClient _client;

  GoTrueClient get _auth => _client.auth;

  Session? get currentSession => _auth.currentSession;
  User? get currentUser => _auth.currentUser;
  bool get isSignedIn => currentSession != null;

  String? get accessToken => currentSession?.accessToken;

  Stream<AuthState> get changes => _auth.onAuthStateChange;

  Future<NoboProfile?> signIn(String email, String password) async {
    try {
      final AuthResponse res = await _auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      final User? user = res.user;
      if (user == null) {
        throw const NoboFailure(
          NoboFailureKind.unauthorized,
          'We could not sign you in. Please try again.',
        );
      }
      return await fetchProfile(user.id);
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Mirrors the PWA: GoTrue creates the auth user, then the client upserts the
  /// `profiles` row. There is no database trigger, so skipping this leaves an
  /// account with no profile and a broken dashboard.
  Future<NoboProfile?> signUp({
    required String email,
    required String password,
    required String fullName,
    required String businessName,
  }) async {
    try {
      final AuthResponse res = await _auth.signUp(
        email: email.trim(),
        password: password,
        data: <String, dynamic>{
          'full_name': fullName.trim(),
          'business_name': businessName.trim(),
          'accepted_terms': true,
        },
      );
      final User? user = res.user;
      if (user == null) return null;
      try {
        await _client.from('profiles').upsert(<String, dynamic>{
          'id': user.id,
          'email': email.trim(),
          'full_name': fullName.trim(),
          'business_name': businessName.trim(),
          'role': 'client',
          'accepted_terms': true,
          'onboarding_completed': false,
        });
      } on PostgrestException catch (e) {
        // The auth user exists either way; do not fail the whole signup.
        debugPrint('profile upsert failed: ${e.message}');
      }
      return await fetchProfile(user.id);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<void> sendPasswordReset(String email) async {
    try {
      await _auth.resetPasswordForEmail(
        email.trim(),
        redirectTo: NoboEnv.oauthRedirect,
      );
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<void> signOut() async {
    try {
      await _auth.signOut();
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Reads the signed-in tenant profile.
  ///
  /// Every other query is scoped by this row's `id`, because RLS on the core
  /// tables is permissive (`USING (true)`) — the audit confirmed `user_id`
  /// filtering must be done by the application.
  Future<NoboProfile?> fetchProfile(String userId) async {
    try {
      final Map<String, dynamic>? row = await _client
          .from('profiles')
          .select()
          .eq('id', userId)
          .maybeSingle();
      if (row == null) return null;
      return NoboProfile.fromJson(row);
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Ensures the access token is fresh before a long-running request.
  Future<void> ensureFreshSession() async {
    try {
      final Session? s = _auth.currentSession;
      if (s == null) return;
      final DateTime expiry = DateTime.fromMillisecondsSinceEpoch(
        (s.expiresAt ?? 0) * 1000,
      );
      if (DateTime.now().isAfter(
        expiry.subtract(const Duration(minutes: 2)),
      )) {
        await _auth.refreshSession();
      }
    } catch (e) {
      debugPrint('refresh failed: $e');
    }
  }
}
