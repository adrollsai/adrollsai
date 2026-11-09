import 'dart:convert';

import '../../core/utils/json.dart';
import '../models/agent.dart';
import 'nobo_failure.dart';

/// Incremental output from one agent turn.
sealed class AgentEvent {
  const AgentEvent();
}

class AgentTextDelta extends AgentEvent {
  const AgentTextDelta(this.delta);
  final String delta;
}

class AgentReasoningDelta extends AgentEvent {
  const AgentReasoningDelta(this.delta);
  final String delta;
}

class AgentStepStarted extends AgentEvent {
  const AgentStepStarted();
}

class AgentToolStarted extends AgentEvent {
  const AgentToolStarted({required this.toolCallId, required this.toolName});
  final String toolCallId;
  final String toolName;
}

class AgentToolFinished extends AgentEvent {
  const AgentToolFinished({
    required this.toolCallId,
    required this.artifacts,
    required this.failed,
    this.detail,
  });
  final String toolCallId;
  final List<AgentArtifact> artifacts;
  final bool failed;
  final String? detail;
}

/// The stream signalled completion (`data: [DONE]` or the stream closed).
class AgentTurnComplete extends AgentEvent {
  const AgentTurnComplete();
}

/// The endpoint reported an in-stream error frame.
class AgentStreamErrored extends AgentEvent {
  const AgentStreamErrored(this.message);
  final String message;
}

/// The turn cannot continue; carries a user-presentable failure.
///
/// Declared in this library because [AgentEvent] is `sealed` — the sealed
/// hierarchy must live in one library so the compiler can prove switches are
/// exhaustive.
class AgentTurnFailed extends AgentEvent {
  const AgentTurnFailed(this.failure);
  final NoboFailure failure;
}

/// Parses the AI SDK v6 *UI message stream* that
/// `POST /api/agent/v2/chat` returns.
///
/// Kept as a pure class with no HTTP or Flutter dependency so the wire format is
/// unit-tested directly against captured frames — the SSE contract is the most
/// brittle part of the integration, and it must not be verified only by running
/// the whole app against a live backend.
///
/// Frames are `data: {json}` lines; the payload `type` discriminates the part:
/// `text-delta`, `reasoning-delta`, `tool-input-start`, `tool-input-available`,
/// `tool-output-available`, `tool-output-error`, `error`, and the bookkeeping
/// `start` / `start-step` / `finish` / `finish-step`.
class AgentStreamParser {
  AgentStreamParser();

  /// Tool call id -> tool name, so a finished call can be labelled and so a
  /// `tool-output-available` for a call we never saw start still resolves.
  final Map<String, String> _toolNames = <String, String>{};

  final Set<String> _announced = <String>{};

  bool _done = false;

  /// True once the terminator frame has been consumed.
  bool get isDone => _done;

  /// Feeds one raw line. Returns the events it produced (usually 0 or 1).
  List<AgentEvent> feedLine(String rawLine) {
    final String line = rawLine.trim();
    if (line.isEmpty || !line.startsWith('data:')) return const <AgentEvent>[];

    final String payload = line.substring(5).trim();
    if (payload.isEmpty) return const <AgentEvent>[];
    if (payload == '[DONE]') {
      _done = true;
      return const <AgentEvent>[AgentTurnComplete()];
    }

    Map<String, dynamic> frame;
    try {
      final Object? decoded = jsonDecode(payload);
      if (decoded is! Map<String, dynamic>) return const <AgentEvent>[];
      frame = decoded;
    } catch (_) {
      // A malformed frame must never kill the stream.
      return const <AgentEvent>[];
    }

    return eventsForFrame(frame);
  }

  /// Exposed separately so a single decoded frame can be tested directly.
  List<AgentEvent> eventsForFrame(Map<String, dynamic> frame) {
    switch (jStrOr(frame['type'])) {
      case 'text-delta':
        final String d = jStrOr(frame['delta']);
        return d.isEmpty
            ? const <AgentEvent>[]
            : <AgentEvent>[AgentTextDelta(d)];

      case 'reasoning-delta':
        final String d = jStrOr(frame['delta']);
        return d.isEmpty
            ? const <AgentEvent>[]
            : <AgentEvent>[AgentReasoningDelta(d)];

      case 'start-step':
        return const <AgentEvent>[AgentStepStarted()];

      case 'tool-input-start':
      case 'tool-input-available':
        final String id = jStrOr(frame['toolCallId']);
        if (id.isEmpty) return const <AgentEvent>[];
        final String name = jStrOr(frame['toolName']);
        if (name.isNotEmpty) _toolNames[id] = name;
        // Announce each call exactly once, even though both events may arrive.
        if (!_announced.add(id)) return const <AgentEvent>[];
        return <AgentEvent>[AgentToolStarted(toolCallId: id, toolName: name)];

      case 'tool-output-available':
        final String id = jStrOr(frame['toolCallId']);
        return <AgentEvent>[
          AgentToolFinished(
            toolCallId: id,
            artifacts: extractArtifacts(frame['output']),
            failed: false,
            detail: summariseOutput(frame['output']),
          ),
        ];

      case 'tool-output-error':
        final String id = jStrOr(frame['toolCallId']);
        return <AgentEvent>[
          AgentToolFinished(
            toolCallId: id,
            artifacts: const <AgentArtifact>[],
            failed: true,
            detail: jStr(frame['errorText']),
          ),
        ];

      case 'error':
        return <AgentEvent>[
          AgentStreamErrored(
            jStr(frame['errorText']) ??
                jStr(frame['error']) ??
                'The assistant ran into a problem.',
          ),
        ];

      default:
        // start / finish / finish-step / data-* parts carry nothing the UI needs.
        return const <AgentEvent>[];
    }
  }

  String? toolNameFor(String toolCallId) => _toolNames[toolCallId];

  /// Finds an artifact anywhere in a tool output object.
  ///
  /// Tools nest it differently (`output.artifact`, the output itself, or inside
  /// a result wrapper), and the backend's declared artifact union is narrower
  /// than what is actually emitted — so this searches rather than assuming a
  /// single shape, and unknown kinds degrade instead of throwing.
  static List<AgentArtifact> extractArtifacts(Object? output) {
    final List<AgentArtifact> found = <AgentArtifact>[];

    void visit(Object? node, int depth) {
      if (depth > 4 || node == null) return;
      if (node is Map) {
        final Map<String, dynamic> m = jMap(node);
        if (m.containsKey('artifact')) {
          final AgentArtifact? a = AgentArtifact.tryParse(m['artifact']);
          if (a != null) found.add(a);
        }
        if (m.containsKey('type') &&
            (m.containsKey('videoUrl') ||
                m.containsKey('imageUrl') ||
                m.containsKey('actionId'))) {
          final AgentArtifact? a = AgentArtifact.tryParse(m);
          if (a != null) found.add(a);
        }
        for (final Object? v in m.values) {
          if (v is Map || v is List) visit(v, depth + 1);
        }
      } else if (node is List) {
        for (final Object? v in node) {
          if (v is Map || v is List) visit(v, depth + 1);
        }
      }
    }

    visit(output, 0);

    final Set<String> seen = <String>{};
    return found
        .where(
          (AgentArtifact a) => seen.add(
            '${a.kind}:${a.url}:${a.actionId}:${a.title}',
          ),
        )
        .toList(growable: false);
  }

  static String? summariseOutput(Object? output) {
    final Map<String, dynamic> m = jMap(output);
    final String? msg = jStr(m['message']) ?? jStr(m['summary']);
    if (msg == null) return null;
    return msg.length > 120 ? '${msg.substring(0, 120)}…' : msg;
  }
}
