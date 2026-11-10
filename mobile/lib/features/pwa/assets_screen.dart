import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/media.dart';
import '../../core/ui/navigation.dart';
import '../../data/models/profile.dart';
import '../../data/workspace_source.dart';
import 'pwa_widgets.dart';

/// Asset Library — the web app's "Asset Library" screen.
class AssetsScreen extends ConsumerStatefulWidget {
  const AssetsScreen({super.key});

  @override
  ConsumerState<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends ConsumerState<AssetsScreen> {
  int _filter = 0;
  static const List<String> _filters = <String>[
    'All',
    'Images',
    'Videos',
    'Campaign Ready',
  ];

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<AssetSeed>> async = ref.watch(assetsProvider);
    final List<AssetSeed> all = async.value ?? const <AssetSeed>[];
    final List<AssetSeed> items = switch (_filter) {
      1 => all.where((AssetSeed a) => !a.isVideo).toList(growable: false),
      2 => all.where((AssetSeed a) => a.isVideo).toList(growable: false),
      _ => all,
    };

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(assetsProvider);
        await ref
            .read(assetsProvider.future)
            .catchError((Object _) => const <AssetSeed>[]);
      },
      color: c.primary,
      backgroundColor: c.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: <Widget>[
          NoboPageHeader(
            title: 'Asset Library',
            subtitle: 'Manage and distribute your marketing creatives',
            actions: <Widget>[
              NoboCircleAction(
                icon: Icons.refresh_rounded,
                onTap: () => ref.invalidate(assetsProvider),
                tooltip: 'Refresh',
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                PwaPrimaryButton(
                  label: 'Upload Assets',
                  icon: Icons.upload_rounded,
                  dark: true,
                  onPressed: () {},
                ),
                const SizedBox(height: NoboSpace.sm),
                PwaCard(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  onTap: () => ref.invalidate(assetsProvider),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      Icon(Icons.sync_rounded, size: 17, color: c.inkSecondary),
                      const SizedBox(width: NoboSpace.sm),
                      Text(
                        'Refresh',
                        style: NoboType.label.copyWith(
                          color: c.ink,
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: NoboSpace.base),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.md,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: NoboRadius.rPill,
                    border: Border.all(color: c.border),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(
                        Icons.photo_library_outlined,
                        size: 15,
                        color: c.primary,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${all.length} Total Assets',
                        style: NoboType.label.copyWith(
                          color: c.ink,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: NoboSpace.base),
                PwaCard(
                  child: Column(
                    children: <Widget>[
                      PwaSelect(
                        label: 'All Products',
                        icon: Icons.inventory_2_outlined,
                        onTap: () {},
                      ),
                      const SizedBox(height: NoboSpace.md),
                      SizedBox(
                        height: 40,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          padding: EdgeInsets.zero,
                          itemCount: _filters.length,
                          separatorBuilder: (_, _) =>
                              const SizedBox(width: 6),
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
              ],
            ),
          ),
          if (async.isLoading)
            const Padding(
              padding: EdgeInsets.only(top: NoboSpace.huge),
              child: SizedBox(height: 180, child: PwaLoading(label: 'Loading gallery…')),
            )
          else if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.all(NoboSpace.xxl),
              child: Column(
                children: <Widget>[
                  Icon(Icons.photo_outlined, size: 30, color: c.inkTertiary),
                  const SizedBox(height: NoboSpace.md),
                  Text(
                    'No assets in this filter',
                    style: NoboType.subtitle.copyWith(color: c.ink),
                  ),
                ],
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NoboSpace.gutter,
                NoboSpace.base,
                NoboSpace.gutter,
                0,
              ),
              child: GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: items.length > 24 ? 24 : items.length,
                gridDelegate:
                    const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 3,
                      mainAxisSpacing: 6,
                      crossAxisSpacing: 6,
                      childAspectRatio: 0.86,
                    ),
                itemBuilder: (BuildContext context, int i) {
                  final AssetSeed a = items[i];
                  return NoboMediaTile(
                    source: a.preview,
                    isVideo: a.isVideo,
                    durationSeconds: a.durationSeconds,
                    aspectRatio: 0.86,
                    radius: NoboRadius.md,
                  );
                },
              ),
            ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }
}

/// Profile — account, workspace and the web app's settings entry points.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final NoboProfile? profile = ref.watch(accountProvider).value;

    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        const NoboPageHeader(title: 'Profile', subtitle: 'Your workspace and account'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
          child: Column(
            children: <Widget>[
              PwaCard(
                child: Row(
                  children: <Widget>[
                    NoboAvatar(
                      name: profile?.displayName ?? 'Nobogent',
                      imageUrl: profile?.logoUrl,
                      size: 52,
                    ),
                    const SizedBox(width: NoboSpace.base),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            profile?.workspaceName ?? 'Workspace',
                            style: NoboType.subtitle.copyWith(
                              color: c.ink,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            profile?.email ?? '',
                            style: NoboType.caption.copyWith(
                              color: c.inkSecondary,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: NoboSpace.sm),
                          Text(
                            '${profile?.credits.toStringAsFixed(1) ?? '0'} credits · ${profile?.role ?? ''}',
                            style: NoboType.caption.copyWith(
                              color: c.inkTertiary,
                              fontSize: 11.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: NoboSpace.base),
              PwaCard(
                padding: EdgeInsets.zero,
                child: Column(
                  children: <Widget>[
                    const _Row(
                      icon: Icons.business_outlined,
                      label: 'Business information',
                    ),
                    const _Row(icon: Icons.palette_outlined, label: 'Branding'),
                    const _Row(icon: Icons.extension_outlined, label: 'Plugins & integrations'),
                    const _Row(
                      icon: Icons.notifications_none_rounded,
                      label: 'Notification preferences',
                    ),
                    const _Row(
                      icon: Icons.credit_card_outlined,
                      label: 'Billing & subscription',
                    ),
                    _Row(
                      icon: Icons.logout_rounded,
                      label: 'Sign out',
                      danger: true,
                      last: true,
                      onTap: () async {
                        await ref.read(accountProvider.notifier).signOut();
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: NoboSpace.xxl),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.label,
    this.onTap,
    this.danger = false,
    this.last = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool danger;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final Color tone = danger ? c.danger : c.ink;
    return Column(
      children: <Widget>[
        InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: NoboSpace.base,
              vertical: 15,
            ),
            child: Row(
              children: <Widget>[
                Icon(icon, size: 18, color: danger ? c.danger : c.inkTertiary),
                const SizedBox(width: NoboSpace.md),
                Expanded(
                  child: Text(
                    label,
                    style: NoboType.body.copyWith(color: tone, fontSize: 14.5),
                  ),
                ),
                if (!danger)
                  Icon(
                    Icons.chevron_right_rounded,
                    size: 18,
                    color: c.inkTertiary,
                  ),
              ],
            ),
          ),
        ),
        if (!last) Divider(height: 1, indent: 50, color: c.hairline),
      ],
    );
  }
}

/// A web-app section that has not been ported to native yet.
///
/// Rather than fake functionality, this states plainly what the section is and
/// links out to the full tool in the web app. Every one of these exists in the
/// PWA with the same title and subtitle.
class WebToolScreen extends StatelessWidget {
  const WebToolScreen({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.body,
    super.key,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final String body;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        NoboPageHeader(title: title, subtitle: subtitle),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
          child: PwaCard(
            child: Column(
              children: <Widget>[
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: c.primaryWash,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, size: 24, color: c.primary),
                ),
                const SizedBox(height: NoboSpace.base),
                Text(
                  '$title lives in the web app',
                  textAlign: TextAlign.center,
                  style: NoboType.subtitle.copyWith(color: c.ink),
                ),
                const SizedBox(height: 6),
                Text(
                  body,
                  textAlign: TextAlign.center,
                  style: NoboType.caption.copyWith(
                    color: c.inkSecondary,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: NoboSpace.xxl),
      ],
    );
  }
}