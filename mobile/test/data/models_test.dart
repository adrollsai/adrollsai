import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/data/models/agent.dart';
import 'package:nobogent_mobile/data/models/asset.dart';
import 'package:nobogent_mobile/data/models/lead.dart';
import 'package:nobogent_mobile/data/models/project.dart';

/// The live schema drifts from the generated TypeScript types in the web repo
/// (audited: routes write columns `database.types.ts` does not declare, and
/// PostgREST returns `numeric` as String). These tests pin the defensive
/// parsing so a real payload cannot crash a screen.
void main() {
  group('NoboAsset — dual success states', () {
    test('"Ready" is terminal and playable', () {
      final NoboAsset a = NoboAsset.fromJson(<String, dynamic>{
        'id': 'a1',
        'type': 'video',
        'status': 'Ready',
        'url': 'https://cdn/x.mp4',
        'metadata': <String, dynamic>{
          'thumbnailUrl': 'https://cdn/x.jpg',
          'duration': 15,
        },
      });
      expect(a.status, AssetStatus.ready);
      expect(a.status.isTerminal, isTrue);
      expect(a.playableUrl, 'https://cdn/x.mp4');
      expect(a.previewUrl, 'https://cdn/x.jpg');
      expect(a.durationSeconds, 15);
    });

    test('"Draft" is ALSO terminal — the audit found two success values', () {
      final NoboAsset a = NoboAsset.fromJson(<String, dynamic>{
        'id': 'a2',
        'type': 'image',
        'status': 'Draft',
        'url': 'https://cdn/y.jpg',
      });
      expect(a.status, AssetStatus.ready);
      expect(a.status.isTerminal, isTrue);
    });

    test('the /processing URL sentinel means still working', () {
      final NoboAsset a = NoboAsset.fromJson(<String, dynamic>{
        'id': 'a3',
        'type': 'video',
        'status': null,
        'url': 'https://designs.example/processing',
      });
      expect(a.status, AssetStatus.processing);
      expect(a.playableUrl, isNull);
    });

    test('unknown status with a real URL is treated as ready', () {
      final NoboAsset a = NoboAsset.fromJson(<String, dynamic>{
        'id': 'a4',
        'type': 'image',
        'status': 'weird_new_state',
        'url': 'https://cdn/z.jpg',
      });
      expect(a.status, AssetStatus.ready);
    });

    test('failure carries the error from metadata', () {
      final NoboAsset a = NoboAsset.fromJson(<String, dynamic>{
        'id': 'a5',
        'type': 'video',
        'status': 'Failed',
        'url': '',
        'metadata': <String, dynamic>{'error': 'render timeout'},
      });
      expect(a.status, AssetStatus.failed);
      expect(a.error, 'render timeout');
      expect(a.previewUrl, isNull);
    });

    test('duration parsed when delivered as a numeric string', () {
      final NoboAsset a = NoboAsset.fromJson(<String, dynamic>{
        'id': 'a6',
        'type': 'video',
        'status': 'Ready',
        'url': 'https://cdn/v.mp4',
        'metadata': <String, dynamic>{'duration': '20'},
      });
      expect(a.durationSeconds, 20);
    });

    test('missing metadata object does not throw', () {
      final NoboAsset a = NoboAsset.fromJson(<String, dynamic>{
        'id': 'a7',
        'type': 'image',
        'status': 'Ready',
        'url': 'https://cdn/q.jpg',
        'metadata': null,
      });
      expect(a.thumbnailUrl, isNull);
      expect(a.durationSeconds, isNull);
    });
  });

  group('NoboLead', () {
    test('falls back to status when pipeline_stage is absent', () {
      final NoboLead l = NoboLead.fromJson(<String, dynamic>{
        'id': 'l1',
        'name': 'Raman Khurana',
        'status': 'Qualified',
      });
      expect(l.stage, 'Qualified');
      expect(l.isWon, isFalse);
    });

    test('dnp_count parsed when delivered as a string', () {
      final NoboLead l = NoboLead.fromJson(<String, dynamic>{
        'id': 'l2',
        'name': 'X',
        'dnp_count': '2',
      });
      expect(l.dnpCount, 2);
    });

    test('overdue is true only when unpaid and past its follow-up', () {
      final DateTime past = DateTime.now().subtract(const Duration(days: 2));
      final NoboLead open = NoboLead.fromJson(<String, dynamic>{
        'id': 'l3',
        'name': 'A',
        'pipeline_stage': 'Contacted',
        'next_followup': past.toIso8601String(),
      });
      final NoboLead won = NoboLead.fromJson(<String, dynamic>{
        'id': 'l4',
        'name': 'B',
        'pipeline_stage': 'Deal Won',
        'next_followup': past.toIso8601String(),
      });

      expect(open.isOverdue, isTrue);
      expect(won.isOverdue, isFalse, reason: 'a won lead cannot be overdue');
    });

    test('initials handle single and multiple word names', () {
      expect(
        NoboLead.fromJson(<String, dynamic>{'name': 'Priya Menon'}).initials,
        'PM',
      );
      expect(
        NoboLead.fromJson(<String, dynamic>{'name': 'Raman'}).initials,
        'R',
      );
      // A lead with no name falls back to the model's placeholder rather than
      // rendering an empty avatar.
      expect(
        NoboLead.fromJson(<String, dynamic>{}).initials,
        'UL',
        reason: 'defaults to "Unnamed lead"',
      );
    });

    test('stage classification matches the server-side categoriser', () {
      expect(LeadStages.isWon('Deal Won'), isTrue);
      expect(LeadStages.isNegative('Lost / Disqualified'), isTrue);
      expect(LeadStages.isNegative('Wrong Number'), isTrue);
      expect(LeadStages.isNegative('Qualified'), isFalse);
    });
  });

  group('NoboProject', () {
    test('cover prefers image_url then the first gallery image', () {
      final NoboProject explicit = NoboProject.fromJson(<String, dynamic>{
        'id': 'p1',
        'title': 'T',
        'image_url': 'https://cdn/cover.jpg',
        'images': <String>['https://cdn/other.jpg'],
      });
      expect(explicit.coverUrl, 'https://cdn/cover.jpg');

      final NoboProject gallery = NoboProject.fromJson(<String, dynamic>{
        'id': 'p2',
        'title': 'T',
        'images': <String>['https://cdn/first.jpg', 'https://cdn/second.jpg'],
      });
      expect(gallery.coverUrl, 'https://cdn/first.jpg');
    });

    test('price is presented in Indian units', () {
      String labelFor(num v) => NoboProject.fromJson(<String, dynamic>{
        'id': 'p',
        'title': 'T',
        'price': v,
      }).priceLabel;

      expect(labelFor(12400000), '₹1.24 Cr');
      expect(labelFor(8650000), '₹86.50 L');
      expect(labelFor(0), '—');
    });
  });

  group('AgentSession round-trip', () {
    test('serialises and restores messages, artifacts and state', () {
      final AgentSession original = AgentSession(
        id: 's1',
        title: 'Diwali film',
        projectId: 'p1',
        projectTitle: 'Amritha Vana',
        createdAt: DateTime(2026, 11, 9, 10),
        updatedAt: DateTime(2026, 11, 9, 11),
        state: SessionState.needsYou,
        messages: <AgentMessage>[
          AgentMessage(
            id: 'm1',
            role: AgentRole.user,
            text: 'Make a video',
            reasoning: '',
            artifacts: const <AgentArtifact>[],
            tools: const <AgentToolCall>[],
            at: DateTime(2026, 11, 9, 10),
            isStreaming: false,
            error: null,
          ),
          AgentMessage(
            id: 'm2',
            role: AgentRole.assistant,
            text: 'Ready to send.',
            reasoning: 'Check credits first.',
            artifacts: const <AgentArtifact>[
              AgentArtifact(
                kind: ArtifactKind.actionConfirmation,
                title: 'Broadcast',
                url: null,
                actionId: 'act_1',
                status: 'pending',
                description: 'd',
                estimatedCost: '116 credits',
                actionType: 'whatsapp_broadcast',
                question: null,
                options: <String>[],
                bodyText: null,
                durationSeconds: null,
              ),
            ],
            tools: const <AgentToolCall>[],
            at: DateTime(2026, 11, 9, 11),
            isStreaming: false,
            error: null,
          ),
        ],
      );

      final AgentSession restored = AgentSession.fromJson(original.toJson());

      expect(restored.id, 's1');
      expect(restored.title, 'Diwali film');
      expect(restored.state, SessionState.needsYou);
      expect(restored.messages.length, 2);
      expect(restored.messages.last.reasoning, 'Check credits first.');
      expect(restored.pendingApprovals, 1);
      expect(restored.preview, 'Ready to send.');
    });

    test('allArtifacts returns media newest-first', () {      final AgentSession s = AgentSession(
        id: 's2',
        title: 't',
        projectId: null,
        projectTitle: null,
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
        state: SessionState.done,
        messages: <AgentMessage>[
          AgentMessage(
            id: 'm',
            role: AgentRole.assistant,
            text: 'x',
            reasoning: '',
            artifacts: const <AgentArtifact>[
              AgentArtifact(
                kind: ArtifactKind.imagePreview,
                title: 'first',
                url: 'u1',
                actionId: null,
                status: 'ready',
                description: null,
                estimatedCost: null,
                actionType: null,
                question: null,
                options: <String>[],
                bodyText: null,
                durationSeconds: null,
              ),
              AgentArtifact(
                kind: ArtifactKind.videoPlayer,
                title: 'second',
                url: 'u2',
                actionId: null,
                status: 'ready',
                description: null,
                estimatedCost: null,
                actionType: null,
                question: null,
                options: <String>[],
                bodyText: null,
                durationSeconds: 15,
              ),
            ],
            tools: const <AgentToolCall>[],
            at: DateTime(2026),
            isStreaming: false,
            error: null,
          ),
        ],
      );

      expect(s.allArtifacts.first.title, 'second');
      expect(s.allArtifacts.length, 2);
    });
  });

  group('AgentSession persistence fidelity', () {
    // Regression guard: a transcript that has been closed and reopened must show
    // the owner exactly what they saw before. Losing tool steps or an approval's
    // cost silently changes the record of what was approved.
    test('tool calls and approval cost survive a save/load cycle', () {
      final AgentSession original = AgentSession(
        id: 's-persist',
        title: 'Broadcast',
        projectId: 'p1',
        projectTitle: 'Bluesquare Infra',
        createdAt: DateTime(2026, 11, 9, 9),
        updatedAt: DateTime(2026, 11, 9, 10),
        state: SessionState.needsYou,
        messages: <AgentMessage>[
          AgentMessage(
            id: 'm2',
            role: AgentRole.assistant,
            text: 'Ready to send.',
            reasoning: '',
            artifacts: const <AgentArtifact>[
              AgentArtifact(
                kind: ArtifactKind.actionConfirmation,
                title: 'WhatsApp broadcast to 116 leads',
                url: null,
                actionId: 'act_1',
                status: 'pending',
                description: 'Template: diwali_offer_2026',
                estimatedCost: '116 credits',
                actionType: 'whatsapp_broadcast',
                question: null,
                options: <String>[],
                bodyText: null,
                durationSeconds: null,
              ),
            ],
            tools: <AgentToolCall>[
              AgentToolCall(
                id: 'call-1',
                name: 'nobogent_crm_query_leads',
                label: ToolLabels.forTool('nobogent_crm_query_leads'),
                state: ToolRunState.done,
                detail: '116 matching leads',
                startedAt: DateTime(2026, 11, 9, 9, 58),
                finishedAt: DateTime(2026, 11, 9, 9, 59),
              ),
            ],
            at: DateTime(2026, 11, 9, 10),
            isStreaming: false,
            error: null,
          ),
        ],
      );

      final AgentSession restored =
          AgentSession.fromJson(original.toJson());
      final AgentMessage m = restored.messages.single;

      expect(m.tools.length, 1, reason: 'tool steps must not be dropped');
      expect(m.tools.single.name, 'nobogent_crm_query_leads');
      expect(m.tools.single.detail, '116 matching leads');
      expect(m.tools.single.state, ToolRunState.done);
      expect(m.tools.single.label, 'Checking your leads');

      final AgentArtifact a = m.artifacts.single;
      expect(a.estimatedCost, '116 credits');
      expect(a.actionType, 'whatsapp_broadcast');
      expect(a.description, 'Template: diwali_offer_2026');
      expect(a.isPendingApproval, isTrue);
    });

    test('image artifact duration and body survive a cycle', () {
      final AgentSession original = AgentSession(
        id: 's-dur',
        title: 't',
        projectId: null,
        projectTitle: null,
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
        state: SessionState.done,
        messages: <AgentMessage>[
          AgentMessage(
            id: 'm',
            role: AgentRole.assistant,
            text: 'x',
            reasoning: '',
            artifacts: const <AgentArtifact>[
              AgentArtifact(
                kind: ArtifactKind.videoPlayer,
                title: 'Film',
                url: 'https://cdn/f.mp4',
                actionId: null,
                status: 'ready',
                description: null,
                estimatedCost: null,
                actionType: null,
                question: null,
                options: <String>[],
                bodyText: null,
                durationSeconds: 30,
              ),
            ],
            tools: const <AgentToolCall>[],
            at: DateTime(2026),
            isStreaming: false,
            error: null,
          ),
        ],
      );
      final AgentArtifact a =
          AgentSession.fromJson(original.toJson()).messages.single.artifacts.single;
      expect(a.durationSeconds, 30);
      expect(a.url, 'https://cdn/f.mp4');
    });
  });
  group('ToolLabels', () {
    test('internal tool ids become owner-readable language', () {
      expect(
        ToolLabels.forTool('sandbox_publish_artifact'),
        'Publishing output',
      );
      expect(ToolLabels.forTool('request_human_approval'), contains('approval'));
    });

    test('unknown tools degrade to a readable sentence, never the raw id', () {
      final String label = ToolLabels.forTool('some_new_tool_name');
      expect(label, isNot(contains('_')));
      expect(label.startsWith('S'), isTrue);
    });
  });
}
