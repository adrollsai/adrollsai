import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/navigation.dart';
import '../../data/models/profile.dart';
import '../../data/workspace_source.dart';
import 'pwa_widgets.dart';

/// Analytics — the web app's landing screen after sign-in.
///
/// Reproduces the real layout: a "SALES ANALYTICS" eyebrow, "Hi, {name}", the
/// assignee chip, the range segmented row, the blue "Analytics Dashboard" tab,
/// and the colour-coded metric grid where each tile carries a value, a tinted
/// icon circle and a "Click to view list →" link.
class AnalyticsScreen extends ConsumerStatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  ConsumerState<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends ConsumerState<AnalyticsScreen> {
  int _range = 5;
  static const List<String> _ranges = <String>[
    'Today',
    '7 Days',
    '30 Days',
    'This Month',
    'Last Month',
    'All Time',
  ];

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final NoboProfile? profile = ref.watch(accountProvider).value;
    final List<LeadSeed> leads =
        ref.watch(leadsProvider).value ?? const <LeadSeed>[];
    final List<AssetSeed> assets =
        ref.watch(assetsProvider).value ?? const <AssetSeed>[];

    // Derived from the same lead data the CRM screen uses.
    final int total = leads.length;
    final int fresh = leads
        .where((LeadSeed l) => l.stage.toLowerCase().contains('new'))
        .length;
    final int followUp = leads
        .where((LeadSeed l) => l.stage.toLowerCase().contains('follow'))
        .length;
    final int ongoing = leads
        .where((LeadSeed l) => l.stage.toLowerCase().contains('contact'))
        .length;
    final int won = leads
        .where((LeadSeed l) => l.stage.toLowerCase().contains('won'))
        .length;
    final int unassigned = leads.where((LeadSeed l) => l.dnp == 0).length;
    final int dnp = leads.where((LeadSeed l) => l.dnp > 0).length;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(leadsProvider);
        ref.invalidate(assetsProvider);
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
            eyebrow: 'Sales Analytics',
            title: 'Hi, ${profile?.workspaceName ?? 'there'}',
            subtitle:
                'Filter, sort, and drilldown into live sales metrics & employee matrices.',
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                PwaCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.base,
                    vertical: 13,
                  ),
                  onTap: () {},
                  child: Row(
                    children: <Widget>[
                      Icon(
                        Icons.person_outline_rounded,
                        size: 17,
                        color: c.inkTertiary,
                      ),
                      const SizedBox(width: NoboSpace.sm),
                      Expanded(
                        child: Text(
                          'All Sales Reps (1)',
                          style: NoboType.body.copyWith(
                            color: c.ink,
                            fontSize: 14,
                          ),
                        ),
                      ),
                      Icon(
                        Icons.expand_more_rounded,
                        size: 20,
                        color: c.inkTertiary,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: NoboSpace.md),
                // Range selector — a scrolling row of pills, active one white.
                SizedBox(
                  height: 40,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: EdgeInsets.zero,
                    itemCount: _ranges.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 6),
                    itemBuilder: (BuildContext context, int i) {
                      final bool active = i == _range;
                      return GestureDetector(
                        onTap: () => setState(() => _range = i),
                        child: Container(
                          alignment: Alignment.center,
                          padding: const EdgeInsets.symmetric(
                            horizontal: NoboSpace.base,
                          ),
                          decoration: BoxDecoration(
                            color: active ? c.surface : Colors.transparent,
                            borderRadius: NoboRadius.rPill,
                            border: Border.all(
                              color: active ? c.border : Colors.transparent,
                            ),
                            boxShadow: active ? NoboElevation.low : null,
                          ),
                          child: Text(
                            _ranges[i],
                            style: NoboType.label.copyWith(
                              fontSize: 13,
                              color: active ? c.primary : c.inkSecondary,
                              fontWeight: active
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
                const SizedBox(height: NoboSpace.md),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: PwaCard(
                        padding: const EdgeInsets.symmetric(
                          horizontal: NoboSpace.base,
                          vertical: 11,
                        ),
                        onTap: () {},
                        child: Row(
                          children: <Widget>[
                            Icon(
                              Icons.calendar_today_outlined,
                              size: 15,
                              color: c.inkSecondary,
                            ),
                            const SizedBox(width: NoboSpace.sm),
                            Text(
                              'Custom Date',
                              style: NoboType.label.copyWith(
                                color: c.ink,
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: NoboSpace.sm),
                    PwaIconCircle(
                      icon: Icons.refresh_rounded,
                      size: 40,
                      filled: false,
                      onTap: () {
                        ref.invalidate(leadsProvider);
                        ref.invalidate(assetsProvider);
                      },
                    ),
                  ],
                ),
                const SizedBox(height: NoboSpace.base),
                // Section tabs, the active one filled blue.
                SizedBox(
                  height: 44,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: EdgeInsets.zero,
                    children: <Widget>[
                      const _Tab(
                        label: 'Analytics Dashboard',
                        icon: Icons.bar_chart_rounded,
                        active: true,
                      ),
                      const SizedBox(width: NoboSpace.sm),
                      const _Tab(
                        label: 'Action Manager',
                        icon: Icons.check_box_outlined,
                        active: false,
                      ),
                      const SizedBox(width: NoboSpace.sm),
                      const _Tab(
                        label: 'Action Reports',
                        icon: Icons.description_outlined,
                        active: false,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: NoboSpace.base),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: PwaStatTile(
                        label: 'Total Leads',
                        value: '$total',
                        tint: c.ink,
                        icon: Icons.groups_outlined,
                        onTap: () {},
                      ),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: PwaStatTile(
                        label: 'Ongoing',
                        value: '$ongoing',
                        tint: c.positive,
                        icon: Icons.trending_up_rounded,
                        onTap: () {},
                        badge: _HotBadge(tint: c.positive),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: NoboSpace.md),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: PwaStatTile(
                        label: 'Deal Won',
                        value: '$won',
                        tint: NoboBrand.rose500,
                        icon: Icons.schedule_rounded,
                        onTap: () {},
                      ),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: PwaStatTile(
                        label: 'Follow-Up',
                        value: '$followUp',
                        tint: c.caution,
                        icon: Icons.sync_rounded,
                        onTap: () {},
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: NoboSpace.md),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: PwaStatTile(
                        label: 'Fresh Leads',
                        value: '$fresh',
                        tint: c.accent,
                        icon: Icons.fiber_new_outlined,
                        onTap: () {},
                      ),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: PwaStatTile(
                        label: 'Unassigned',
                        value: '$unassigned',
                        tint: c.ink,
                        icon: Icons.person_outline_rounded,
                        onTap: () {},
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: NoboSpace.md),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: PwaStatTile(
                        label: 'DNP Count',
                        value: '$dnp',
                        tint: c.danger,
                        icon: Icons.content_cut_rounded,
                        onTap: () {},
                      ),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: PwaStatTile(
                        label: 'Assets',
                        value: '${assets.length}',
                        tint: c.primary,
                        icon: Icons.photo_library_outlined,
                        onTap: () {},
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }
}

class _HotBadge extends StatelessWidget {
  const _HotBadge({required this.tint});

  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.12),
        borderRadius: NoboRadius.rPill,
      ),
      child: Text(
        'HOT',
        style: NoboType.micro.copyWith(
          color: tint,
          fontSize: 9,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.label, required this.icon, required this.active});

  final String label;
  final IconData icon;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: NoboSpace.base),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: active ? c.primary : c.surface,
        borderRadius: NoboRadius.rPill,
        border: Border.all(color: active ? Colors.transparent : c.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 15, color: active ? c.onPrimary : c.inkSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: NoboType.label.copyWith(
              fontSize: 13,
              color: active ? c.onPrimary : c.inkSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}