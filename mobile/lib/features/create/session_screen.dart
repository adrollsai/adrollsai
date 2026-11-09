import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/platform/nobo_platform.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../core/ui/agent_widgets.dart';
import '../../core/ui/controls.dart';
import '../../core/ui/feedback.dart';
import '../../core/ui/orbit_mark.dart';
import '../../core/ui/surfaces.dart';
import '../../data/models/agent.dart';
import '../../data/repositories/agent_repository.dart';

/// A single independent task session.
///
/// Each session owns its conversation and execution context. Because the
/// backend keeps no server-side transcript, the full history is re-sent on every
/// turn — so this screen is the source of truth while it is open, and persists
/// to the device on every completed turn.
class SessionScreen extends ConsumerStatefulWidget {
  const SessionScreen({
    required this.sessionId,
    this.initialPrompt,
    this.initialTitle,
    super.key,
  });

  final String sessionId;
  final String? initialPrompt;
  final String? initialTitle;

  @override
  ConsumerState<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends ConsumerState<SessionScreen> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final FocusNode _focus = FocusNode();

  AgentSession? _session;
  bool _busy = false;
  bool _loaded = false;
  NoboFailure? _failure;
  String? _pendingActionId;

  /// Artifacts produced so far in the current turn, accumulated across tools.
  List<AgentArtifact> _turnArtifacts = const <AgentArtifact>[];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final AgentSession? s = await ref
        .read(sessionRepositoryProvider)
        .byId(widget.sessionId);
    if (!mounted) return;

    if (s == null) {
      setState(() => _loaded = true);
      return;
    }

    AgentSession working = s;
    if (widget.initialTitle != null && s.title == 'New task') {
      working = s.copyWith(title: widget.initialTitle);
    }
    setState(() {
      _session = working;
      _loaded = true;
    });

    final String? prompt = widget.initialPrompt;
    if (prompt != null && prompt.isNotEmpty && working.messages.isEmpty) {
      await _send(prompt);
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 160,
        duration: NoboMotion.medium,
        curve: NoboMotion.standard,
      );
    });
  }

  String _id(String prefix) =>
      '$prefix-${DateTime.now().microsecondsSinceEpoch}';

  Future<void> _persist(AgentSession session) async {
    setState(() => _session = session);
    await ref.read(sessionsProvider.notifier).save(session);
  }

  Future<void> _send(String raw) async {
    final AgentSession? current = _session;
    final String text = raw.trim();
    if (current == null || text.isEmpty || _busy) return;

    _input.clear();
    unawaited(HapticFeedback.lightImpact());

    final AgentMessage userMessage = AgentMessage(
      id: _id('u'),
      role: AgentRole.user,
      text: text,
      reasoning: '',
      artifacts: const <AgentArtifact>[],
      tools: const <AgentToolCall>[],
      at: DateTime.now(),
      isStreaming: false,
      error: null,
    );

    final AgentMessage placeholder = AgentMessage(
      id: _id('a'),
      role: AgentRole.assistant,
      text: '',
      reasoning: '',
      artifacts: const <AgentArtifact>[],
      tools: const <AgentToolCall>[],
      at: DateTime.now(),
      isStreaming: true,
      error: null,
    );

    final List<AgentMessage> history = <AgentMessage>[
      ...current.messages,
      userMessage,
    ];

    AgentSession session = current.copyWith(
      messages: <AgentMessage>[...history, placeholder],
      state: SessionState.working,
      updatedAt: DateTime.now(),
      // First user message becomes the session title, like every chat product.
      title: current.messages.isEmpty
          ? _titleFrom(text)
          : current.title,
    );

    setState(() {
      _busy = true;
      _failure = null;
      _session = session;
    });
    _scrollToEnd();

    final AgentRepository agent = ref.read(agentRepositoryProvider);
    final List<AgentMessage> streaming = session.messages;
    final int index = streaming.length - 1;

    String textBuffer = '';
    String reasoningBuffer = '';
    List<AgentToolCall> tools = <AgentToolCall>[];
    List<AgentArtifact> artifacts = <AgentArtifact>[];
    _turnArtifacts = const <AgentArtifact>[];

    try {
      await for (final AgentEvent event in agent.send(
        history: history,
        prompt: text,
      )) {
        switch (event) {
          case AgentTextDelta(:final String delta):
            textBuffer += delta;
            streaming[index] = streaming[index].copyWith(text: textBuffer);
            setState(() {});
            _scrollToEnd();
          case AgentReasoningDelta(:final String delta):
            reasoningBuffer += delta;
            streaming[index] = streaming[index].copyWith(
              reasoning: reasoningBuffer,
            );
            setState(() {});
          case AgentStepStarted():
            break;
          case AgentToolStarted(:final String toolCallId, :final String toolName):
            tools = <AgentToolCall>[
              ...tools,
              AgentToolCall(
                id: toolCallId,
                name: toolName,
                label: ToolLabels.forTool(toolName),
                state: ToolRunState.running,
                detail: null,
                startedAt: DateTime.now(),
                finishedAt: null,
              ),
            ];
            streaming[index] = streaming[index].copyWith(tools: tools);
            setState(() {});
            _scrollToEnd();
          case AgentToolFinished(
            :final String toolCallId,
            artifacts: final List<AgentArtifact> incoming,
            :final bool failed,
            :final String? detail,
          ):
            tools = tools
                .map(
                  (AgentToolCall t) => t.id == toolCallId
                      ? t.copyWith(
                          state: failed
                              ? ToolRunState.failed
                              : ToolRunState.done,
                          detail: detail ?? t.detail,
                          finishedAt: DateTime.now(),
                        )
                      : t,
                )
                .toList();
            if (incoming.isNotEmpty) {
              final Set<String> seen = <String>{};
              final List<AgentArtifact> merged = <AgentArtifact>[
                ..._turnArtifacts,
                ...incoming,
              ].where((AgentArtifact a) {
                return seen.add('${a.kind}:${a.url}:${a.actionId}:${a.title}');
              }).toList(growable: false);
              _turnArtifacts = merged;
              artifacts = merged;
            }
            streaming[index] = streaming[index].copyWith(
              tools: tools,
              artifacts: artifacts,
            );
            setState(() {});
            _scrollToEnd();
          case AgentTurnComplete():
            streaming[index] = streaming[index].copyWith(isStreaming: false);
            session = session.copyWith(
              messages: List<AgentMessage>.of(streaming),
              state: _derivedState(streaming),
              updatedAt: DateTime.now(),
            );
            await _persist(session);
            setState(() {});
          case AgentTurnFailed(:final NoboFailure failure):
            streaming[index] = streaming[index].copyWith(
              isStreaming: false,
              error: failure.message,
            );
            session = session.copyWith(
              messages: List<AgentMessage>.of(streaming),
              state: failure.kind == NoboFailureKind.forbidden
                  ? SessionState.idle
                  : SessionState.failed,
              updatedAt: DateTime.now(),
            );
            await _persist(session);
            setState(() => _failure = failure);

          case AgentStreamErrored(:final String message):
            // AgentRepository normally converts this into AgentTurnFailed; the
            // branch exists so the sealed switch stays exhaustive.
            streaming[index] = streaming[index].copyWith(
              isStreaming: false,
              error: message,
            );
            session = session.copyWith(
              messages: List<AgentMessage>.of(streaming),
              state: SessionState.failed,
              updatedAt: DateTime.now(),
            );
            await _persist(session);
            setState(
              () => _failure = NoboFailure(NoboFailureKind.server, message),
            );
        }
      }
    } catch (e) {
      final NoboFailure f = mapError(e);
      streaming[index] = streaming[index].copyWith(
        isStreaming: false,
        error: f.message,
      );
      session = session.copyWith(
        messages: List<AgentMessage>.of(streaming),
        state: SessionState.failed,
        updatedAt: DateTime.now(),
      );
      await _persist(session);
      setState(() => _failure = f);
    } finally {
      // Never leave a message spinning.
      if (streaming[index].isStreaming) {
        streaming[index] = streaming[index].copyWith(isStreaming: false);
        session = session.copyWith(
          messages: List<AgentMessage>.of(streaming),
          state: _derivedState(streaming),
          updatedAt: DateTime.now(),
        );
        await _persist(session);
      }
      if (mounted) setState(() => _busy = false);
      _scrollToEnd();
    }
  }

  SessionState _derivedState(List<AgentMessage> messages) {
    final bool anyPending = messages
        .expand((AgentMessage m) => m.artifacts)
        .any((AgentArtifact a) => a.isPendingApproval || a.kind == ArtifactKind.userInputPrompt);
    if (anyPending) return SessionState.needsYou;
    return SessionState.done;
  }

  String _titleFrom(String text) {
    final String clean = text.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (clean.length <= 42) return clean;
    final String cut = clean.substring(0, 42);
    final int space = cut.lastIndexOf(' ');
    return '${space > 18 ? cut.substring(0, space) : cut}…';
  }

  Future<void> _decide(AgentArtifact artifact, bool approve) async {
    final String? actionId = artifact.actionId;
    if (actionId == null || _session == null) return;
    setState(() => _pendingActionId = actionId);
    try {
      await ref
          .read(agentRepositoryProvider)
          .decide(actionId: actionId, approve: approve);
      final List<AgentMessage> messages = _session!.messages.map((
        AgentMessage m,
      ) {
        return m.copyWith(
          artifacts: m.artifacts
              .map(
                (AgentArtifact a) => a.actionId == actionId
                    ? AgentArtifact(
                        kind: a.kind,
                        title: a.title,
                        url: a.url,
                        actionId: a.actionId,
                        status: approve ? 'approved' : 'rejected',
                        description: a.description,
                        estimatedCost: a.estimatedCost,
                        actionType: a.actionType,
                        question: a.question,
                        options: a.options,
                        bodyText: a.bodyText,
                        durationSeconds: a.durationSeconds,
                      )
                    : a,
              )
              .toList(growable: false),
        );
      }).toList(growable: false);

      await _persist(
        _session!.copyWith(messages: messages, updatedAt: DateTime.now()),
      );
      if (!mounted) return;
      if (NoboPlatform.isAndroid) unawaited(HapticFeedback.mediumImpact());
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            approve
                ? 'Approved. Nobogent recorded your decision.'
                : 'Declined. Nothing was sent.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on NoboFailure catch (e) {
      if (!mounted) return;
      setState(() => _failure = e);
    } finally {
      if (mounted) setState(() => _pendingActionId = null);
    }
  }

  Future<void> _rename() async {
    final AgentSession? s = _session;
    if (s == null) return;
    final TextEditingController ctl = TextEditingController(text: s.title);
    await showNoboSheet<void>(
      context: context,
      builder: (BuildContext ctx) => Padding(
        padding: EdgeInsets.only(
          left: NoboSpace.gutter,
          right: NoboSpace.gutter,
          bottom: MediaQuery.viewInsetsOf(ctx).bottom + NoboSpace.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            NoboSheetHeader(
              title: 'Rename task',
              onClose: () => Navigator.of(ctx).pop(),
            ),
            NoboTextField(controller: ctl, hint: 'Task name', autofocus: true),
            const SizedBox(height: NoboSpace.base),
            NoboButton(
              label: 'Save',
              expand: true,
              onPressed: () async {
                final String name = ctl.text.trim();
                if (name.isNotEmpty) {
                  await _persist(
                    _session!.copyWith(
                      title: name,
                      updatedAt: DateTime.now(),
                    ),
                  );
                }
                if (ctx.mounted) Navigator.of(ctx).pop();
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _delete() async {
    final bool ok = await showNoboConfirm(
      context: context,
      title: 'Delete this task?',
      message:
          'The conversation and its outputs shelf will be removed from this '
          'device. Generated media stays in your library.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (!ok || !mounted) return;
    await ref.read(sessionsProvider.notifier).delete(widget.sessionId);
    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final AgentSession? session = _session;

    if (!_loaded) {
      return Scaffold(
        backgroundColor: context.nobo.canvas,
        appBar: AppBar(),
        body: const NoboLoading(label: 'Opening task'),
      );
    }

    if (session == null) {
      return Scaffold(
        backgroundColor: context.nobo.canvas,
        appBar: AppBar(),
        body: NoboEmptyState(
          title: 'Task not found',
          message:
              'This task is no longer on this device. Sessions are stored '
              'locally, so they do not follow you between phones.',
          icon: Icons.search_off_rounded,
          actionLabel: 'Back to tasks',
          onAction: () => context.go(Routes.create),
        ),
      );
    }

    final NoboColors c = context.nobo;
    final List<AgentArtifact> shelf = session.allArtifacts;

    return Scaffold(
      backgroundColor: c.canvas,
      appBar: _SessionAppBar(
        title: session.title,
        subtitle: session.projectTitle,
        onRename: _rename,
        onDelete: _delete,
      ),
      body: Column(
        children: <Widget>[
          if (_failure != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NoboSpace.gutter,
                NoboSpace.sm,
                NoboSpace.gutter,
                0,
              ),
              child: _FailureBanner(
                failure: _failure!,
                onDismiss: () => setState(() => _failure = null),
              ),
            ),
          Expanded(
            child: session.messages.isEmpty
                ? _SessionEmpty(
                    onSuggestion: _send,
                    enabled: !_busy,
                  )
                : ListView.separated(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(
                      NoboSpace.gutter,
                      NoboSpace.base,
                      NoboSpace.gutter,
                      NoboSpace.lg,
                    ),
                    itemCount: session.messages.length,
                    separatorBuilder: (_, _) =>
                        const SizedBox(height: NoboSpace.lg),
                    itemBuilder: (BuildContext context, int i) {
                      final AgentMessage m = session.messages[i];
                      return m.isUser
                          ? _UserTurn(message: m)
                          : _AgentTurn(
                              message: m,
                              onApprove: (AgentArtifact a) =>
                                  _decide(a, true),
                              onReject: (AgentArtifact a) =>
                                  _decide(a, false),
                              onAnswer: (AgentArtifact a, String choice) =>
                                  _send(choice),
                              onOpenMedia: (AgentArtifact a) => context.push(
                                '${Routes.media}?src='
                                '${Uri.encodeComponent(a.url ?? '')}'
                                '&video=${a.kind == ArtifactKind.videoPlayer ? 1 : 0}',
                              ),
                              busyActionId: _pendingActionId,
                            );
                    },
                  ),
          ),
          if (shelf.isNotEmpty && session.messages.length > 1)
            _OutputShelf(
              artifacts: shelf,
              onOpen: (AgentArtifact a) => context.push(
                '${Routes.media}?src=${Uri.encodeComponent(a.url ?? '')}'
                '&video=${a.kind == ArtifactKind.videoPlayer ? 1 : 0}',
              ),
            ),
          _Composer(
            controller: _input,
            focusNode: _focus,
            busy: _busy,
            onSend: () => _send(_input.text),
          ),
        ],
      ),
    );
  }
}

class _SessionAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _SessionAppBar({
    required this.title,
    required this.subtitle,
    required this.onRename,
    required this.onDelete,
  });

  final String title;
  final String? subtitle;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Size get preferredSize => const Size.fromHeight(58);

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return AppBar(
      toolbarHeight: 58,
      backgroundColor: c.canvas,
      surfaceTintColor: Colors.transparent,
      leading: IconButton(
        icon: Icon(
          NoboPlatform.isIOS
              ? Icons.arrow_back_ios_new_rounded
              : Icons.arrow_back_rounded,
          size: 20,
        ),
        onPressed: () => context.pop(),
        tooltip: 'Back',
      ),
      titleSpacing: 0,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Text(
            title,
            style: NoboType.bodyStrong.copyWith(color: c.ink, fontSize: 15.5),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (subtitle != null)
            Text(
              subtitle!,
              style: NoboType.caption.copyWith(
                color: c.inkTertiary,
                fontSize: 11.5,
              ),
              maxLines: 1,
            ),
        ],
      ),
      actions: <Widget>[
        PopupMenuButton<String>(
          icon: Icon(Icons.more_horiz_rounded, color: c.inkSecondary),
          color: c.surfaceRaised,
          shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rSm),
          onSelected: (String v) {
            if (v == 'rename') onRename();
            if (v == 'delete') onDelete();
          },
          itemBuilder: (_) => <PopupMenuEntry<String>>[
            PopupMenuItem<String>(
              value: 'rename',
              child: Text('Rename', style: NoboType.body.copyWith(color: c.ink)),
            ),
            PopupMenuItem<String>(
              value: 'delete',
              child: Text(
                'Delete task',
                style: NoboType.body.copyWith(color: c.danger),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _UserTurn extends StatelessWidget {
  const _UserTurn({required this.message});

  final AgentMessage message;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: <Widget>[
        Flexible(
          child: Container(
            constraints: const BoxConstraints(maxWidth: 330),
            padding: const EdgeInsets.symmetric(
              horizontal: NoboSpace.base,
              vertical: NoboSpace.md,
            ),
            decoration: BoxDecoration(
              color: c.primary,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(NoboRadius.lg),
                topRight: Radius.circular(NoboRadius.lg),
                bottomLeft: Radius.circular(NoboRadius.lg),
                bottomRight: Radius.circular(5),
              ),
            ),
            child: Text(
              message.text,
              style: NoboType.body.copyWith(
                color: c.onPrimary,
                height: 1.45,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _AgentTurn extends StatelessWidget {
  const _AgentTurn({
    required this.message,
    required this.onApprove,
    required this.onReject,
    required this.onAnswer,
    required this.onOpenMedia,
    required this.busyActionId,
  });

  final AgentMessage message;
  final ValueChanged<AgentArtifact> onApprove;
  final ValueChanged<AgentArtifact> onReject;
  final void Function(AgentArtifact artifact, String choice) onAnswer;
  final ValueChanged<AgentArtifact> onOpenMedia;
  final String? busyActionId;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            OrbitMark(
              size: 17,
              active: message.isStreaming,
              color: c.primary,
            ),
            const SizedBox(width: 7),
            Text(
              'NOBOGENT',
              style: NoboType.micro.copyWith(color: c.inkTertiary),
            ),
          ],
        ),
        const SizedBox(height: NoboSpace.sm),

        if (message.reasoning.trim().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: NoboSpace.md),
            child: _ReasoningBlock(text: message.reasoning),
          ),

        if (message.tools.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: NoboSpace.md),
            child: AgentToolTimeline(tools: message.tools),
          ),

        if (message.hasBody)
          Text(
            message.text,
            style: NoboType.body.copyWith(
              color: c.ink,
              height: 1.55,
              fontSize: 15.5,
            ),
          ),

        if (message.isThinking)
          Row(
            children: <Widget>[
              const OrbitMark(size: 16, active: true),
              const SizedBox(width: 8),
              Text(
                'Thinking…',
                style: NoboType.caption.copyWith(color: c.inkTertiary),
              ),
            ],
          ),

        if (message.artifacts.isNotEmpty) ...<Widget>[
          const SizedBox(height: NoboSpace.md),
          for (final AgentArtifact a in message.artifacts)
            Padding(
              padding: const EdgeInsets.only(bottom: NoboSpace.sm),
              child: AgentArtifactView(
                artifact: a,
                busy: busyActionId != null && busyActionId == a.actionId,
                onApprove: () => onApprove(a),
                onReject: () => onReject(a),
                onAnswer: (String v) => onAnswer(a, v),
                onOpenMedia: onOpenMedia,
              ),
            ),
        ],

        if (message.error != null)
          Padding(
            padding: const EdgeInsets.only(top: NoboSpace.sm),
            child: NoboInlineError(message: message.error!),
          ),
      ],
    );
  }
}

class _ReasoningBlock extends StatefulWidget {
  const _ReasoningBlock({required this.text});

  final String text;

  @override
  State<_ReasoningBlock> createState() => _ReasoningBlockState();
}

class _ReasoningBlockState extends State<_ReasoningBlock> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return GestureDetector(
      onTap: () => setState(() => _open = !_open),
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(NoboSpace.md),
        decoration: BoxDecoration(
          color: c.surfaceSunken,
          borderRadius: NoboRadius.rSm,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  _open
                      ? Icons.expand_less_rounded
                      : Icons.expand_more_rounded,
                  size: 15,
                  color: c.inkTertiary,
                ),
                const SizedBox(width: 4),
                Text(
                  _open ? 'Hide reasoning' : 'Show reasoning',
                  style: NoboType.caption.copyWith(
                    color: c.inkTertiary,
                    fontSize: 11.5,
                  ),
                ),
              ],
            ),
            if (_open) ...<Widget>[
              const SizedBox(height: NoboSpace.sm),
              Text(
                widget.text,
                style: NoboType.caption.copyWith(
                  color: c.inkSecondary,
                  height: 1.5,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _FailureBanner extends StatelessWidget {
  const _FailureBanner({required this.failure, required this.onDismiss});

  final NoboFailure failure;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool forbidden = failure.kind == NoboFailureKind.forbidden;
    return Container(
      padding: const EdgeInsets.all(NoboSpace.md),
      decoration: BoxDecoration(
        color: forbidden ? c.cautionWash : c.dangerWash,
        borderRadius: NoboRadius.rSm,
        border: Border.all(
          color: (forbidden ? c.caution : c.danger).withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            forbidden ? Icons.lock_outline_rounded : Icons.error_outline_rounded,
            size: 16,
            color: forbidden ? c.caution : c.danger,
          ),
          const SizedBox(width: NoboSpace.sm),
          Expanded(
            child: Text(
              forbidden
                  ? 'Nobogent AI is limited to workspace owners right now, so '
                      'this account cannot run it yet. Nothing was charged.'
                  : failure.message,
              style: NoboType.caption.copyWith(color: c.inkSecondary),
            ),
          ),
          GestureDetector(
            onTap: onDismiss,
            child: Icon(
              Icons.close_rounded,
              size: 15,
              color: c.inkTertiary,
            ),
          ),
        ],
      ),
    );
  }
}

class _SessionEmpty extends StatelessWidget {
  const _SessionEmpty({required this.onSuggestion, required this.enabled});

  final ValueChanged<String> onSuggestion;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    const List<String> suggestions = <String>[
      'Create a 15 second video for this project',
      'Generate five Instagram creatives',
      'Write WhatsApp follow-ups for cold leads',
      'Summarise this week across my projects',
    ];

    return SingleChildScrollView(
      padding: const EdgeInsets.all(NoboSpace.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const SizedBox(height: NoboSpace.xxl),
          const Center(child: OrbitMark(size: 62, active: true)),
          const SizedBox(height: NoboSpace.lg),
          Center(
            child: Text(
              'What should I do?',
              style: NoboType.title.copyWith(color: c.ink, fontSize: 23),
            ),
          ),
          const SizedBox(height: NoboSpace.sm),
          Center(
            child: Text(
              'Describe the outcome you want. I will plan it, do the work, '
              'and bring you anything that needs a decision.',
              textAlign: TextAlign.center,
              style: NoboType.body.copyWith(color: c.inkSecondary),
            ),
          ),
          const SizedBox(height: NoboSpace.xl),
          for (final String s in suggestions)
            Padding(
              padding: const EdgeInsets.only(bottom: NoboSpace.sm),
              child: NoboCard(
                onTap: enabled ? () => onSuggestion(s) : null,
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.base,
                  vertical: NoboSpace.md,
                ),
                child: Row(
                  children: <Widget>[
                    Icon(
                      Icons.arrow_outward_rounded,
                      size: 15,
                      color: c.inkTertiary,
                    ),
                    const SizedBox(width: NoboSpace.sm),
                    Expanded(
                      child: Text(
                        s,
                        style: NoboType.body.copyWith(color: c.inkSecondary),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.busy,
    required this.onSend,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool busy;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(top: BorderSide(color: c.border)),
      ),
      padding: EdgeInsets.fromLTRB(
        NoboSpace.gutter,
        NoboSpace.md,
        NoboSpace.gutter,
        NoboSpace.md + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        top: false,
        bottom: MediaQuery.viewInsetsOf(context).bottom == 0,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: <Widget>[
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: c.surfaceSunken,
                  borderRadius: BorderRadius.circular(NoboRadius.lg),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.base,
                  vertical: 4,
                ),
                child: TextField(
                  controller: controller,
                  focusNode: focusNode,
                  minLines: 1,
                  maxLines: 5,
                  textCapitalization: TextCapitalization.sentences,
                  style: NoboType.body.copyWith(color: c.ink),
                  cursorColor: c.primary,
                  decoration: InputDecoration(
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    hintText: 'Tell Nobogent what you need…',
                    hintStyle: NoboType.body.copyWith(color: c.inkTertiary),
                  ),
                ),
              ),
            ),
            const SizedBox(width: NoboSpace.sm),
            SizedBox(
              width: 42,
              height: 42,
              child: Material(
                color: busy ? c.surfaceSunken : c.primary,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: busy ? null : onSend,
                  child: Center(
                    child: busy
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation<Color>(
                                c.primary,
                              ),
                            ),
                          )
                        : Icon(
                            Icons.arrow_upward_rounded,
                            size: 20,
                            color: c.onPrimary,
                          ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Horizontal shelf of everything this task produced — the session's outputs
/// stay attached to the task rather than disappearing into a global library.
class _OutputShelf extends StatelessWidget {
  const _OutputShelf({required this.artifacts, required this.onOpen});

  final List<AgentArtifact> artifacts;
  final ValueChanged<AgentArtifact> onOpen;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(top: BorderSide(color: c.border)),
      ),
      padding: const EdgeInsets.symmetric(vertical: NoboSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: Text(
              'OUTPUT FROM THIS TASK',
              style: NoboType.micro.copyWith(color: c.inkTertiary),
            ),
          ),
          const SizedBox(height: NoboSpace.sm),
          SizedBox(
            height: 66,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              itemCount: artifacts.length,
              separatorBuilder: (_, _) => const SizedBox(width: NoboSpace.sm),
              itemBuilder: (BuildContext context, int i) {
                final AgentArtifact a = artifacts[i];
                return GestureDetector(
                  onTap: () => onOpen(a),
                  child: ClipRRect(
                    borderRadius: NoboRadius.rSm,
                    child: SizedBox(
                      width: 58,
                      height: 58,
                      child: Image.asset(
                        a.url ?? '',
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => ColoredBox(
                          color: c.surfaceSunken,
                          child: Icon(
                            Icons.image_outlined,
                            size: 16,
                            color: c.inkTertiary,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
