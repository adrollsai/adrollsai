import 'package:flutter/material.dart';

import '../../data/models/agent.dart';
import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import '../utils/format.dart';
import 'controls.dart';
import 'media.dart';
import 'nobo_mark_loader.dart';
import 'orbit_mark.dart';

/// Session state as a readable pill.
class AgentStatusPill extends StatelessWidget {
  const AgentStatusPill({required this.state, super.key});

  final SessionState state;

  @override
  Widget build(BuildContext context) {
    return switch (state) {
      SessionState.working => const _LivePill(label: 'Working'),
      SessionState.needsYou => const NoboPill(
        label: 'Needs you',
        tone: NoboPillTone.danger,
      ),
      SessionState.done => const NoboPill(
        label: 'Done',
        tone: NoboPillTone.positive,
      ),
      SessionState.failed => const NoboPill(
        label: 'Failed',
        tone: NoboPillTone.caution,
      ),
      SessionState.idle => const NoboPill(label: 'Idle'),
    };
  }
}

class _LivePill extends StatelessWidget {
  const _LivePill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      padding: const EdgeInsets.only(left: 3, right: 9, top: 3, bottom: 3),
      decoration: BoxDecoration(
        color: c.primaryWash,
        borderRadius: NoboRadius.rPill,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          OrbitMark(size: 15, active: true, color: c.primary),
          const SizedBox(width: 5),
          Text(
            label,
            style: NoboType.micro.copyWith(color: c.primary, fontSize: 10.5),
          ),
        ],
      ),
    );
  }
}

/// Agent execution, rendered as a timeline rather than a wall of logs.
///
/// Tool names are translated to plain language ([ToolLabels]) — an owner should
/// never see `sandbox_publish_artifact`. Running steps animate; finished steps
/// collapse into a single quiet line.
class AgentToolTimeline extends StatelessWidget {
  const AgentToolTimeline({required this.tools, this.dense = false, super.key});

  final List<AgentToolCall> tools;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    if (tools.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        for (int i = 0; i < tools.length; i++)
          _Step(
            tool: tools[i],
            isLast: i == tools.length - 1,
            dense: dense,
            lineColor: c.hairline,
          ),
      ],
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.tool,
    required this.isLast,
    required this.dense,
    required this.lineColor,
  });

  final AgentToolCall tool;
  final bool isLast;
  final bool dense;
  final Color lineColor;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    final (Color dot, Widget indicator) = switch (tool.state) {
      ToolRunState.running => (
        c.primary,
        NoboMarkLoader(size: 12, color: c.primary, semanticLabel: 'Running'),
      ),
      ToolRunState.done => (
        c.positive,
        Icon(Icons.check_rounded, size: 12, color: c.positive),
      ),
      ToolRunState.failed => (
        c.danger,
        Icon(Icons.priority_high_rounded, size: 12, color: c.danger),
      ),
    };

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 18,
            child: Column(
              children: <Widget>[
                const SizedBox(height: 3),
                Container(
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(
                    color: dot.withValues(alpha: 0.14),
                    shape: BoxShape.circle,
                  ),
                  child: Center(child: indicator),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 1.4, color: lineColor),
                  ),
              ],
            ),
          ),
          const SizedBox(width: NoboSpace.sm),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : (dense ? 9 : 12)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    tool.label,
                    style: NoboType.label.copyWith(
                      fontSize: 12.5,
                      color: tool.state == ToolRunState.running
                          ? c.ink
                          : c.inkSecondary,
                    ),
                  ),
                  if (tool.detail != null)
                    Text(
                      tool.detail!,
                      style: NoboType.caption.copyWith(
                        color: c.inkTertiary,
                        fontSize: 11.5,
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (tool.elapsed != null && tool.elapsed!.inSeconds >= 1)
            Padding(
              padding: const EdgeInsets.only(left: 6, top: 2),
              child: Text(
                shortDuration(tool.elapsed),
                style: NoboType.caption.copyWith(
                  color: c.inkTertiary,
                  fontSize: 11,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A pending approval — the one place in the app where an irreversible,
/// money-spending action can be authorised.
class ApprovalCard extends StatelessWidget {
  const ApprovalCard({
    required this.artifact,
    this.onApprove,
    this.onReject,
    this.busy = false,
    super.key,
  });

  final AgentArtifact artifact;
  final VoidCallback? onApprove;
  final VoidCallback? onReject;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(NoboRadius.lg),
        border: Border.all(color: c.accent.withValues(alpha: 0.32)),
      ),
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const NoboPill(
                label: 'Approval needed',
                tone: NoboPillTone.danger,
                icon: Icons.shield_outlined,
                dense: true,
              ),
              const Spacer(),
              if (artifact.estimatedCost != null)
                NoboPill(
                  label: artifact.estimatedCost!,
                  tone: NoboPillTone.credit,
                  icon: Icons.bolt_rounded,
                  dense: true,
                ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Text(
            artifact.title ?? 'Confirm this action',
            style: NoboType.subtitle.copyWith(color: c.ink),
          ),
          if (artifact.description != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              artifact.description!,
              style: NoboType.body.copyWith(color: c.inkSecondary),
            ),
          ],
          const SizedBox(height: NoboSpace.base),
          Row(
            children: <Widget>[
              Expanded(
                child: NoboButton(
                  label: 'Approve',
                  onPressed: busy ? null : onApprove,
                  loading: busy,
                  size: NoboButtonSize.small,
                  icon: Icons.check_rounded,
                  expand: true,
                ),
              ),
              const SizedBox(width: NoboSpace.sm),
              Expanded(
                child: NoboButton(
                  label: 'Decline',
                  onPressed: busy ? null : onReject,
                  variant: NoboButtonVariant.outline,
                  size: NoboButtonSize.small,
                  expand: true,
                ),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          Text(
            'Nobogent will not send anything until you approve.',
            style: NoboType.caption.copyWith(color: c.inkTertiary),
          ),
        ],
      ),
    );
  }
}

/// A question the agent needs answered to continue.
class QuestionCard extends StatelessWidget {
  const QuestionCard({required this.artifact, this.onAnswer, super.key});

  final AgentArtifact artifact;
  final ValueChanged<String>? onAnswer;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      decoration: BoxDecoration(
        color: c.primaryWash.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(NoboRadius.lg),
        border: Border.all(color: c.primary.withValues(alpha: 0.22)),
      ),
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            artifact.title ?? 'Nobogent has a question',
            style: NoboType.micro.copyWith(color: c.primary),
          ),
          const SizedBox(height: NoboSpace.sm),
          Text(
            artifact.question ?? artifact.bodyText ?? '',
            style: NoboType.body.copyWith(color: c.ink),
          ),
          if (artifact.options.isNotEmpty) ...<Widget>[
            const SizedBox(height: NoboSpace.md),
            Wrap(
              spacing: NoboSpace.sm,
              runSpacing: NoboSpace.sm,
              children: <Widget>[
                for (final String option in artifact.options)
                  GestureDetector(
                    onTap: onAnswer == null ? null : () => onAnswer!(option),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: NoboSpace.md,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: c.surface,
                        borderRadius: NoboRadius.rPill,
                        border: Border.all(color: c.primary.withValues(alpha: 0.3)),
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
        ],
      ),
    );
  }
}

/// WhatsApp message preview, so an owner sees exactly what will be delivered.
class WhatsappPreviewCard extends StatelessWidget {
  const WhatsappPreviewCard({required this.artifact, super.key});

  final AgentArtifact artifact;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(NoboRadius.md),
        border: Border.all(color: c.border),
      ),
      padding: const EdgeInsets.all(NoboSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.chat_bubble_rounded, size: 13, color: c.positive),
              const SizedBox(width: 6),
              Text(
                'WhatsApp preview',
                style: NoboType.micro.copyWith(color: c.inkTertiary),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          Container(
            padding: const EdgeInsets.all(NoboSpace.md),
            decoration: BoxDecoration(
              color: c.positiveWash,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(NoboRadius.xs),
                topRight: Radius.circular(NoboRadius.md),
                bottomLeft: Radius.circular(NoboRadius.md),
                bottomRight: Radius.circular(NoboRadius.md),
              ),
            ),
            child: Text(
              artifact.bodyText ?? artifact.description ?? '',
              style: NoboType.body.copyWith(color: c.ink),
            ),
          ),
        ],
      ),
    );
  }
}

/// Renders any artifact the agent produced.
class AgentArtifactView extends StatelessWidget {
  const AgentArtifactView({
    required this.artifact,
    this.onApprove,
    this.onReject,
    this.onAnswer,
    this.onOpenMedia,
    this.busy = false,
    super.key,
  });

  final AgentArtifact artifact;
  final VoidCallback? onApprove;
  final VoidCallback? onReject;
  final ValueChanged<String>? onAnswer;
  final ValueChanged<AgentArtifact>? onOpenMedia;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    switch (artifact.kind) {
      case ArtifactKind.videoPlayer:
        return NoboMediaTile(
          source: artifact.url,
          isVideo: true,
          durationSeconds: artifact.durationSeconds,
          aspectRatio: 4 / 5,
          onTap: onOpenMedia == null ? null : () => onOpenMedia!(artifact),
          badge: artifact.title == null
              ? null
              : const NoboPill(label: 'Video', tone: NoboPillTone.brand, dense: true),
        );
      case ArtifactKind.imagePreview:
        return NoboMediaTile(
          source: artifact.url,
          aspectRatio: 1,
          onTap: onOpenMedia == null ? null : () => onOpenMedia!(artifact),
        );
      case ArtifactKind.actionConfirmation:
        return ApprovalCard(
          artifact: artifact,
          onApprove: onApprove,
          onReject: onReject,
          busy: busy,
        );
      case ArtifactKind.userInputPrompt:
        return QuestionCard(artifact: artifact, onAnswer: onAnswer);
      case ArtifactKind.whatsappPreview:
        return WhatsappPreviewCard(artifact: artifact);
      case ArtifactKind.progressTracker:
      case ArtifactKind.htmlSandbox:
      case ArtifactKind.unknown:
        final String text =
            artifact.bodyText ?? artifact.description ?? artifact.title ?? '';
        if (text.isEmpty) return const SizedBox.shrink();
        return Container(
          padding: const EdgeInsets.all(NoboSpace.md),
          decoration: BoxDecoration(
            color: context.nobo.surfaceSunken,
            borderRadius: NoboRadius.rSm,
          ),
          child: Text(
            text,
            style: NoboType.caption.copyWith(color: context.nobo.inkSecondary),
          ),
        );
    }
  }
}