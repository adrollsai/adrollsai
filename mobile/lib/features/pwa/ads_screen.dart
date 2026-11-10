import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/navigation.dart';
import '../../core/utils/format.dart';
import '../../data/models/comms.dart';
import 'pwa_widgets.dart';

/// AI Ads Manager — the web app's `/dashboard/ads`.
///
/// Shows the real Meta campaigns synced into `campaigns`: status, budget and
/// schedule, with the same summary-tile and filter-pill vocabulary the rest of
/// the app uses. Campaign creation and optimisation stay in the web app, where
/// the full Meta Ads flow lives; that is stated on the card actions.
class AdsScreen extends ConsumerStatefulWidget {
  const AdsScreen({super.key});

  @override
  ConsumerState<AdsScreen> createState() => _AdsScreenState();
}

class _AdsScreenState extends ConsumerState<AdsScreen> {
  int _filter = 0;
  static const List<String> _filters = <String>['All', 'Active', 'Paused'];

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<NoboCampaign>> async = ref.watch(campaignsProvider);
    final List<NoboCampaign> all = async.value ?? const <NoboCampaign>[];

    final List<NoboCampaign> items = switch (_filter) {
      1 => all.where((NoboCampaign x) => x.isActive).toList(growable: false),
      2 => all.where((NoboCampaign x) => x.isPaused).toList(growable: false),
      _ => all,
    };

    final int active = all.where((NoboCampaign x) => x.isActive).length;
    final double budget = all.fold<double>(
      0,
      (double sum, NoboCampaign x) => sum + (x.budget ?? 0),
    );

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(campaignsProvider);
        await ref
            .read(campaignsProvider.future)
            .catchError((Object _) => const <NoboCampaign>[]);
      },
      color: c.primary,
      backgroundColor: c.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: <Widget>[
          NoboPageHeader(
            title: 'AI Ads Manager',
            subtitle: 'Manage and automate your Meta campaigns',
            actions: <Widget>[
              NoboCircleAction(
                icon: Icons.refresh_rounded,
                onTap: () => ref.invalidate(campaignsProvider),
                tooltip: 'Refresh',
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: PwaStatTile(
                        label: 'Active campaigns',
                        value: '$active',
                        tint: c.positive,
                        icon: Icons.bolt_rounded,
                        linkLabel: '${all.length} total',
                      ),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: PwaStatTile(
                        label: 'Committed budget',
                        value: budget >= 1000
                            ? '₹${(budget / 1000).toStringAsFixed(1)}k'
                            : '₹${budget.toStringAsFixed(0)}',
                        tint: c.ink,
                        icon: Icons.account_balance_wallet_outlined,
                        linkLabel: 'Across all campaigns',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: NoboSpace.base),
                SizedBox(
                  height: 40,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: EdgeInsets.zero,
                    itemCount: _filters.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 6),
                    itemBuilder: (BuildContext context, int i) =>
                        PwaFilterPill(
                          label: _filters[i],
                          selected: i == _filter,
                          onTap: () => setState(() => _filter = i),
                        ),
                  ),
                ),
              ],
            ),
          ),
          if (async.isLoading)
            const Padding(
              padding: EdgeInsets.only(top: NoboSpace.huge),
              child: SizedBox(height: 180, child: PwaLoading()),
            )
          else if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NoboSpace.gutter,
                NoboSpace.xl,
                NoboSpace.gutter,
                NoboSpace.xxl,
              ),
              child: PwaCard(
                child: Column(
                  children: <Widget>[
                    Icon(Icons.bolt_outlined, size: 30, color: c.inkTertiary),
                    const SizedBox(height: NoboSpace.md),
                    Text(
                      _filter == 0
                          ? 'No campaigns yet'
                          : 'No ${_filters[_filter].toLowerCase()} campaigns',
                      style: NoboType.subtitle.copyWith(color: c.ink),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Launch a lead campaign from the web app and it will '
                      'appear here with its live budget and status.',
                      textAlign: TextAlign.center,
                      style: NoboType.caption.copyWith(color: c.inkSecondary),
                    ),
                  ],
                ),
              ),
            )
          else
            for (final NoboCampaign campaign in items)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.base,
                  NoboSpace.gutter,
                  0,
                ),
                child: _CampaignCard(campaign: campaign),
              ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }
}

class _CampaignCard extends StatelessWidget {
  const _CampaignCard({required this.campaign});

  final NoboCampaign campaign;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool active = campaign.isActive;
    final Color tone = active
        ? c.positive
        : campaign.isPaused
        ? c.caution
        : c.inkTertiary;

    return PwaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  campaign.name,
                  style: NoboType.subtitle.copyWith(
                    color: c.ink,
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: NoboSpace.sm),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 3,
                ),
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: 0.12),
                  borderRadius: NoboRadius.rPill,
                ),
                child: Text(
                  campaign.status,
                  style: NoboType.micro.copyWith(
                    color: tone,
                    fontSize: 9.5,
                    letterSpacing: 0.4,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              _Meta(
                icon: Icons.account_balance_wallet_outlined,
                label: campaign.budgetLabel,
              ),
              const SizedBox(width: NoboSpace.base),
              Expanded(
                child: _Meta(
                  icon: Icons.schedule_rounded,
                  label: campaign.startAt == null
                      ? 'Not scheduled'
                      : '${fullDate(campaign.startAt!)}'
                            '${campaign.endAt == null ? '' : ' → ${fullDate(campaign.endAt!)}'}',
                ),
              ),
            ],
          ),
          if (campaign.metaCampaignId != null) ...<Widget>[
            const SizedBox(height: NoboSpace.sm),
            Text(
              'Meta ID ${campaign.metaCampaignId}',
              style: NoboType.caption.copyWith(
                color: c.inkTertiary,
                fontSize: 10.5,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: NoboSpace.md),
          Divider(height: 1, color: c.hairline),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Optimise in the web app',
                  style: NoboType.caption.copyWith(
                    color: c.primary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Icon(
                Icons.open_in_new_rounded,
                size: 13,
                color: c.primary,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 13, color: c.inkTertiary),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            label,
            style: NoboType.caption.copyWith(
              color: c.inkSecondary,
              fontSize: 11.5,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
