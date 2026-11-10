import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/asset.dart';
import '../models/inbox_item.dart';
import '../models/lead.dart';
import '../models/profile.dart';
import '../models/project.dart';
import '../remote/nobo_http.dart';
import 'auth_repository.dart';

/// Reads the workspace from Supabase PostgREST directly.
///
/// Every query filters on `user_id` explicitly. This is not belt-and-braces:
/// the audit found that the `fix_all_rls_policies` migration replaced the real
/// `auth.uid() = user_id` predicates on `leads`, `assets`, `properties` and
/// `notifications` with `USING (true)`, so RLS will happily return other
/// tenants' rows to any authenticated user. The application must scope itself.
class WorkspaceRepository {
  WorkspaceRepository({
    required SupabaseClient client,
    required AuthRepository auth,
    required NoboHttp http,
  }) : _db = client,
       _auth = auth,
       _http = http;

  final SupabaseClient _db;
  final AuthRepository _auth;
  final NoboHttp _http;

  String get _uid {
    final String? id = _auth.currentUser?.id;
    if (id == null) {
      throw const NoboFailure(
        NoboFailureKind.unauthorized,
        'Please sign in to continue.',
      );
    }
    return id;
  }

  Future<NoboProfile?> profile() async {
    final String? id = _auth.currentUser?.id;
    if (id == null) return null;
    return _auth.fetchProfile(id);
  }

  Future<List<NoboProject>> projects() async {
    try {
      final List<Map<String, dynamic>> rows = await _db
          .from('properties')
          .select()
          .eq('user_id', _uid)
          .order('created_at', ascending: false);
      return rows.map(NoboProject.fromJson).toList(growable: false);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<NoboProject?> project(String id) async {
    try {
      final Map<String, dynamic>? row = await _db
          .from('properties')
          .select()
          .eq('user_id', _uid)
          .eq('id', id)
          .maybeSingle();
      if (row == null) return null;
      return NoboProject.fromJson(row);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<List<NoboAsset>> assets({int limit = 120, String? projectId}) async {
    try {
      var query = _db.from('assets').select().eq('user_id', _uid);
      if (projectId != null) {
        query = query.eq('property_id', projectId);
      }
      final List<Map<String, dynamic>> rows = await query
          .order('created_at', ascending: false)
          .limit(limit);
      return rows.map(NoboAsset.fromJson).toList(growable: false);
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Polls a single asset so an in-flight video can be tracked to completion.
  Future<NoboAsset?> asset(String id) async {
    try {
      final Map<String, dynamic>? row = await _db
          .from('assets')
          .select()
          .eq('user_id', _uid)
          .eq('id', id)
          .maybeSingle();
      if (row == null) return null;
      return NoboAsset.fromJson(row);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<List<NoboLead>> leads({int limit = 500}) async {
    try {
      final List<Map<String, dynamic>> rows = await _db
          .from('leads')
          .select()
          .eq('user_id', _uid)
          .order('created_at', ascending: false)
          .limit(limit);
      return rows.map(NoboLead.fromJson).toList(growable: false);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<NoboLead?> lead(String id) async {
    try {
      final Map<String, dynamic>? row = await _db
          .from('leads')
          .select()
          .eq('user_id', _uid)
          .eq('id', id)
          .maybeSingle();
      if (row == null) return null;
      return NoboLead.fromJson(row);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<List<InboxItem>> notifications({int limit = 100}) async {
    try {
      final List<Map<String, dynamic>> rows = await _db
          .from('notifications')
          .select()
          .eq('user_id', _uid)
          .order('created_at', ascending: false)
          .limit(limit);
      return rows.map(InboxItem.fromNotification).toList(growable: false);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<void> markNotificationRead(String id) async {
    try {
      await _db
          .from('notifications')
          .update(<String, dynamic>{'is_read': true})
          .eq('user_id', _uid)
          .eq('id', id);
    } catch (e) {
      throw mapError(e);
    }
  }

  Future<void> markAllNotificationsRead() async {
    try {
      await _db
          .from('notifications')
          .update(<String, dynamic>{'is_read': true})
          .eq('user_id', _uid)
          .eq('is_read', false);
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Writes lead activity and optionally moves the pipeline stage.
  ///
  /// Routed through `/api/crm/lead-action` rather than PostgREST because that
  /// endpoint also writes the `lead_history` audit row and the call counters,
  /// which the CRM relies on. It is one of the endpoints that accepts a Bearer
  /// token, so it works from a native client unchanged.
  Future<void> logLeadActivity({
    required String leadId,
    required String actionType,
    String? description,
    String? updateStage,
    DateTime? nextFollowup,
    bool incrementDnp = false,
  }) async {
    try {
      await _http.postJson('/api/crm/lead-action', <String, dynamic>{
        'leadId': leadId,
        'actionType': actionType,
        if (description != null) 'description': description,
        if (updateStage != null) 'updateStage': updateStage,
        if (nextFollowup != null)
          'nextFollowup': nextFollowup.toIso8601String(),
        if (incrementDnp) 'incrementDnp': true,
      });
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Persists the device's asset row after a direct-to-storage upload.
  ///
  /// `linkSessionId` is written into `assets.metadata` (a jsonb column that
  /// already exists) so an asset keeps its relationship to the task session
  /// that produced it, without any schema change.
  Future<NoboAsset?> createAssetRow({
    required String url,
    required AssetKind kind,
    String? projectId,
    String? caption,
    String? sessionId,
    Map<String, dynamic> extraMetadata = const <String, dynamic>{},
  }) async {
    try {
      final Map<String, dynamic> row = await _db
          .from('assets')
          .insert(<String, dynamic>{
            'user_id': _uid,
            'url': url,
            'type': kind.name,
            'status': 'Ready',
            if (caption != null) 'caption': caption,
            if (projectId != null) 'property_id': projectId,
            'metadata': <String, dynamic>{
              ...extraMetadata,
              if (sessionId != null) 'nobo_session_id': sessionId,
              'source': 'mobile',
            },
          })
          .select()
          .single();
      return NoboAsset.fromJson(row);
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Places a VoIP call to a lead from the app.
  ///
  /// This is the same server-side dial the web app's VoIP softphone performs
  /// (`POST /api/voice/vobiz/agent-call`, `action: 'dial'`): it rings the lead's
  /// phone through the workspace's Vobiz DID and records + transcribes the call.
  /// The route is super-admin gated, so the UI only offers it to owners.
  Future<Map<String, dynamic>> dialVoip({
    required String phone,
    String? leadId,
  }) async {
    try {
      return await _http.postJson(
        '/api/voice/vobiz/agent-call',
        <String, dynamic>{
          'action': 'dial',
          'toPhone': phone,
          if (leadId != null) 'leadId': leadId,
          'sessionId': 'mobile-${DateTime.now().microsecondsSinceEpoch}',
        },
      );
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Ends an in-progress VoIP call so the server finalises the record.
  Future<void> endVoip({required String callUuid, String? leadId}) async {
    try {
      await _http.postJson('/api/voice/vobiz/agent-call', <String, dynamic>{
        'action': 'hangup',
        'callUuid': callUuid,
        if (leadId != null) 'leadId': leadId,
      });
    } catch (e) {
      throw mapError(e);
    }
  }

  /// Soft-fails: callers may be offline; never block the UI on this.
  Future<void> safeMarkRead(String id) async {
    try {
      await markNotificationRead(id);
    } catch (e) {
      debugPrint('markRead failed: $e');
    }
  }
}
