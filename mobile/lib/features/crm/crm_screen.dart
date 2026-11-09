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
import '../../core/ui/media.dart';
import '../../core/ui/refresh.dart';
import '../../core/ui/surfaces.dart';
import '../../core/utils/format.dart';
import '../../data/workspace_source.dart';

enum _CrmFilter { pipeline, dueToday, all }

/// CRM, optimised for a phone.
///
/// A business owner checks this in the gaps between meetings, so the screen
/// leads with "who needs contact today" and keeps the full pipeline one tap
/// away — rather than opening on a wide kanban that only works on a laptop.
class CrmScreen extends ConsumerStatefulWidget {
  const CrmScreen({super.key});

  @override
  ConsumerState<CrmScreen> createState() => _CrmScreenState();
}

class _CrmScreenState extends ConsumerState<CrmScreen> {
  _CrmFilter _filter = _CrmFilter.pipeline;
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<LeadSeed>> leadsAsync = ref.watch(leadsProvider);
    final List<LeadSeed> all = leadsAsync.value ?? const <LeadSeed>[];

    final List<LeadSeed> visible = switch (_filter) {
      _CrmFilter.pipeline => all
          .where((LeadSeed l) => !_isClosed(l.stage))
          .toList(growable: false),
      _CrmFilter.dueToday => all
          .where(
            (LeadSeed l) =>
                l.nextFollowup != null &&
                _isSameDay(l.nextFollowup!, DateTime.now()) &&
                !_isClosed(l.stage),
          )
          .toList(growable: false),
      _CrmFilter.all => all,
    };

    final List<LeadSeed> searched = _query.isEmpty
        ? visible
        : visible
              .where(
                (LeadSeed l) =>
                    l.name.toLowerCase().contains(_query.toLowerCase()) ||
                    (l.phone ?? '').contains(_query),
              )
              .toList(growable: false);

    final int overdue = all
        .where(
          (LeadSeed l) =>
              l.nextFollowup != null &&
              isBeforeToday(l.nextFollowup!) &&
              !_leadIsClosed(l.stage),
        )
        .length;
    final int won = all.where((LeadSeed l) => _isWon(l.stage)).length;

    return Scaffold(
      backgroundColor: c.canvas,
      body: SafeArea(
        bottom: false,
        child: NoboRefreshScroll(
          onRefresh: () async {
            ref.invalidate(leadsProvider);
            await ref
                .read(leadsProvider.future)
                .catchError((Object _) => const <LeadSeed>[]);
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
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Business',
                      style: NoboType.title.copyWith(color: c.ink),
                    ),
                    Text(
                      all.isEmpty
                          ? 'No leads yet'
                          : '${all.length} leads · $overdue overdue · $won won',
                      style: NoboType.caption.copyWith(
                        color: overdue > 0 ? c.accent : c.inkTertiary,
                      ),
                    ),
                    const SizedBox(height: NoboSpace.base),
                    NoboSegmented<_CrmFilter>(
                      selected: _filter,
                      onChanged: (_CrmFilter f) => setState(() => _filter = f),
                      segments: const <({_CrmFilter value, String label})>[
                        (value: _CrmFilter.pipeline, label: 'Pipeline'),
                        (value: _CrmFilter.dueToday, label: 'Today'),
                        (value: _CrmFilter.all, label: 'All'),
                      ],
                    ),
                    const SizedBox(height: NoboSpace.md),
                    _SearchField(
                      value: _query,
                      onChanged: (String v) => setState(() => _query = v),
                    ),
                  ],
                ),
              ),
            ),

            if (_filter == _CrmFilter.pipeline && all.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    NoboSpace.gutter,
                    NoboSpace.lg,
                    NoboSpace.gutter,
                    0,
                  ),
                  child: _StageBar(leads: all),
                ),
              ),

            if (leadsAsync.isLoading)
              const SliverToBoxAdapter(
                child: SizedBox(height: 200, child: NoboLoading()),
              )
            else if (leadsAsync.hasError)
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 300,
                  child: NoboErrorState(
                    error: leadsAsync.error!,
                    onRetry: () => ref.invalidate(leadsProvider),
                  ),
                ),
              )
            else if (searched.isEmpty)
              SliverToBoxAdapter(
                child: NoboEmptyState(
                  title: _query.isEmpty
                      ? (_filter == _CrmFilter.dueToday
                            ? 'Nothing due today'
                            : 'No leads yet')
                      : 'No lead matches "$_query"',
                  message: _query.isEmpty
                      ? 'Leads arrive from Meta, your website forms and property '
                            'portals. Nobogent can follow them up for you.'
                      : 'Try a different name or number.',
                  icon: Icons.people_outline_rounded,
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.base,
                  NoboSpace.gutter,
                  0,
                ),
                sliver: SliverList.separated(
                  itemCount: searched.length,
                  separatorBuilder: (_, _) =>
                      const SizedBox(height: NoboSpace.sm),
                  itemBuilder: (BuildContext context, int i) =>
                      _LeadRow(lead: searched[i]),
                ),
              ),
          ],
        ),
      ),
    );
  }

  static bool _isClosed(String stage) => _leadIsClosed(stage);

  static bool _isWon(String stage) => _leadIsWon(stage);

  static bool _isSameDay(DateTime a, DateTime b) => _sameDay(a, b);
}

bool _leadIsClosed(String stage) {
  final String s = stage.toLowerCase();
  return s.contains('won') ||
      s.contains('lost') ||
      s.contains('not interested') ||
      s.contains('disqualified') ||
      s.contains('junk');
}

bool _leadIsWon(String stage) => stage.toLowerCase().contains('won');

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

class _StageBar extends StatelessWidget {
  const _StageBar({required this.leads});

  final List<LeadSeed> leads;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    const List<String> stages = <String>[
      'New Lead',
      'Contacted',
      'Qualified',
      'Meeting Scheduled',
      'Negotiation',
      'Deal Won',
    ];
    final Map<String, int> counts = <String, int>{};
    for (final LeadSeed l in leads) {
      counts[l.stage] = (counts[l.stage] ?? 0) + 1;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('PIPELINE', style: NoboType.micro.copyWith(color: c.inkTertiary)),
        const SizedBox(height: NoboSpace.sm),
        SizedBox(
          height: 46,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            // Trailing padding so the last stage is not clipped flush against
            // the screen edge, which reads as broken rather than scrollable.
            padding: const EdgeInsets.only(right: NoboSpace.gutter),
            itemCount: stages.length,
            separatorBuilder: (_, _) => const SizedBox(width: 6),
            itemBuilder: (BuildContext context, int i) {
              final String stage = stages[i];
              final int count = counts[stage] ?? 0;
              final bool active = count > 0;
              return Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.md,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: active ? c.primaryWash : c.surfaceSunken,
                  borderRadius: NoboRadius.rSm,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      '$count',
                      style: NoboType.numeric(
                        NoboType.label.copyWith(
                          color: active ? c.primary : c.inkTertiary,
                          fontSize: 14,
                        ),
                      ),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      _short(stage),
                      style: NoboType.caption.copyWith(
                        color: active ? c.primary : c.inkTertiary,
                        fontSize: 10.5,
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  String _short(String stage) {
    switch (stage) {
      case 'New Lead':
        return 'New';
      case 'Meeting Scheduled':
        return 'Meeting';
      case 'Deal Won':
        return 'Won';
      default:
        return stage;
    }
  }
}

class _LeadRow extends StatelessWidget {
  const _LeadRow({required this.lead});

  final LeadSeed lead;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool overdue =
        lead.nextFollowup != null &&
        isBeforeToday(lead.nextFollowup!) &&
        !_leadIsClosed(lead.stage);

    return NoboCard(
      onTap: () => context.push(Routes.lead(lead.id)),
      padding: const EdgeInsets.all(NoboSpace.md),
      child: Row(
        children: <Widget>[
          NoboAvatar(name: lead.name, size: 40),
          const SizedBox(width: NoboSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        lead.name,
                        style: NoboType.bodyStrong.copyWith(color: c.ink),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (overdue)
                      const NoboPill(
                        label: 'Overdue',
                        tone: NoboPillTone.danger,
                        dense: true,
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  lead.phone ?? 'No number',
                  style: NoboType.caption.copyWith(color: c.inkSecondary),
                ),
                const SizedBox(height: NoboSpace.sm),
                // Wrap, not Row: the stage name plus a relative time can exceed
                // a compact phone's width once the stage text is long.
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    _stagePill(lead.stage),
                    if (lead.nextFollowup != null)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Icon(
                            Icons.schedule_rounded,
                            size: 11,
                            color: c.inkTertiary,
                          ),
                          const SizedBox(width: 3),
                          Text(
                            timeAgo(lead.nextFollowup),
                            style: NoboType.caption.copyWith(
                              color: c.inkTertiary,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
                  ],
                ),
              ),
          Icon(Icons.chevron_right_rounded, size: 20, color: c.inkTertiary),
        ],
      ),
    );
  }

  Widget _stagePill(String stage) {
    final String s = stage.toLowerCase();
    final NoboPillTone tone = s.contains('won')
        ? NoboPillTone.positive
        : s.contains('lost') || s.contains('not interested')
        ? NoboPillTone.danger
        : s.contains('negotiation') || s.contains('proposal')
        ? NoboPillTone.credit
        : s.contains('meeting') || s.contains('qualified')
        ? NoboPillTone.brand
        : NoboPillTone.neutral;
    return NoboPill(label: stage, tone: tone, dense: true);
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      height: 42,
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: NoboRadius.rSm,
        border: Border.all(color: c.border),
      ),
      padding: const EdgeInsets.symmetric(horizontal: NoboSpace.md),
      child: Row(
        children: <Widget>[
          Icon(Icons.search_rounded, size: 17, color: c.inkTertiary),
          const SizedBox(width: NoboSpace.sm),
          Expanded(
            child: TextFormField(
              initialValue: value,
              onChanged: onChanged,
              style: NoboType.body.copyWith(color: c.ink, fontSize: 14.5),
              cursorColor: c.primary,
              decoration: InputDecoration(
                isDense: true,
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
                hintText: 'Search leads',
                hintStyle: NoboType.body.copyWith(
                  color: c.inkTertiary,
                  fontSize: 14.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}