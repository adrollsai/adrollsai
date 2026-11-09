import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/data/models/agent.dart';
import 'package:nobogent_mobile/data/repositories/agent_stream_parser.dart';

/// These fixtures are the real frame shapes emitted by
/// `result.toUIMessageStreamResponse({sendReasoning: true})` from the AI SDK v6
/// used by `/api/agent/v2/chat`. The wire contract is the most brittle part of
/// the integration, so it is pinned here rather than verified only by hand.
void main() {
  String frame(Map<String, dynamic> json) => 'data: ${jsonEncode(json)}';

  group('AgentStreamParser — text and reasoning', () {
    test('accumulates text deltas in order', () {
      final AgentStreamParser p = AgentStreamParser();
      final List<String> seen = <String>[];

      for (final String line in <String>[
        frame(<String, dynamic>{'type': 'start', 'messageId': 'm1'}),
        frame(<String, dynamic>{'type': 'start-step'}),
        frame(<String, dynamic>{'type': 'text-start', 'id': 't1'}),
        frame(<String, dynamic>{'type': 'text-delta', 'id': 't1', 'delta': 'Done. '}),
        frame(<String, dynamic>{'type': 'text-delta', 'id': 't1', 'delta': 'Rendered.'}),
        frame(<String, dynamic>{'type': 'text-end', 'id': 't1'}),
        frame(<String, dynamic>{'type': 'finish-step'}),
        frame(<String, dynamic>{'type': 'finish'}),
        'data: [DONE]',
      ]) {
        for (final AgentEvent e in p.feedLine(line)) {
          if (e is AgentTextDelta) seen.add(e.delta);
        }
      }

      expect(seen.join(), 'Done. Rendered.');
      expect(p.isDone, isTrue);
    });

    test('separates reasoning from visible text', () {
      final AgentStreamParser p = AgentStreamParser();
      final List<AgentEvent> events = <AgentEvent>[
        ...p.feedLine(
          frame(<String, dynamic>{
            'type': 'reasoning-delta',
            'id': 'r1',
            'delta': 'Owner wants vertical.',
          }),
        ),
        ...p.feedLine(
          frame(<String, dynamic>{
            'type': 'text-delta',
            'id': 't1',
            'delta': 'On it.',
          }),
        ),
      ];

      expect(events.whereType<AgentReasoningDelta>().length, 1);
      expect(events.whereType<AgentTextDelta>().length, 1);
      expect(
        events.whereType<AgentReasoningDelta>().first.delta,
        'Owner wants vertical.',
      );
    });

    test('ignores empty deltas rather than emitting blank events', () {
      final AgentStreamParser p = AgentStreamParser();
      expect(
        p.feedLine(frame(<String, dynamic>{'type': 'text-delta', 'delta': ''})),
        isEmpty,
      );
    });
  });

  group('AgentStreamParser — tool lifecycle', () {
    test('announces a tool once even though two events arrive', () {
      final AgentStreamParser p = AgentStreamParser();
      final List<AgentEvent> a = p.feedLine(
        frame(<String, dynamic>{
          'type': 'tool-input-start',
          'toolCallId': 'call-1',
          'toolName': 'sandbox_render_video',
        }),
      );
      final List<AgentEvent> b = p.feedLine(
        frame(<String, dynamic>{
          'type': 'tool-input-available',
          'toolCallId': 'call-1',
          'toolName': 'sandbox_render_video',
          'input': <String, dynamic>{'duration': 15},
        }),
      );

      expect(a.whereType<AgentToolStarted>().length, 1);
      expect(b, isEmpty, reason: 'second event must not re-announce');
      expect(p.toolNameFor('call-1'), 'sandbox_render_video');
    });

    test('extracts a video artifact from a nested tool output', () {
      final AgentStreamParser p = AgentStreamParser();
      final List<AgentEvent> events = p.feedLine(
        frame(<String, dynamic>{
          'type': 'tool-output-available',
          'toolCallId': 'call-9',
          'output': <String, dynamic>{
            'success': true,
            'message': 'Rendered a 15 second film',
            'artifact': <String, dynamic>{
              'type': 'video_player',
              'title': 'Diwali film',
              'videoUrl': 'https://cdn.example/film.mp4',
              'duration': 15,
            },
          },
        }),
      );

      final AgentToolFinished done = events.whereType<AgentToolFinished>().single;
      expect(done.failed, isFalse);
      expect(done.artifacts.length, 1);
      expect(done.artifacts.first.kind, ArtifactKind.videoPlayer);
      expect(done.artifacts.first.url, 'https://cdn.example/film.mp4');
      expect(done.artifacts.first.durationSeconds, 15);
      expect(done.detail, 'Rendered a 15 second film');
    });

    test('extracts an approval artifact and marks it pending', () {
      final List<AgentArtifact> artifacts = AgentStreamParser.extractArtifacts(
        <String, dynamic>{
          'artifact': <String, dynamic>{
            'type': 'action_confirmation',
            'actionId': 'act_abc123',
            'title': 'WhatsApp broadcast to 116 leads',
            'description': 'Template: diwali_offer_2026',
            'estimatedCost': '116 credits',
            'actionType': 'whatsapp_broadcast',
            'status': 'pending',
          },
        },
      );

      expect(artifacts.length, 1);
      final AgentArtifact a = artifacts.first;
      expect(a.kind, ArtifactKind.actionConfirmation);
      expect(a.actionId, 'act_abc123');
      expect(a.estimatedCost, '116 credits');
      expect(a.isPendingApproval, isTrue);
    });

    test('de-duplicates identical artifacts across nested wrappers', () {
      final List<AgentArtifact> artifacts = AgentStreamParser.extractArtifacts(
        <String, dynamic>{
          'artifact': <String, dynamic>{
            'type': 'image_preview',
            'imageUrl': 'https://cdn.example/a.jpg',
            'title': 'Frame 1',
          },
          'also': <String, dynamic>{
            'artifact': <String, dynamic>{
              'type': 'image_preview',
              'imageUrl': 'https://cdn.example/a.jpg',
              'title': 'Frame 1',
            },
          },
        },
      );

      expect(artifacts.length, 1);
    });

    test('a failed tool is reported as failed with no artifacts', () {
      final AgentStreamParser p = AgentStreamParser();
      final List<AgentEvent> events = p.feedLine(
        frame(<String, dynamic>{
          'type': 'tool-output-error',
          'toolCallId': 'call-3',
          'errorText': 'Sandbox timed out',
        }),
      );
      final AgentToolFinished done = events.whereType<AgentToolFinished>().single;
      expect(done.failed, isTrue);
      expect(done.detail, 'Sandbox timed out');
      expect(done.artifacts, isEmpty);
    });
  });

  group('AgentStreamParser — resilience', () {
    test('malformed JSON does not kill the stream', () {
      final AgentStreamParser p = AgentStreamParser();
      expect(p.feedLine('data: {not json'), isEmpty);
      expect(p.isDone, isFalse);
      // The stream keeps working afterwards.
      final List<AgentEvent> after = p.feedLine(
        frame(<String, dynamic>{'type': 'text-delta', 'delta': 'still alive'}),
      );
      expect(after.whereType<AgentTextDelta>().first.delta, 'still alive');
    });

    test('non-SSE lines and comments are ignored', () {
      final AgentStreamParser p = AgentStreamParser();
      expect(p.feedLine(''), isEmpty);
      expect(p.feedLine(': keep-alive'), isEmpty);
      expect(p.feedLine('event: ping'), isEmpty);
    });

    test('in-stream error frame surfaces a message', () {
      final AgentStreamParser p = AgentStreamParser();
      final List<AgentEvent> events = p.feedLine(
        frame(<String, dynamic>{
          'type': 'error',
          'errorText': 'E2B sandbox unavailable',
        }),
      );
      expect(
        events.whereType<AgentStreamErrored>().single.message,
        'E2B sandbox unavailable',
      );
    });

    test('unknown frame types are ignored, not fatal', () {
      final AgentStreamParser p = AgentStreamParser();
      expect(
        p.feedLine(
          frame(<String, dynamic>{'type': 'message-metadata', 'x': 1}),
        ),
        isEmpty,
      );
      expect(
        p.feedLine(frame(<String, dynamic>{'type': 'data-custom-part'})),
        isEmpty,
      );
    });

    test('extractArtifacts survives non-map output', () {
      expect(AgentStreamParser.extractArtifacts(null), isEmpty);
      expect(AgentStreamParser.extractArtifacts('nope'), isEmpty);
      expect(AgentStreamParser.extractArtifacts(<int>[1, 2, 3]), isEmpty);
    });
  });
}
