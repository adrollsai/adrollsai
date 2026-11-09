import '../../core/utils/json.dart';
import 'agent.dart';

/// What kind of thing needs attention.
enum InboxKind {
  approval,
  question,
  taskDone,
  taskFailed,
  lead,
  system;

  String get label => switch (this) {
    InboxKind.approval => 'Approval',
    InboxKind.question => 'Question',
    InboxKind.taskDone => 'Completed',
    InboxKind.taskFailed => 'Failed',
    InboxKind.lead => 'Lead',
    InboxKind.system => 'System',
  };
}

/// How loudly to present an item.
enum InboxPriority { requiresAction, update, passive }

/// One actionable row in the Inbox.
///
/// Inbox is deliberately *not* an email clone: it merges notifications with
/// pending agent approvals and questions, so the owner can clear everything
/// from one place.
class InboxItem {
  const InboxItem({
    required this.id,
    required this.kind,
    required this.priority,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.isRead,
    required this.actionId,
    required this.sessionId,
    required this.leadId,
    required this.actionLink,
  });

  final String id;
  final InboxKind kind;
  final InboxPriority priority;
  final String title;
  final String? body;
  final DateTime createdAt;
  final bool isRead;

  /// Present for approval items — passed straight to the decision endpoint.
  final String? actionId;
  final String? sessionId;
  final String? leadId;
  final String? actionLink;

  bool get needsDecision => kind == InboxKind.approval;

  InboxItem asRead() => InboxItem(
    id: id,
    kind: kind,
    priority: priority,
    title: title,
    body: body,
    createdAt: createdAt,
    isRead: true,
    actionId: actionId,
    sessionId: sessionId,
    leadId: leadId,
    actionLink: actionLink,
  );

  /// From the `notifications` table.
  factory InboxItem.fromNotification(Map<String, dynamic> json) {
    final String type = (jStr(json['type']) ?? '').toLowerCase();
    final InboxKind kind = switch (type) {
      'approval' || 'action_required' => InboxKind.approval,
      'agent_question' => InboxKind.question,
      'task_failed' || 'error' => InboxKind.taskFailed,
      'task_completed' || 'agent' || 'success' => InboxKind.taskDone,
      'lead' || 'fresh_lead' || 'lead_assigned' => InboxKind.lead,
      _ => InboxKind.system,
    };
    return InboxItem(
      id: jStrOr(json['id']),
      kind: kind,
      priority: jBool(json['is_read'])
          ? InboxPriority.passive
          : (kind == InboxKind.approval || kind == InboxKind.question
                ? InboxPriority.requiresAction
                : InboxPriority.update),
      title: jStrOr(json['title'], 'Update'),
      body: jStr(json['message']),
      createdAt: jDateOr(json['created_at'], DateTime.now()),
      isRead: jBool(json['is_read']),
      actionId: null,
      sessionId: null,
      leadId: null,
      actionLink: jStr(json['action_link']),
    );
  }

  /// From a pending `action_confirmation` artifact inside a session.
  factory InboxItem.fromApproval(AgentArtifact artifact, AgentSession session) {
    return InboxItem(
      id: 'approval-${artifact.actionId ?? artifact.hashCode}',
      kind: InboxKind.approval,
      priority: InboxPriority.requiresAction,
      title: artifact.title ?? 'Approval required',
      body: artifact.description,
      createdAt: session.updatedAt,
      isRead: false,
      actionId: artifact.actionId,
      sessionId: session.id,
      leadId: null,
      actionLink: null,
    );
  }

  /// From an agent question awaiting a reply.
  factory InboxItem.fromQuestion(AgentArtifact artifact, AgentSession session) {
    return InboxItem(
      id: 'question-${artifact.actionId ?? artifact.hashCode}',
      kind: InboxKind.question,
      priority: InboxPriority.requiresAction,
      title: artifact.title ?? 'Nobogent has a question',
      body: artifact.question ?? artifact.bodyText,
      createdAt: session.updatedAt,
      isRead: false,
      actionId: null,
      sessionId: session.id,
      leadId: null,
      actionLink: null,
    );
  }
}
