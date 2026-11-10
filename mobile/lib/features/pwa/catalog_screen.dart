import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../core/ui/navigation.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/workspace_source.dart';
import 'product_form_sheet.dart';
import 'pwa_widgets.dart';

/// Catalog — the web app's "Products & Services" screen.
///
/// Fully interactive: adding, editing and deleting a product writes to the
/// `properties` table, and the automation switches persist. Generate and
/// WhatsApp shortcuts route into the matching destination instead of being dead
/// affordances.
class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  String _query = '';
  bool _tagsOnly = false;
  bool _busy = false;

  Future<void> _refresh() async {
    ref.invalidate(projectsProvider);
    await ref
        .read(projectsProvider.future)
        .catchError((Object _) => const <ProjectSeed>[]);
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  Future<void> _addProduct() async {
    final bool? saved = await showProductFormSheet(context: context);
    if (saved == true) {
      await _refresh();
      _toast('Product added.');
    }
  }

  Future<void> _editProduct(ProjectSeed project) async {
    final bool? saved = await showProductFormSheet(
      context: context,
      existing: project,
    );
    if (saved == true) {
      await _refresh();
      _toast('Product updated.');
    }
  }

  Future<void> _deleteProduct(ProjectSeed project) async {
    final bool ok = await showNoboConfirm(
      context: context,
      title: 'Delete product?',
      message:
          '“${project.title}” will be removed from your catalog. Creatives and '
          'campaigns already generated for it are kept.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await ref.read(workspaceRepositoryProvider).deleteProject(project.id);
      await _refresh();
      _toast('Product deleted.');
    } on NoboFailure catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setFlags(
    ProjectSeed project, {
    bool? autoGenerate,
    bool? onLandingPage,
  }) async {
    try {
      await ref
          .read(workspaceRepositoryProvider)
          .setProjectFlags(
            project.id,
            autoGenerate: autoGenerate,
            showOnLandingPage: onLandingPage,
          );
      await _refresh();
    } on NoboFailure catch (e) {
      _toast(e.message);
    }
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
                  hint: 'Search products, locations, tagsâ€¦',
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
                      icon: Icons.people_outline_rounded,
                      size: 48,
                      filled: false,
                      onTap: _refresh,
                      tooltip: 'Reload products',
                      tint: c.inkSecondary,
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: PwaPrimaryButton(
                        label: 'Add Product',
                        icon: Icons.add_rounded,
                        loading: _busy,
                        onPressed: _busy ? null : _addProduct,
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
                          ? 'Add your first product to start generating '
                                'creatives and campaigns for it.'
                          : 'Try a different name or location.',
                      textAlign: TextAlign.center,
                      style: NoboType.caption.copyWith(color: c.inkSecondary),
                    ),
                    if (_query.isEmpty) ...<Widget>[
                      const SizedBox(height: NoboSpace.base),
                      PwaPrimaryButton(
                        label: 'Add Product',
                        icon: Icons.add_rounded,
                        onPressed: _addProduct,
                      ),
                    ],
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
                child: _ProductCard(
                  project: p,
                  onEdit: () => _editProduct(p),
                  onDelete: () => _deleteProduct(p),
                  onToggleAuto: (bool v) => _setFlags(p, autoGenerate: v),
                  onToggleLanding: (bool v) =>
                      _setFlags(p, onLandingPage: v),
                  onGenerate: () => context.go(Routes.creation),
                  onWhatsApp: () => context.go(Routes.whatsapp),
                ),
              ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({
    required this.project,
    required this.onEdit,
    required this.onDelete,
    required this.onToggleAuto,
    required this.onToggleLanding,
    required this.onGenerate,
    required this.onWhatsApp,
  });

  final ProjectSeed project;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final ValueChanged<bool> onToggleAuto;
  final ValueChanged<bool> onToggleLanding;
  final VoidCallback onGenerate;
  final VoidCallback onWhatsApp;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final ProjectSeed p = project;

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
                  (p.status.isEmpty ? 'active' : p.status),
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
                onTap: onEdit,
                tooltip: 'Edit product',
              ),
              const SizedBox(width: NoboSpace.sm),
              PwaIconCircle(
                icon: Icons.delete_outline_rounded,
                tint: c.inkSecondary,
                filled: false,
                onTap: onDelete,
                tooltip: 'Delete product',
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          // Cover art is contained on a neutral plate so logos are never cropped
          // mid-wordmark. A product with no art simply has no media block.
          if (p.cover != null)
            ClipRRect(
              borderRadius: NoboRadius.rMd,
              child: AspectRatio(
                aspectRatio: 16 / 10,
                child: ColoredBox(
                  color: c.surfaceSunken,
                  child: Padding(
                    padding: const EdgeInsets.all(NoboSpace.md),
                    child: _cover(p.cover!),
                  ),
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
                onTap: onGenerate,
                tooltip: 'Generate creatives',
              ),
              const SizedBox(width: NoboSpace.sm),
              PwaIconCircle(
                icon: Icons.chat_bubble_rounded,
                tint: c.positive,
                onTap: onWhatsApp,
                tooltip: 'Open WhatsApp',
              ),
            ],
          ),
          if (p.address != null) ...<Widget>[
            const SizedBox(height: 2),
            Text(
              '${p.address!} · ${p.price}',
              style: NoboType.caption.copyWith(
                color: c.inkSecondary,
                fontSize: 12,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
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
            value: p.autoGenerate,
            onChanged: onToggleAuto,
          ),
          PwaToggleRow(
            label: 'On landing page',
            icon: Icons.grid_view_outlined,
            value: p.onLandingPage,
            onChanged: onToggleLanding,
          ),
        ],
      ),
    );
  }

  Widget _cover(String source) {
    if (source.startsWith('assets/')) {
      return Image.asset(
        source,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => const SizedBox.shrink(),
      );
    }
    return Image.network(
      source,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => const SizedBox.shrink(),
      loadingBuilder: (BuildContext context, Widget child, ImageChunkEvent? p) {
        if (p == null) return child;
        return const ColoredBox(color: Color(0xFFF1F5F9));
      },
    );
  }
}
