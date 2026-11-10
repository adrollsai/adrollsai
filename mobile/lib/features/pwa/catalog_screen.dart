import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/navigation.dart';
import '../../data/workspace_source.dart';
import 'pwa_widgets.dart';

/// Catalog — the web app's "Products & Services" screen.
///
/// Reproduces the web layout: header with a refresh circle, a search field with
/// a "Tags Only" toggle inside it, a blue "+ Add Product" primary action beside
/// an overflow circle, then one card per product showing its cover, name, two
/// quick actions (AI / WhatsApp), the description and its automation switches.
class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  String _query = '';
  bool _tagsOnly = false;

  Future<void> _refresh() async {
    ref.invalidate(projectsProvider);
    await ref
        .read(projectsProvider.future)
        .catchError((Object _) => const <ProjectSeed>[]);
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<ProjectSeed>> projects = ref.watch(projectsProvider);
    final List<ProjectSeed> all = projects.value ?? const <ProjectSeed>[];
    final List<ProjectSeed> items = _query.isEmpty
        ? all
        : all
              .where(
                (ProjectSeed p) =>
                    p.title.toLowerCase().contains(_query.toLowerCase()) ||
                    (p.address ?? '').toLowerCase().contains(
                      _query.toLowerCase(),
                    ),
              )
              .toList(growable: false);

    return RefreshIndicator(
      onRefresh: _refresh,
      color: c.primary,
      backgroundColor: c.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: <Widget>[
          NoboPageHeader(
            title: 'Products & Services',
            subtitle: 'Manage your catalog and assets.',
            actions: <Widget>[
              NoboCircleAction(
                icon: Icons.refresh_rounded,
                onTap: _refresh,
                tooltip: 'Refresh',
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: Column(
              children: <Widget>[
                PwaSearchField(
                  hint: 'Search products, locations, tags…',
                  onChanged: (String v) => setState(() => _query = v),
                  trailing: GestureDetector(
                    onTap: () => setState(() => _tagsOnly = !_tagsOnly),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: _tagsOnly ? c.navy : c.surfaceSunken,
                        borderRadius: NoboRadius.rPill,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Icon(
                            Icons.sell_outlined,
                            size: 13,
                            color: _tagsOnly ? c.onNavy : c.inkSecondary,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            'Tags Only',
                            style: NoboType.caption.copyWith(
                              color: _tagsOnly ? c.onNavy : c.inkSecondary,
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: NoboSpace.md),
                Row(
                  children: <Widget>[
                    PwaIconCircle(
                      icon: Icons.more_horiz_rounded,
                      size: 48,
                      filled: false,
                      onTap: () {},
                      tint: c.inkSecondary,
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: PwaPrimaryButton(
                        label: 'Add Product',
                        icon: Icons.add_rounded,
                        onPressed: () {},
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (projects.isLoading)
            const Padding(
              padding: EdgeInsets.only(top: NoboSpace.huge),
              child: SizedBox(height: 200, child: PwaLoading()),
            )
          else if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NoboSpace.gutter,
                NoboSpace.xxl,
                NoboSpace.gutter,
                NoboSpace.huge,
              ),
              child: PwaCard(
                child: Column(
                  children: <Widget>[
                    Icon(
                      Icons.inventory_2_outlined,
                      size: 30,
                      color: c.inkTertiary,
                    ),
                    const SizedBox(height: NoboSpace.md),
                    Text(
                      _query.isEmpty ? 'No products yet' : 'No matches',
                      style: NoboType.subtitle.copyWith(color: c.ink),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _query.isEmpty
                          ? 'Add a product to start generating creatives and campaigns for it.'
                          : 'Try a different name or location.',
                      textAlign: TextAlign.center,
                      style: NoboType.caption.copyWith(color: c.inkSecondary),
                    ),
                  ],
                ),
              ),
            )
          else
            for (final ProjectSeed p in items)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.base,
                  NoboSpace.gutter,
                  0,
                ),
                child: _ProductCard(project: p),
              ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }
}

class _ProductCard extends StatefulWidget {
  const _ProductCard({required this.project});

  final ProjectSeed project;

  @override
  State<_ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<_ProductCard> {
  bool _autoGen = false;
  bool _onLandingPage = false;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final ProjectSeed p = widget.project;

    return PwaCard(
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: c.surface,
                  borderRadius: NoboRadius.rPill,
                  border: Border.all(color: c.border),
                ),
                child: Text(
                  'Active',
                  style: NoboType.caption.copyWith(
                    color: c.inkSecondary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const Spacer(),
              PwaIconCircle(
                icon: Icons.edit_outlined,
                tint: c.inkSecondary,
                filled: false,
                onTap: () {},
                tooltip: 'Edit',
              ),
              const SizedBox(width: NoboSpace.sm),
              PwaIconCircle(
                icon: Icons.delete_outline_rounded,
                tint: c.inkSecondary,
                filled: false,
                onTap: () {},
                tooltip: 'Delete',
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          if (p.cover != null)
            ClipRRect(
              borderRadius: NoboRadius.rMd,
              child: AspectRatio(
                aspectRatio: 16 / 10,
                child: Image.asset(
                  'assets/brand/nobogent-logo.png',
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  p.title,
                  style: NoboType.subtitle.copyWith(
                    color: c.ink,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              PwaIconCircle(
                icon: Icons.auto_awesome,
                tint: c.accent,
                onTap: () {},
                tooltip: 'Generate with AI',
              ),
              const SizedBox(width: NoboSpace.sm),
              PwaIconCircle(
                icon: Icons.chat_bubble_rounded,
                tint: c.positive,
                onTap: () {},
                tooltip: 'WhatsApp',
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          Text(
            p.description ?? '# ${p.title}',
            style: NoboType.body.copyWith(
              color: c.inkSecondary,
              fontSize: 14,
              height: 1.45,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: NoboSpace.md),
          Divider(height: 1, color: c.hairline),
          PwaToggleRow(
            label: 'Auto-gen daily',
            icon: Icons.auto_awesome_outlined,
            value: _autoGen,
            onChanged: (bool v) => setState(() => _autoGen = v),
          ),
          PwaToggleRow(
            label: 'On landing page',
            icon: Icons.grid_view_outlined,
            value: _onLandingPage,
            onChanged: (bool v) => setState(() => _onLandingPage = v),
          ),
        ],
      ),
    );
  }
}
