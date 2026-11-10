import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/platform/nobo_platform.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../core/ui/controls.dart';
import '../../core/ui/feedback.dart';
import '../../core/ui/media.dart';
import '../../core/ui/nobo_mark_loader.dart';
import '../../core/ui/surfaces.dart';
import '../../core/utils/format.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/workspace_source.dart';

/// One lead, with the actions a business owner actually performs on a phone:
/// call, WhatsApp, move stage, log a follow-up.
class LeadScreen extends ConsumerStatefulWidget {
  const LeadScreen({required this.leadId, super.key});

  final String leadId;

  @override
  ConsumerState<LeadScreen> createState() => _LeadScreenState();
}

class _LeadScreenState extends ConsumerState<LeadScreen> {
  bool _busy = false;

  Future<void> _launch(String url) async {
    final Uri? uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      final bool ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) _snack('Could not open that app.');
    } catch (_) {
      if (mounted) _snack('Could not open that app.');
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  static String _digits(String? phone) =>
      (phone ?? '').replaceAll(RegExp(r'[^0-9+]'), '');

  Future<void> _logActivity({
    required String leadId,
    required String type,
    String? description,
    String? stage,
  }) async {
    setState(() => _busy = true);
    try {
      await ref
          .read(workspaceRepositoryProvider)
          .logLeadActivity(
            leadId: leadId,
            actionType: type,
            description: description,
            updateStage: stage,
          );
      ref.invalidate(leadsProvider);
      if (!mounted) return;
      if (NoboPlatform.isAndroid) unawaited(HapticFeedback.lightImpact());
      _snack('Saved.');
    } on NoboFailure catch (e) {
      if (mounted) _snack(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeStage(LeadSeed lead) async {
    const List<String> stages = <String>[
      'New Lead',
      'Contacted',
      'Qualified',
      'Meeting Scheduled',
      'Meeting Done',
      'Proposal Sent',
      'Negotiation',
      'Deal Won',
      'Follow Up Later',
      'Unresponsive',
      'Lost / Disqualified',
    ];

    await showNoboSheet<void>(
      context: context,
      builder: (BuildContext ctx) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            NoboSheetHeader(
              title: 'Move stage',
              subtitle: 'Currently ${lead.stage}',
              onClose: () => Navigator.of(ctx).pop(),
            ),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.only(bottom: NoboSpace.base),
                itemCount: stages.length,
                separatorBuilder: (_, _) =>
                    Divider(height: 1, color: context.nobo.hairline),
                itemBuilder: (BuildContext context, int i) {
                  final String s = stages[i];
                  final bool current = s == lead.stage;
                  return ListTile(
                    title: Text(
                      s,
                      style: NoboType.body.copyWith(
                        color: current
                            ? context.nobo.primary
                            : context.nobo.ink,
                        fontWeight: current
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                    trailing: current
                        ? Icon(
                            Icons.check_rounded,
                            size: 18,
                            color: context.nobo.primary,
                          )
                        : null,
                    onTap: () {
                      Navigator.of(ctx).pop();
                      _logActivity(
                        leadId: lead.id,
                        type: 'STATUS_CHANGE',
                        description: 'Moved to $s from mobile',
                        stage: s,
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<LeadSeed>> leadsAsync = ref.watch(leadsProvider);
    final LeadSeed? lead = (leadsAsync.value ?? const <LeadSeed>[])
        .where((LeadSeed l) => l.id == widget.leadId)
        .firstOrNull;

    if (leadsAsync.isLoading) {
      return Scaffold(
        backgroundColor: c.canvas,
        appBar: AppBar(),
        body: const NoboLoading(),
      );
    }

    if (lead == null) {
      return Scaffold(
        backgroundColor: c.canvas,
        appBar: AppBar(),
        body: NoboEmptyState(
          title: 'Lead not found',
          message: 'This lead may have been reassigned or removed.',
          icon: Icons.person_search_outlined,
          actionLabel: 'Back',
          onAction: () => context.pop(),
        ),
      );
    }

    final String dial = _digits(lead.phone);
    final bool overdue =
        lead.nextFollowup != null &&
        lead.nextFollowup!.isBefore(DateTime.now());

    return Scaffold(
      backgroundColor: c.canvas,
      appBar: AppBar(
        leading: IconButton(
          icon: Icon(
            NoboPlatform.isIOS
                ? Icons.arrow_back_ios_new_rounded
                : Icons.arrow_back_rounded,
            size: 20,
          ),
          onPressed: () => context.pop(),
        ),
        title: Text('Lead', style: NoboType.bodyStrong.copyWith(color: c.ink)),
        actions: <Widget>[
          if (_busy)
            Padding(
              padding: const EdgeInsets.only(right: NoboSpace.base),
              child: Center(
                child: NoboMarkLoader(
                  size: 15,
                  color: context.nobo.primary,
                  semanticLabel: 'Loading',
                ),
              ),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          NoboSpace.gutter,
          NoboSpace.sm,
          NoboSpace.gutter,
          NoboSpace.xxl,
        ),
        children: <Widget>[
          Row(
            children: <Widget>[
              NoboAvatar(name: lead.name, size: 56),
              const SizedBox(width: NoboSpace.base),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      lead.name,
                      style: NoboType.headline.copyWith(color: c.ink),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      lead.phone ?? 'No phone number',
                      style: NoboType.body.copyWith(color: c.inkSecondary),
                    ),
                    const SizedBox(height: NoboSpace.sm),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: <Widget>[
                        NoboPill(label: lead.stage, tone: NoboPillTone.brand),
                        if (overdue)
                          const NoboPill(
                            label: 'Follow-up overdue',
                            tone: NoboPillTone.danger,
                          ),
                        if (lead.dnp > 0)
                          NoboPill(
                            label: '${lead.dnp} DNP',
                            tone: NoboPillTone.caution,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.lg),

          // Primary actions live in the thumb zone, above the fold.
          Row(
            children: <Widget>[
              Expanded(
                child: NoboButton(
                  label: 'Call',
                  icon: Icons.call_rounded,
                  expand: true,
                  onPressed: dial.isEmpty
                      ? null
                      : () => _launch('tel:$dial'),
                ),
              ),
              const SizedBox(width: NoboSpace.sm),
              Expanded(
                child: NoboButton(
                  label: 'WhatsApp',
                  icon: Icons.chat_bubble_rounded,
                  variant: NoboButtonVariant.tonal,
                  expand: true,
                  onPressed: dial.isEmpty
                      ? null
                      : () => _launch('https://wa.me/$dial'),
                ),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: NoboButton(
                  label: 'Move stage',
                  icon: Icons.swap_horiz_rounded,
                  variant: NoboButtonVariant.outline,
                  size: NoboButtonSize.small,
                  expand: true,
                  onPressed: () => _changeStage(lead),
                ),
              ),
              const SizedBox(width: NoboSpace.sm),
              Expanded(
                child: NoboButton(
                  label: 'Log follow-up',
                  icon: Icons.event_available_rounded,
                  variant: NoboButtonVariant.outline,
                  size: NoboButtonSize.small,
                  expand: true,
                  onPressed: () => _logActivity(
                    leadId: lead.id,
                    type: 'FOLLOWUP',
                    description: 'Follow-up logged from mobile',
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: NoboSpace.lg),
          NoboCard(
            child: Column(
              children: <Widget>[
                NoboMetaRow(
                  label: 'Phone',
                  value: lead.phone ?? '—',
                  icon: Icons.call_outlined,
                ),
                if (lead.source != null)
                  NoboMetaRow(
                    label: 'Source',
                    value: lead.source!,
                    icon: Icons.campaign_outlined,
                  ),
                if (lead.nextFollowup != null)
                  NoboMetaRow(
                    label: 'Next action',
                    value:
                        '${dayLabel(lead.nextFollowup!)} · '
                        '${clockTime(lead.nextFollowup!)}',
                    icon: Icons.schedule_rounded,
                  ),
                if (lead.createdAt != null)
                  NoboMetaRow(
                    label: 'Added',
                    value: fullDate(lead.createdAt!),
                    icon: Icons.add_circle_outline_rounded,
                  ),
                if (lead.lastCallStatus != null)
                  NoboMetaRow(
                    label: 'Last call',
                    value: lead.lastCallStatus!,
                    icon: Icons.phone_callback_outlined,
                  ),
                if (lead.projectId != null)
                  NoboMetaRow(
                    label: 'Project',
                    value: lead.projectId!,
                    icon: Icons.workspaces_outline,
                  ),
              ],
            ),
          ),

          if (lead.notes != null && lead.notes!.trim().isNotEmpty) ...<Widget>[
            const SizedBox(height: NoboSpace.lg),
            Text(
              'NOTES',
              style: NoboType.micro.copyWith(color: c.inkTertiary),
            ),
            const SizedBox(height: NoboSpace.sm),
            NoboCard(
              child: Text(
                lead.notes!,
                style: NoboType.body.copyWith(
                  color: c.inkSecondary,
                  height: 1.55,
                ),
              ),
            ),
          ],

          const SizedBox(height: NoboSpace.lg),
          NoboButton(
            label: 'Ask Nobogent to follow up',
            icon: Icons.auto_awesome,
            variant: NoboButtonVariant.tonal,
            expand: true,
            onPressed: () => context.go('/create'),
          ),
        ],
      ),
    );
  }
}
