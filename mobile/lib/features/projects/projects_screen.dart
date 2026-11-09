import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/feedback.dart';
import '../../core/ui/media.dart';
import '../../core/ui/refresh.dart';
import '../../core/ui/surfaces.dart';
import '../../data/workspace_source.dart';

/// Projects — "properties" in the backend schema.
///
/// Real estate creative work is visual, so this is a media-led list rather than
/// a table: one large hero per project, with the numbers that matter underneath.
class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});

  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<ProjectSeed>> projects = ref.watch(projectsProvider);
    final List<ProjectSeed> all = projects.value ?? const <ProjectSeed>[];
    final List<ProjectSeed> filtered = _query.isEmpty
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

    return Scaffold(
      backgroundColor: context.nobo.canvas,
      body: SafeArea(
        bottom: false,
        child: NoboRefreshScroll(
          onRefresh: () async {
            ref.invalidate(projectsProvider);
            await ref
                .read(projectsProvider.future)
                .catchError((Object _) => const <ProjectSeed>[]);
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
                  children: <Widget>[
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            'Projects',
                            style: NoboType.title.copyWith(
                              color: context.nobo.ink,
                            ),
                          ),
                          if (all.isNotEmpty)
                            Text(
                              '${all.length} active',
                              style: NoboType.caption.copyWith(
                                color: context.nobo.inkTertiary,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.base,
                  NoboSpace.gutter,
                  0,
                ),
                child: _SearchField(
                  value: _query,
                  onChanged: (String v) => setState(() => _query = v),
                ),
              ),
            ),
            if (projects.isLoading)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
                  child: Column(
                    children: <Widget>[
                      SizedBox(height: NoboSpace.base),
                      NoboSkeleton(height: 190, radius: NoboRadius.lg),
                      SizedBox(height: NoboSpace.base),
                      NoboSkeleton(height: 190, radius: NoboRadius.lg),
                    ],
                  ),
                ),
              )
            else if (projects.hasError)
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 320,
                  child: NoboErrorState(
                    error: projects.error!,
                    onRetry: () => ref.invalidate(projectsProvider),
                  ),
                ),
              )
            else if (filtered.isEmpty)
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 360,
                  child: NoboEmptyState(
                    title: _query.isEmpty
                        ? 'No projects yet'
                        : 'Nothing matches "$_query"',
                    message: _query.isEmpty
                        ? 'Projects are the things you market — a property, a '
                              'building, a campaign. Nobogent keeps every asset '
                              'and task attached to one.'
                        : 'Try a different name or location.',
                    icon: Icons.workspaces_outline,
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                sliver: SliverList.separated(
                  itemCount: filtered.length,
                  separatorBuilder: (_, _) =>
                      const SizedBox(height: NoboSpace.base),
                  itemBuilder: (BuildContext context, int i) =>
                      _ProjectCard(project: filtered[i]),
                ),
              ),
          ],
        ),
      ),
    );
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
                hintText: 'Search projects',
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

class _ProjectCard extends StatelessWidget {
  const _ProjectCard({required this.project});

  final ProjectSeed project;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    return NoboCard(
      padding: EdgeInsets.zero,
      onTap: () => context.push(Routes.project(project.id)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Stack(
            children: <Widget>[
              AspectRatio(
                aspectRatio: 16 / 9,
                child: project.cover == null
                    ? ColoredBox(color: c.surfaceSunken)
                    : NoboMediaTile(
                        source: project.cover,
                        aspectRatio: 16 / 9,
                        radius: 0,
                      ),
              ),
              Positioned(
                left: NoboSpace.md,
                bottom: NoboSpace.md,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.52),
                    borderRadius: NoboRadius.rPill,
                  ),
                  child: Text(
                    project.price,
                    style: NoboType.micro.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.2,
                      fontSize: 11,
                    ),
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.all(NoboSpace.base),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  project.title,
                  style: NoboType.subtitle.copyWith(color: c.ink),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (project.address != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(
                    project.address!,
                    style: NoboType.caption.copyWith(color: c.inkSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: NoboSpace.md),
                Row(
                  children: <Widget>[
                    _Stat(
                      icon: Icons.photo_library_outlined,
                      value: '${project.assetCount}',
                      label: 'assets',
                    ),
                    const SizedBox(width: NoboSpace.base),
                    _Stat(
                      icon: Icons.auto_awesome_outlined,
                      value: '${project.taskCount}',
                      label: 'tasks',
                    ),
                    const Spacer(),
                    Icon(
                      Icons.chevron_right_rounded,
                      size: 20,
                      color: c.inkTertiary,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.icon, required this.value, required this.label});

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Row(
      children: <Widget>[
        Icon(icon, size: 13, color: c.inkTertiary),
        const SizedBox(width: 4),
        Text(
          value,
          style: NoboType.label.copyWith(color: c.ink, fontSize: 12.5),
        ),
        const SizedBox(width: 3),
        Text(
          label,
          style: NoboType.caption.copyWith(
            color: c.inkTertiary,
            fontSize: 11.5,
          ),
        ),
      ],
    );
  }
}
