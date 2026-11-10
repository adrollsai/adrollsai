import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../core/ui/navigation.dart';
import '../../data/repositories/auth_repository.dart';
import '../../core/utils/format.dart';
import '../../data/models/profile.dart';
import '../../data/workspace_source.dart';
import '../pwa/pwa_widgets.dart';
import 'voip_sheet.dart';

/// CRM Pipeline â€” reproduction of the web app's `/dashboard/crm`.
///
/// Matches the web layout: header with an "Enable Alerts" pill, the collapsible
/// "CRM Actions & Controls" panel, a search + "View & Filter Controls" card with
/// the All / Fresh / Ongoing tabs (with counts), select-all, pagination, and lead
/// cards carrying the web app's action row.
class CrmScreen extends ConsumerStatefulWidget {
  const CrmScreen({super.key});

  @override
  ConsumerState<CrmScreen> createState() => _CrmScreenState();
}

class _CrmScreenState extends ConsumerState<CrmScreen> {
  String _query = '';
  int _tab = 0;
  int _page = 0;
  static const int _perPage = 50;
  bool _controlsOpen = false;

  static const List<String> _tabs = <String>[
    'All Leads',
    'Fresh Leads',
    'Ongoing',
  ];

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<LeadSeed>> async = ref.watch(leadsProvider);
    final List<LeadSeed> all = async.value ?? const <LeadSeed>[];
    // VoIP dialling is a super-admin capability in the web app, so the button is
    // only offered when the signed-in account actually has it.
    final NoboProfile? profile = ref.watch(accountProvider).value;
    final bool canVoip = profile?.canUseAgent ?? false;

    int countFor(int tab) => switch (tab) {
      1 => all
          .where((LeadSeed l) => l.stage.toLowerCase().contains('new'))
          .length,
      2 => all.where((LeadSeed l) => !_isClosed(l.stage)).length,
      _ => all.length,
    };

    final List<LeadSeed> byTab = switch (_tab) {
      1 => all
          .where((LeadSeed l) => l.stage.toLowerCase().contains('new'))
          .toList(growable: false),
      2 => all
          .where((LeadSeed l) => !_isClosed(l.stage))
          .toList(growable: false),
      _ => all,
    };
    final List<LeadSeed> searched = _query.isEmpty
        ? byTab
        : byTab
              .where(
                (LeadSeed l) =>
                    l.name.toLowerCase().contains(_query.toLowerCase()) ||
                    (l.phone ?? '').contains(_query),
              )
              .toList(growable: false);

    final int pages = searched.isEmpty
        ? 1
        : (searched.length / _perPage).ceil();
    final int safePage = _page.clamp(0, pages - 1);
    final List<LeadSeed> visible = searched
        .skip(safePage * _perPage)
        .take(_perPage)
        .toList(growable: false);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(leadsProvider);
        await ref
            .read(leadsProvider.future)
            .catchError((Object _) => const <LeadSeed>[]);
      },
      color: c.primary,
      backgroundColor: c.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: <Widget>[
          NoboPageHeader(
            title: 'CRM Pipeline',
            subtitle: 'Manage and distribute your leads',
            actions: <Widget>[
              NoboCircleAction(
                icon: Icons.refresh_rounded,
                onTap: () => ref.invalidate(leadsProvider),
                tooltip: 'Refresh',
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: c.primaryWash,
                    borderRadius: NoboRadius.rPill,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(
                        Icons.notifications_active_outlined,
                        size: 14,
                        color: c.primary,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Enable Alerts',
                        style: NoboType.label.copyWith(
                          color: c.primary,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: NoboSpace.md),

                // Collapsible actions panel.
                PwaCard(
                  padding: EdgeInsets.zero,
                  onTap: () =>
                      setState(() => _controlsOpen = !_controlsOpen),
                  child: Column(
                    children: <Widget>[
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: NoboSpace.base,
                          vertical: 14,
                        ),
                        child: Row(
                          children: <Widget>[
                            Icon(
                              Icons.sell_outlined,
                              size: 16,
                              color: c.primary,
                            ),
                            const SizedBox(width: NoboSpace.sm),
                            Expanded(
                              child: Text(
                                'CRM Actions & Controls',
                                style: NoboType.label.copyWith(
                                  color: c.ink,
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            Icon(
                              _controlsOpen
                                  ? Icons.expand_less_rounded
                                  : Icons.expand_more_rounded,
                              size: 20,
                              color: c.inkTertiary,
                            ),
                          ],
                        ),
                      ),
                      if (_controlsOpen) ...<Widget>[
                        Divider(height: 1, color: c.hairline),
                        Padding(
                          padding: const EdgeInsets.all(NoboSpace.base),
                          child: Text(
                            'Bulk transfer, round-robin distribution and stage '
                            'automation run from the web app.',
                            style: NoboType.caption.copyWith(
                              color: c.inkSecondary,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: NoboSpace.base),

                // Search + filter card.
                PwaCard(
                  child: Column(
                    children: <Widget>[
                      PwaSearchField(
                        hint: 'Search by name, phone, or emailâ€¦',
                        onChanged: (String v) => setState(() {
                          _query = v;
                          _page = 0;
                        }),
                      ),
                      const SizedBox(height: NoboSpace.md),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: NoboSpace.base,
                          vertical: 12,
                        ),
                        decoration: BoxDecoration(
                          color: c.surfaceSunken,
                          borderRadius: NoboRadius.rMd,
                        ),
                        child: Row(
                          children: <Widget>[
                            Icon(
                              Icons.tune_rounded,
                              size: 15,
                              color: c.inkSecondary,
                            ),
                            const SizedBox(width: NoboSpace.sm),
                            Expanded(
                              child: Text(
                                'View & Filter Controls',
                                style: NoboType.label.copyWith(
                                  color: c.ink,
                                  fontSize: 12.5,
                                ),
                              ),
                            ),
                            Text(
                              'SHOW',
                              style: NoboType.micro.copyWith(
                                color: c.inkTertiary,
                                fontSize: 10,
                              ),
                            ),
                            Icon(
                              Icons.expand_more_rounded,
                              size: 16,
                              color: c.inkTertiary,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: NoboSpace.md),
                      SizedBox(
                        height: 38,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          padding: EdgeInsets.zero,
                          itemCount: _tabs.length,
                          separatorBuilder: (_, _) =>
                              const SizedBox(width: NoboSpace.lg),
                          itemBuilder: (BuildContext context, int i) {
                            final bool active = i == _tab;
                            return GestureDetector(
                              onTap: () => setState(() {
                                _tab = i;
                                _page = 0;
                              }),
                              behavior: HitTestBehavior.opaque,
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: <Widget>[
                                  Row(
                                    children: <Widget>[
                                      Text(
                                        _tabs[i],
                                        style: NoboType.label.copyWith(
                                          fontSize: 13,
                                          color: active
                                              ? c.ink
                                              : c.inkSecondary,
                                          fontWeight: active
                                              ? FontWeight.w700
                                              : FontWeight.w500,
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 7,
                                          vertical: 1,
                                        ),
                                        decoration: BoxDecoration(
                                          color: active
                                              ? c.navy
                                              : c.surfaceSunken,
                                          borderRadius: NoboRadius.rPill,
                                        ),
                                        child: Text(
                                          '${countFor(i)}',
                                          style: NoboType.caption.copyWith(
                                            color: active
                                                ? c.onNavy
                                                : c.inkSecondary,
                                            fontSize: 10.5,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Container(
                                    height: 2,
                                    width: 44,
                                    color: active
                                        ? c.ink
                                        : Colors.transparent,
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: NoboSpace.base),

                if (async.isLoading)
                  const Padding(
                    padding: EdgeInsets.only(top: NoboSpace.xl),
                    child: SizedBox(height: 180, child: PwaLoading()),
                  )
                else ...<Widget>[
                  PwaCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: NoboSpace.base,
                      vertical: 13,
                    ),
                    child: Row(
                      children: <Widget>[
                        Icon(
                          Icons.check_box_outline_blank_rounded,
                          size: 18,
                          color: c.inkTertiary,
                        ),
                        const SizedBox(width: NoboSpace.md),
                        Expanded(
                          child: Text(
                            'Select All ${visible.length} leads on this page',
                            style: NoboType.label.copyWith(
                              color: c.ink,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: NoboSpace.md),
                  Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: NoboSpace.md,
                    runSpacing: NoboSpace.sm,
                    children: <Widget>[
                      _PageButton(
                        label: 'Previous',
                        enabled: safePage > 0,
                        onTap: () => setState(() => _page = safePage - 1),
                      ),
                      Padding(
                        padding: EdgeInsets.zero,
                        child: Text(
                          'Page ${safePage + 1} of $pages',
                          style: NoboType.label.copyWith(
                            color: c.ink,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      _PageButton(
                        label: 'Next',
                        enabled: safePage < pages - 1,
                        onTap: () => setState(() => _page = safePage + 1),
                      ),
                    ],
                  ),
                  const SizedBox(height: NoboSpace.md),
                  Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: NoboSpace.sm,
                    runSpacing: NoboSpace.sm,
                    children: <Widget>[
                      Text(
                        'Leads per page:',
                        style: NoboType.caption.copyWith(
                          color: c.inkSecondary,
                        ),
                      ),
                      const SizedBox(width: NoboSpace.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: NoboSpace.md,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: c.surface,
                          borderRadius: NoboRadius.rSm,
                          border: Border.all(color: c.border),
                        ),
                        child: Row(
                          children: <Widget>[
                            Text(
                              '$_perPage',
                              style: NoboType.label.copyWith(
                                color: c.ink,
                                fontSize: 12.5,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Icon(
                              Icons.expand_more_rounded,
                              size: 15,
                              color: c.inkTertiary,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: NoboSpace.base),
                  for (final LeadSeed lead in visible)
                    Padding(
                      padding: const EdgeInsets.only(bottom: NoboSpace.md),
                      child: _LeadCard(
                        lead: lead,
                        canVoip: canVoip,
                        onDelete: () => _deleteLead(lead),
                        onFollowup: () => _logFollowup(lead),
                        onVoip: () => showVoipSheet(
                          context: context,
                          ref: ref,
                          name: lead.name,
                          phone: lead.phone ?? '',
                          leadId: lead.id,
                        ),
                      ),
                    ),
                  if (visible.isEmpty)
                    PwaCard(
                      child: Column(
                        children: <Widget>[
                          Icon(
                            Icons.people_outline_rounded,
                            size: 28,
                            color: c.inkTertiary,
                          ),
                          const SizedBox(height: NoboSpace.md),
                          Text(
                            'No leads match this view',
                            style: NoboType.subtitle.copyWith(color: c.ink),
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }

  Future<void> _deleteLead(LeadSeed lead) async {
    final bool ok = await showNoboConfirm(
      context: context,
      title: 'Delete lead?',
      message:
          'This removes ${lead.name} from your CRM. Their conversation history '
          'is kept.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (!ok) return;
    try {
      await ref.read(workspaceRepositoryProvider).deleteLead(lead.id);
      ref.invalidate(leadsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Lead deleted.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on NoboFailure catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), behavior: SnackBarBehavior.floating),
      );
    }
  }

  Future<void> _logFollowup(LeadSeed lead) async {
    try {
      await ref
          .read(workspaceRepositoryProvider)
          .logLeadActivity(
            leadId: lead.id,
            actionType: 'FOLLOWUP',
            description: 'Follow-up logged from the mobile CRM',
          );
      ref.invalidate(leadsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Follow-up logged.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on NoboFailure catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), behavior: SnackBarBehavior.floating),
      );
    }
  }

  static bool _isClosed(String stage) {
    final String s = stage.toLowerCase();
    return s.contains('won') ||
        s.contains('lost') ||
        s.contains('not interested') ||
        s.contains('disqualified') ||
        s.contains('junk');
  }
}

class _PageButton extends StatelessWidget {
  const _PageButton({
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: NoboSpace.base,
          vertical: 9,
        ),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: NoboRadius.rPill,
          border: Border.all(color: c.border),
        ),
        child: Text(
          label,
          style: NoboType.label.copyWith(
            fontSize: 13,
            color: enabled ? c.ink : c.inkTertiary,
          ),
        ),
      ),
    );
  }
}

/// One lead row, matching the web app's card.
class _LeadCard extends StatelessWidget {
  const _LeadCard({
    required this.lead,
    required this.canVoip,
    required this.onVoip,
    required this.onDelete,
    required this.onFollowup,
  });

  final LeadSeed lead;
  final bool canVoip;
  final VoidCallback onVoip;
  final VoidCallback onDelete;
  final VoidCallback onFollowup;

  static String _digits(String? phone) =>
      (phone ?? '').replaceAll(RegExp(r'[^0-9+]'), '');

  Future<void> _launch(String url) async {
    final Uri? uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // No dialer/WhatsApp installed â€” ignore.
    }
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final String dial = _digits(lead.phone);

    return PwaCard(
      padding: const EdgeInsets.all(NoboSpace.base),
      onTap: () => context.push(Routes.lead(lead.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.check_box_outline_blank_rounded,
                size: 18,
                color: c.inkTertiary,
              ),
              const SizedBox(width: NoboSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            lead.name,
                            style: NoboType.subtitle.copyWith(
                              color: c.ink,
                              fontSize: 15.5,
                              fontWeight: FontWeight.w700,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: NoboSpace.sm),
                        _WarmPill(score: _warmth(lead)),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      lead.phone ?? 'No number',
                      style: NoboType.caption.copyWith(
                        color: c.inkSecondary,
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Divider(height: 1, color: c.hairline),
          const SizedBox(height: NoboSpace.md),
          Wrap(
            spacing: NoboSpace.sm,
            runSpacing: NoboSpace.sm,
            children: <Widget>[
              _SoftPill(
                label: 'History',
                icon: Icons.history_rounded,
                tint: c.accent,
                onTap: () => context.push(Routes.lead(lead.id)),
              ),
              _SoftPill(
                label: 'Followup',
                icon: Icons.phone_callback_outlined,
                tint: c.primary,
                onTap: onFollowup,
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              PwaIconCircle(
                icon: Icons.person_add_alt_1_outlined,
                tint: c.inkSecondary,
                onTap: () {},
                tooltip: 'Assign',
              ),
              const SizedBox(width: NoboSpace.sm),
              PwaIconCircle(
                icon: Icons.call_rounded,
                tint: c.primary,
                onTap: dial.isEmpty ? null : () => _launch('tel:$dial'),
                tooltip: 'Call',
              ),
              const SizedBox(width: NoboSpace.sm),
              if (canVoip) ...<Widget>[
                GestureDetector(
                  onTap: onVoip,
                  child: Container(
                    height: 36,
                    padding: const EdgeInsets.symmetric(
                      horizontal: NoboSpace.md,
                    ),
                    decoration: BoxDecoration(
                      color: c.primary,
                      borderRadius: NoboRadius.rPill,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Icon(
                          Icons.phone_in_talk_rounded,
                          size: 14,
                          color: c.onPrimary,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          'VoIP',
                          style: NoboType.label.copyWith(
                            color: c.onPrimary,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: NoboSpace.sm),
              ],
              PwaIconCircle(
                icon: Icons.chat_bubble_rounded,
                tint: NoboBrand.whatsapp,
                onTap: dial.isEmpty
                    ? null
                    : () => _launch('https://wa.me/$dial'),
                tooltip: 'WhatsApp',
              ),
              const Spacer(),
              PwaIconCircle(
                icon: Icons.delete_outline_rounded,
                tint: c.inkSecondary,
                onTap: onDelete,
                tooltip: 'Delete lead',
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              Icon(Icons.sell_rounded, size: 12, color: c.danger),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  <String>[
                    'Leads',
                    if (lead.source != null) lead.source!,
                    if (lead.createdAt != null) fullDate(lead.createdAt!),
                  ].join(' | '),
                  style: NoboType.caption.copyWith(
                    color: c.inkSecondary,
                    fontSize: 11.5,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Icon(Icons.visibility_outlined, size: 13, color: c.inkTertiary),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.md,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: c.primaryWash,
                    borderRadius: NoboRadius.rSm,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Flexible(
                        child: Text(
                          lead.stage,
                          style: NoboType.label.copyWith(
                            color: c.primary,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Icon(
                        Icons.expand_more_rounded,
                        size: 15,
                        color: c.primary,
                      ),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              if (lead.createdAt != null)
                Text(
                  clockTime(lead.createdAt!),
                  style: NoboType.caption.copyWith(
                    color: c.inkTertiary,
                    fontSize: 11,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// The web app shows a numeric warmth score. Derived here from the signals the
  /// client actually holds (stage progress, call outcomes, attempts).
  static int _warmth(LeadSeed l) {
    int score = 25;
    final String s = l.stage.toLowerCase();
    if (s.contains('meeting') || s.contains('negotiat')) score += 30;
    if (s.contains('proposal') || s.contains('qualified')) score += 20;
    if (s.contains('contact')) score += 10;
    if (l.lastCallStatus == 'CONNECTED') score += 10;
    score += l.dnp.clamp(0, 3) * 2;
    return score.clamp(0, 100);
  }
}

class _WarmPill extends StatelessWidget {
  const _WarmPill({required this.score});

  final int score;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.cautionWash,
        borderRadius: NoboRadius.rPill,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.bolt_rounded, size: 11, color: c.caution),
          const SizedBox(width: 3),
          Text(
            '$score Warm',
            style: NoboType.caption.copyWith(
              color: c.caution,
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _SoftPill extends StatelessWidget {
  const _SoftPill({
    required this.label,
    required this.icon,
    required this.tint,
    this.onTap,
  });

  final String label;
  final IconData icon;
  final Color tint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.10),
        borderRadius: NoboRadius.rPill,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 12, color: tint),
          const SizedBox(width: 5),
          Text(
            label,
            style: NoboType.caption.copyWith(
              color: tint,
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          ],
        ),
      ),
    );
  }
}
