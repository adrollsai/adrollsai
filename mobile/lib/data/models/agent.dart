import '../../core/utils/json.dart';

/// Who produced a message.
enum AgentRole { user, assistant, system }

/// Coarse state of a task session, used for the status pill in lists.
enum SessionState { idle, working, needsYou, done, failed }

/// A durable artefact produced by the agent — this is what makes the
/// conversation feel like a workspace rather than a chat log.
enum ArtifactKind {
  videoPlayer,
  imagePreview,
  actionConfirmation,
  userInputPrompt,
  whatsappPreview,
  htmlSandbox,
  progressTracker,
  unknown;

  static ArtifactKind parse(String? raw) {
    switch ((raw ?? '').trim()) {
      case 'video_player':
        return ArtifactKind.videoPlayer;
      case 'image_preview':
      case 'media_preview':
        return ArtifactKind.imagePreview;
      case 'action_confirmation':
        return ArtifactKind.actionConfirmation;
      case 'user_input_prompt':
        return ArtifactKind.userInputPrompt;
      case 'whatsapp_preview':
        return ArtifactKind.whatsappPreview;
      case 'html_sandbox':
        return ArtifactKind.htmlSandbox;
      case 'progress_tracker':
        return ArtifactKind.progressTracker;
      default:
        return ArtifactKind.unknown;
    }
  }
}

/// A rendered output of an agent action.
///
/// The backend's declared artifact union is narrower than what tools actually
/// emit, so parsing is defensive and unknown kinds degrade to a plain row
/// rather than throwing.
class AgentArtifact {
  const AgentArtifact({
    required this.kind,
    required this.title,
    required this.url,
    required this.actionId,
    required this.status,
    required this.description,
    required this.estimatedCost,
    required this.actionType,
    required this.question,
    required this.options,
    required this.bodyText,
    required this.durationSeconds,
  });

  final ArtifactKind kind;
  final String? title;
  final String? url;
  final String? actionId;
  final String? status;
  final String? description;
  final String? estimatedCost;
  final String? actionType;
  final String? question;
  final List<String> options;
  final String? bodyText;
  final int? durationSeconds;

  bool get isPendingApproval =>
      kind == ArtifactKind.actionConfirmation &&
      (status ?? 'pending') == 'pending';

  static AgentArtifact? tryParse(Object? raw) {
    final Map<String, dynamic> m = jMap(raw);
    if (m.isEmpty) return null;
    final ArtifactKind kind = ArtifactKind.parse(jStr(m['type']));
    if (kind == ArtifactKind.unknown) {
      final String? u = jStr(m['url']);
      if (u == null) return null;
    }
    return AgentArtifact(
      kind: kind,
      title: jStr(m['title']),
      url: jStr(m['url']) ?? jStr(m['videoUrl']) ?? jStr(m['imageUrl']),
      actionId: jStr(m['actionId']),
      status: jStr(m['status']),
      description: jStr(m['description']),
      estimatedCost: jStr(m['estimatedCost']),
      actionType: jStr(m['actionType']),
      question: jStr(m['question']),
      options: jListStrs(m['suggestedOptions'] ?? m['options']),
      bodyText: jStr(m['body']) ?? jStr(m['message']) ?? jStr(m['text']),
      durationSeconds: jIntN(m['duration']),
    );
  }
}

/// Lifecycle of one agent tool invocation, rendered as an execution timeline.
enum ToolRunState { running, done, failed }

class AgentToolCall {
  const AgentToolCall({
    required this.id,
    required this.name,
    required this.state,
    required this.label,
    required this.detail,
    required this.startedAt,
    required this.finishedAt,
  });

  final String id;
  final String name;
  final ToolRunState state;

  /// Human-readable tool name. Owners should never see `sandbox_publish_artifact`.
  final String label;
  final String? detail;
  final DateTime? startedAt;
  final DateTime? finishedAt;

  Duration? get elapsed {
    final DateTime? s = startedAt;
    final DateTime? f = finishedAt;
    if (s == null || f == null) return null;
    return f.difference(s);
  }

  AgentToolCall copyWith({
    ToolRunState? state,
    String? detail,
    DateTime? finishedAt,
  }) {
    return AgentToolCall(
      id: id,
      name: name,
      state: state ?? this.state,
      label: label,
      detail: detail ?? this.detail,
      startedAt: startedAt,
      finishedAt: finishedAt ?? this.finishedAt,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'state': state.name,
    'detail': detail,
    'startedAt': startedAt?.toIso8601String(),
    'finishedAt': finishedAt?.toIso8601String(),
  };

  factory AgentToolCall.fromJson(Map<String, dynamic> json) {
    final String name = jStrOr(json['name']);
    return AgentToolCall(
      id: jStrOr(json['id']),
      name: name,
      // Re-derive the label rather than trusting a stored string, so copy
      // changes to [ToolLabels] apply to existing transcripts.
      label: ToolLabels.forTool(name),
      state: ToolRunState.values.firstWhere(
        (ToolRunState s) => s.name == jStrOr(json['state'], 'done'),
        orElse: () => ToolRunState.done,
      ),
      detail: jStr(json['detail']),
      startedAt: jDate(json['startedAt']),
      finishedAt: jDate(json['finishedAt']),
    );
  }
}

/// Maps internal tool ids to language a business owner understands.
abstract final class ToolLabels {
  const ToolLabels._();

  static String forTool(String tool) {
    const Map<String, String> map = <String, String>{
      'sandbox_bash_run': 'Running workspace command',
      'sandbox_write_file': 'Writing file',
      'sandbox_read_file': 'Reading file',
      'sandbox_list_files': 'Browsing workspace files',
      'sandbox_publish_artifact': 'Publishing output',
      'sandbox_render_video': 'Rendering video',
      'sandbox_render_hyperframes': 'Rendering motion graphics',
      'sandbox_write_and_run': 'Building and running',
      'request_human_approval': 'Waiting for your approval',
      'request_user_input': 'Needs your input',
      'spawn_dynamic_subagent': 'Delegating to a sub-agent',
      'deepseek_web_search': 'Searching the web',
      'deepseek_web_fetch': 'Reading a page',
      'mcp_fetch_web_content': 'Reading a page',
      'nobogent_brand_get_profile': 'Reading your brand profile',
      'nobogent_crm_query_leads': 'Checking your leads',
      'nobogent_crm_create_lead': 'Adding a lead',
      'nobogent_inventory_search': 'Searching your projects',
      'nobogent_whatsapp_list_templates': 'Listing WhatsApp templates',
      'nobogent_whatsapp_send_template': 'Sending WhatsApp message',
      'nobogent_voice_dispatch_call': 'Placing a call',
      'nobogent_assets_list': 'Looking through your assets',
      'meta_mcp_list_campaigns': 'Checking ad campaigns',
      'meta_mcp_create_campaign': 'Creating a campaign',
      'meta_mcp_get_insights': 'Pulling campaign insights',
      'meta_mcp_launch_leadgen_campaign': 'Launching lead campaign',
      'schedule_agent_task': 'Scheduling a task',
      'list_scheduled_tasks': 'Checking scheduled tasks',
      'list_user_files': 'Listing your files',
      'organize_or_move_file': 'Organising files',
      'search_24fps_motion_graphics': 'Searching motion graphics',
    };
    if (map.containsKey(tool)) return map[tool]!;
    // Fall back to a de-underscored, sentence-cased version.
    final String spaced = tool.replaceAll('_', ' ').trim();
    if (spaced.isEmpty) return 'Working';
    return spaced[0].toUpperCase() + spaced.substring(1);
  }
}

/// One turn in a task session.
class AgentMessage {
  const AgentMessage({
    required this.id,
    required this.role,
    required this.text,
    required this.reasoning,
    required this.artifacts,
    required this.tools,
    required this.at,
    required this.isStreaming,
    required this.error,
  });

  final String id;
  final AgentRole role;
  final String text;

  /// Model reasoning, shown collapsed — useful, but never the headline.
  final String reasoning;
  final List<AgentArtifact> artifacts;
  final List<AgentToolCall> tools;
  final DateTime at;
  final bool isStreaming;
  final String? error;

  bool get isUser => role == AgentRole.user;
  bool get hasBody => text.trim().isNotEmpty;
  bool get isThinking =>
      isStreaming && !hasBody && tools.isEmpty && artifacts.isEmpty;

  /// True while the assistant is mid-flight with visible progress.
  bool get isBusy => isStreaming;

  AgentMessage copyWith({
    String? text,
    String? reasoning,
    List<AgentArtifact>? artifacts,
    List<AgentToolCall>? tools,
    bool? isStreaming,
    String? error,
  }) {
    return AgentMessage(
      id: id,
      role: role,
      text: text ?? this.text,
      reasoning: reasoning ?? this.reasoning,
      artifacts: artifacts ?? this.artifacts,
      tools: tools ?? this.tools,
      at: at,
      isStreaming: isStreaming ?? this.isStreaming,
      error: error ?? this.error,
    );
  }

  factory AgentMessage.fromJson(Map<String, dynamic> json) {
    return AgentMessage(
      id: jStrOr(json['id']),
      role: switch (jStrOr(json['role'], 'assistant')) {
        'user' => AgentRole.user,
        'system' => AgentRole.system,
        _ => AgentRole.assistant,
      },
      text: jStrOr(json['text']),
      reasoning: jStrOr(json['reasoning']),
      artifacts: jListMaps(json['artifacts'])
          .map(AgentArtifact.tryParse)
          .whereType<AgentArtifact>()
          .toList(growable: false),
      tools: jListMaps(json['tools'])
          .map(AgentToolCall.fromJson)
          .toList(growable: false),
      at: jDateOr(json['at'], DateTime.now()),
      isStreaming: false,
      error: jStr(json['error']),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'role': role.name,
    'text': text,
    'reasoning': reasoning,
    // Every field an artifact carries must round-trip: dropping the approval
    // cost or the action type would silently change what the owner was shown
    // when they made their decision.
    'artifacts': artifacts
        .map(
          (AgentArtifact a) => <String, dynamic>{
            'type': switch (a.kind) {
              ArtifactKind.videoPlayer => 'video_player',
              ArtifactKind.imagePreview => 'image_preview',
              ArtifactKind.actionConfirmation => 'action_confirmation',
              ArtifactKind.userInputPrompt => 'user_input_prompt',
              ArtifactKind.whatsappPreview => 'whatsapp_preview',
              ArtifactKind.htmlSandbox => 'html_sandbox',
              ArtifactKind.progressTracker => 'progress_tracker',
              ArtifactKind.unknown => 'unknown',
            },
            'title': a.title,
            'url': a.url,
            'actionId': a.actionId,
            'status': a.status,
            'description': a.description,
            'estimatedCost': a.estimatedCost,
            'actionType': a.actionType,
            'question': a.question,
            'options': a.options,
            'body': a.bodyText,
            'duration': a.durationSeconds,
          },
        )
        .toList(),
    'tools': tools.map((AgentToolCall t) => t.toJson()).toList(),
    'at': at.toIso8601String(),
    'error': error,
  };
}

/// An independent unit of agent work.
///
/// The backend has **no** conversation or task store — the web app keeps agent
/// history in `localStorage`. Sessions are therefore owned and persisted by the
/// client, which is the only backward-compatible option: it needs no schema
/// change and keeps the PWA working untouched. New assets created inside a
/// session are tagged with the session id in `assets.metadata` so the
/// workspace → project → task → asset chain survives.
class AgentSession {
  const AgentSession({
    required this.id,
    required this.title,
    required this.projectId,
    required this.projectTitle,
    required this.createdAt,
    required this.updatedAt,
    required this.messages,
    required this.state,
  });

  final String id;
  final String title;
  final String? projectId;
  final String? projectTitle;
  final DateTime createdAt;
  final DateTime updatedAt;
  final List<AgentMessage> messages;
  final SessionState state;

  bool get isEmpty => messages.isEmpty;

  String get preview {
    for (final AgentMessage m in messages.reversed) {
      if (m.text.trim().isNotEmpty) {
        final String t = m.text.trim().replaceAll(RegExp(r'\s+'), ' ');
        return t.length > 110 ? '${t.substring(0, 110)}…' : t;
      }
    }
    return 'No messages yet';
  }

  /// Every artifact produced in this session, newest first — the session's
  /// output shelf.
  List<AgentArtifact> get allArtifacts => messages
      .expand((AgentMessage m) => m.artifacts)
      .where(
        (AgentArtifact a) =>
            a.kind == ArtifactKind.videoPlayer ||
            a.kind == ArtifactKind.imagePreview,
      )
      .toList(growable: false)
      .reversed
      .toList(growable: false);

  int get pendingApprovals => messages
      .expand((AgentMessage m) => m.artifacts)
      .where((AgentArtifact a) => a.isPendingApproval)
      .length;

  AgentSession copyWith({
    String? title,
    String? projectId,
    String? projectTitle,
    DateTime? updatedAt,
    List<AgentMessage>? messages,
    SessionState? state,
  }) {
    return AgentSession(
      id: id,
      title: title ?? this.title,
      projectId: projectId ?? this.projectId,
      projectTitle: projectTitle ?? this.projectTitle,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      messages: messages ?? this.messages,
      state: state ?? this.state,
    );
  }

  factory AgentSession.fromJson(Map<String, dynamic> json) {
    return AgentSession(
      id: jStrOr(json['id']),
      title: jStrOr(json['title'], 'Untitled task'),
      projectId: jStr(json['projectId']),
      projectTitle: jStr(json['projectTitle']),
      createdAt: jDateOr(json['createdAt'], DateTime.now()),
      updatedAt: jDateOr(json['updatedAt'], DateTime.now()),
      messages: jListMaps(json['messages'])
          .map(AgentMessage.fromJson)
          .toList(growable: false),
      state: SessionState.values.firstWhere(
        (SessionState s) => s.name == jStrOr(json['state'], 'idle'),
        orElse: () => SessionState.idle,
      ),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'title': title,
    'projectId': projectId,
    'projectTitle': projectTitle,
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
    'messages': messages.map((AgentMessage m) => m.toJson()).toList(),
    'state': state.name,
  };
}
