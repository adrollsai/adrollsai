import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/controls.dart';
import '../../core/ui/feedback.dart';
import '../../core/ui/refresh.dart';
import '../../core/ui/surfaces.dart';
import '../../core/utils/format.dart';
import '../../data/models/agent.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/workspace_source.dart';

/// Inbox — an approval and attention queue, not an email clone.
///
/// Merges three sources into one clearing surface: agent approvals, agent
/// questions, and workspace notifications. Everything here is actionable;
/// notifications that are not are folded into a quiet "updates" group.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  String? _busyActionId;

  Future<void> _decide(
    AgentSession session,
    AgentArtifact artifact,
    bool approve,
  ) async {
    final String? actionId = artifact.actionId;
    if (actionId == null) return;
    setState(() => _busyActionId = actionId);
    try {
      await ref
          .read(agentRepositoryProvider)
          .decide(actionId: actionId, approve: approve);

      final List<AgentMessage> messages = session.messages.map((
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

      await ref.read(sessionsProvider.notifier).save(
        session.copyWith(
          messages: messages,
          state: SessionState.done,
          updatedAt: DateTime.now(),
        ),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            approve ? 'Approved.' : 'Declined. Nothing was sent.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on NoboFailure catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (mounted) setState(() => _busyActionId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<NoticeSeed>> notices = ref.watch(noticesProvider);
    final List<AgentSession> sessions =
        ref.watch(sessionsProvider).value ?? const <AgentSession>[];

    // Approvals and questions come from sessions; they outrank notifications.
    final List<({AgentSession session, AgentArtifact artifact})> decisions =
        <({AgentSession session, AgentArtifact artifact})>[];
    for (final AgentSession s in sessions) {
      for (final AgentMessage m in s.messages) {
        for (final AgentArtifact a in m.artifacts) {
          if (a.isPendingApproval ||
              a.kind == ArtifactKind.userInputPrompt) {
            decisions.add((session: s, artifact: a));
          }
        }
      }
    }

    final List<NoticeSeed> updates = (notices.value ?? const <NoticeSeed>[])
        .where(
          (NoticeSeed n) =>
              n.kind != NoticeKind.approval && n.kind != NoticeKind.question,
        )
        .toList(growable: false);

    return Scaffold(
      backgroundColor: c.canvas,
      body: SafeArea(
        bottom: false,
        child: NoboRefreshScroll(
          onRefresh: () async {
            ref.invalidate(noticesProvider);
            ref.invalidate(sessionsProvider);
            await ref
                .read(noticesProvider.future)
                .catchError((Object _) => const <NoticeSeed>[]);
          },
          slivers: <Widget>[
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.md,
                  NoboSpace.gutter,
                  0,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            'Inbox',
                            style: NoboType.title.copyWith(color: c.ink),
                          ),
                          Text(
                            decisions.isEmpty
                                ? 'Nothing needs you right now'
                                : '${decisions.length} waiting on you',
                            style: NoboType.caption.copyWith(
                              color: decisions.isEmpty
                                  ? c.inkTertiary
                                  : c.accent,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (updates.isNotEmpty)
                      TextButton(
                        onPressed: () async {
                          await ref
                              .read(workspaceRepositoryProvider)
                              .markAllNotificationsRead();
                          ref.invalidate(noticesProvider);
                        },
                        child: Text(
                          'Mark read',
                          style: NoboType.caption.copyWith(color: c.primary),
                        ),
                      ),
                  ],
                ),
              ),
            ),

            if (decisions.isNotEmpty) ...<Widget>[
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(
                    horizontal: NoboSpace.gutter,
                  ),
                  child: NoboSectionHeader(
                    eyebrow: 'Decide',
                    title: 'Waiting on you',
                    padding: EdgeInsets.only(
                      top: NoboSpace.lg,
                      bottom: NoboSpace.md,
                    ),
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                sliver: SliverList.separated(
                  itemCount: decisions.length,
                  separatorBuilder: (_, _) =>
                      const SizedBox(height: NoboSpace.sm),
                  itemBuilder: (BuildContext context, int i) {
                    final ({AgentSession session, AgentArtifact artifact}) d =
                        decisions[i];
                    final bool isApproval =
                        d.artifact.kind == ArtifactKind.actionConfirmation;
                    return _DecisionCard(
                      title: d.artifact.title ?? 'Decision needed',
                      body: d.artifact.description ??
                          d.artifact.question ??
                          '',
                      sessionTitle: d.session.title,
                      cost: d.artifact.estimatedCost,
                      isApproval: isApproval,
                      options: d.artifact.options,
                      busy: _busyActionId == d.artifact.actionId,
                      onOpen: () => context.push(Routes.session(d.session.id)),
                      // Answering a question is simply the next message in that
                      // task, so open the session with the reply pre-filled —
                      // the conversation keeps its own context.
                      onAnswer: (String choice) => context.push(
                        '${Routes.session(d.session.id)}'
                        '?prompt=${Uri.encodeComponent(choice)}',
                      ),
                      onApprove: isApproval
                          ? () => _decide(d.session, d.artifact, true)
                          : null,
                      onDecline: isApproval
                          ? () => _decide(d.session, d.artifact, false)
                          : null,
                    );
                  },
                ),
              ),
            ],

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                child: NoboSectionHeader(
                  eyebrow: 'Activity',
                  title: 'Updates',
                  padding: EdgeInsets.only(
                    top: decisions.isEmpty ? NoboSpace.lg : NoboSpace.xl,
                    bottom: NoboSpace.md,
                  ),
                ),
              ),
            ),

            if (notices.isLoading)
              const SliverToBoxAdapter(
                child: SizedBox(height: 120, child: NoboLoading()),
              )
            else if (updates.isEmpty)
              const SliverToBoxAdapter(
                child: NoboEmptyState(
                  title: 'All clear',
                  message:
                      'When Nobogent finishes a task, needs a decision, or a '
                      'lead comes in, it will show up here.',
                  icon: Icons.check_circle_outline_rounded,
                  compact: true,
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                sliver: SliverList.separated(
                  itemCount: updates.length,
                  separatorBuilder: (_, _) =>
                      const SizedBox(height: NoboSpace.sm),
                  itemBuilder: (BuildContext context, int i) => _UpdateRow(
                    notice: updates[i],
                    onTap: () async {
                      await ref
                          .read(workspaceRepositoryProvider)
                          .safeMarkRead(updates[i].id);
                      ref.invalidate(noticesProvider);
                    },
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _DecisionCard extends StatelessWidget {
  const _DecisionCard({
    required this.title,
    required this.body,
    required this.sessionTitle,
    required this.cost,
    required this.isApproval,
    required this.options,
    required this.busy,
    required this.onOpen,
    required this.onAnswer,
    this.onApprove,
    this.onDecline,
  });

  final String title;
  final String body;
  final String sessionTitle;
  final String? cost;
  final bool isApproval;
  final List<String> options;
  final bool busy;
  final VoidCallback onOpen;
  final ValueChanged<String> onAnswer;
  final VoidCallback? onApprove;
  final VoidCallback? onDecline;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return NoboCard(
      onTap: onOpen,
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          // Wrap rather than Row: both pills grow with Dynamic Type, and two
          // intrinsic-width pills in a Row overflow on a compact phone.
          Wrap(
            spacing: NoboSpace.sm,
            runSpacing: 6,
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              NoboPill(
                label: isApproval ? 'Approval' : 'Question',
                tone: isApproval ? NoboPillTone.danger : NoboPillTone.brand,
                icon: isApproval
                    ? Icons.shield_outlined
                    : Icons.help_outline_rounded,
                dense: true,
              ),
              if (cost != null)
                NoboPill(
                  label: cost!,
                  tone: NoboPillTone.credit,
                  icon: Icons.bolt_rounded,
                  dense: true,
                ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Text(
            title,
            style: NoboType.bodyStrong.copyWith(color: c.ink),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (body.isNotEmpty) ...<Widget>[
            const SizedBox(height: 4),
            Text(
              body,
              style: NoboType.caption.copyWith(color: c.inkSecondary),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              Icon(Icons.auto_awesome, size: 11, color: c.inkTertiary),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  sessionTitle,
                  style: NoboType.caption.copyWith(
                    color: c.inkTertiary,
                    fontSize: 11,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          // A question is only actionable if its suggested answers are visible.
          if (!isApproval && options.isNotEmpty) ...<Widget>[
            const SizedBox(height: NoboSpace.md),
            Wrap(
              spacing: NoboSpace.sm,
              runSpacing: NoboSpace.sm,
              children: <Widget>[
                for (final String option in options)
                  GestureDetector(
                    onTap: busy ? null : () => onAnswer(option),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: NoboSpace.md,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: c.primaryWash,
                        borderRadius: NoboRadius.rPill,
                        border: Border.all(
                          color: c.primary.withValues(alpha: 0.28),
                        ),
                      ),
                      child: Text(
                        option,
                        style: NoboType.label.copyWith(color: c.primary),
                      ),
                    ),
                  ),
              ],
            ),
          ],
          if (onApprove != null) ...<Widget>[
            const SizedBox(height: NoboSpace.md),
            Row(
              children: <Widget>[
                Expanded(
                  child: NoboButton(
                    label: 'Approve',
                    size: NoboButtonSize.small,
                    loading: busy,
                    onPressed: busy ? null : onApprove,
                    expand: true,
                    icon: Icons.check_rounded,
                  ),
                ),
                const SizedBox(width: NoboSpace.sm),
                Expanded(
                  child: NoboButton(
                    label: 'Decline',
                    size: NoboButtonSize.small,
                    variant: NoboButtonVariant.outline,
                    onPressed: busy ? null : onDecline,
                    expand: true,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _UpdateRow extends StatelessWidget {
  const _UpdateRow({required this.notice, required this.onTap});

  final NoticeSeed notice;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final (IconData icon, Color tone) = switch (notice.kind) {
      NoticeKind.approval => (Icons.shield_outlined, c.danger),
      NoticeKind.question => (Icons.help_outline_rounded, c.primary),
      NoticeKind.done => (Icons.check_circle_outline_rounded, c.positive),
      NoticeKind.failed => (Icons.error_outline_rounded, c.caution),
      NoticeKind.lead => (Icons.person_add_alt_1_outlined, c.positive),
      NoticeKind.system => (Icons.info_outline_rounded, c.inkSecondary),
    };

    return NoboCard(
      onTap: onTap,
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(NoboRadius.xs),
            ),
            child: Icon(icon, size: 15, color: tone),
          ),
          const SizedBox(width: NoboSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        notice.title,
                        style: NoboType.body.copyWith(
                          color: c.ink,
                          fontWeight: notice.read
                              ? FontWeight.w400
                              : FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!notice.read)
                      Container(
                        width: 6,
                        height: 6,
                        margin: const EdgeInsets.only(left: 6),
                        decoration: BoxDecoration(
                          color: c.accent,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                if (notice.body != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(
                    notice.body!,
                    style: NoboType.caption.copyWith(color: c.inkSecondary),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: 4),
                Text(
                  timeAgo(notice.createdAt),
                  style: NoboType.caption.copyWith(
                    color: c.inkTertiary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}