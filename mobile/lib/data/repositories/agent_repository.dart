import 'dart:async';

import '../../core/utils/json.dart';
import '../models/agent.dart';
import '../remote/nobo_http.dart';
import 'agent_stream_parser.dart';
import 'auth_repository.dart';

// Re-exported so screens can import a single repository surface.
export 'agent_stream_parser.dart';
export 'nobo_failure.dart';

/// Client for `POST /api/agent/v2/chat` and `POST /api/agent/v2/action`.
///
/// Two constraints come straight from the backend audit and shape this class:
///
/// 1. **There is no server-side conversation store.** The web app keeps agent
///    transcripts in `localStorage`, so the full message history must be re-sent
///    on every turn and the session owns its own transcript.
/// 2. **The endpoint is `super_admin`-gated.** A normal account receives 403,
///    which is surfaced as a typed [NoboFailure] so the UI can explain itself
///    instead of looking broken.
class AgentRepository {
  AgentRepository({required NoboHttp http, required AuthRepository auth})
    : _http = http,
      _auth = auth;

  final NoboHttp _http;
  final AuthRepository _auth;

  /// True when a session exists; the endpoint still enforces its own role gate.
  bool get isAuthenticated => _auth.isSignedIn;

  /// Sends one user turn and streams the assistant's response.
  ///
  /// [history] must exclude the new [prompt]; both are combined into the AI SDK
  /// UI-message array the endpoint expects.
  Stream<AgentEvent> send({
    required List<AgentMessage> history,
    required String prompt,
    bool preferReasoning = false,
    String? impersonateId,
  }) async* {
    final List<Map<String, dynamic>> wire = <Map<String, dynamic>>[
      for (final AgentMessage m in history)
        if (m.hasBody)
          <String, dynamic>{
            'id': m.id,
            'role': m.role == AgentRole.user ? 'user' : 'assistant',
            'parts': <Map<String, dynamic>>[
              <String, dynamic>{'type': 'text', 'text': m.text},
            ],
          },
      <String, dynamic>{
        'id': 'u-${DateTime.now().microsecondsSinceEpoch}',
        'role': 'user',
        'parts': <Map<String, dynamic>>[
          <String, dynamic>{'type': 'text', 'text': prompt},
        ],
      },
    ];

    final AgentStreamParser parser = AgentStreamParser();

    try {
      final Stream<String> lines = _http.postLines(
        '/api/agent/v2/chat',
        <String, dynamic>{
          'messages': wire,
          'preferReasoning': preferReasoning,
          if (impersonateId != null) 'impersonateId': impersonateId,
        },
        query: preferReasoning ? <String, String>{'reasoning': '1'} : null,
      );

      await for (final String raw in lines) {
        for (final AgentEvent event in parser.feedLine(raw)) {
          if (event is AgentStreamErrored) {
            yield AgentTurnFailed(
              NoboFailure(
                NoboFailureKind.server,
                event.message,
                detail: event.message,
              ),
            );
            return;
          }
          yield event;
          if (event is AgentTurnComplete) return;
        }
      }

      // Stream closed without an explicit terminator: still a completed turn.
      if (!parser.isDone) yield const AgentTurnComplete();
    } on NoboFailure catch (e) {
      yield AgentTurnFailed(e);
    } catch (e) {
      yield AgentTurnFailed(mapError(e));
    }
  }

  /// Resolves a pending approval.
  ///
  /// Note (from the audit): the backend records the decision but does not
  /// actually dispatch the underlying broadcast or call — it is a state-machine
  /// placeholder. The UI therefore says "approved", not "sent".
  Future<void> decide({required String actionId, required bool approve}) async {
    try {
      await _http.postJson('/api/agent/v2/action', <String, dynamic>{
        'actionId': actionId,
        'decision': approve ? 'approved' : 'rejected',
      });
    } catch (e) {
      throw mapError(e);
    }
  }
}

/// Convenience used by tests and callers that already have a decoded frame.
Map<String, dynamic> decodeFrame(String payload) => jMap(payload);
