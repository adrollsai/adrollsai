import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/agent_widgets.dart';
import '../../core/ui/controls.dart';
import '../../core/ui/feedback.dart';
import '../../core/ui/media.dart';
import '../../core/ui/surfaces.dart';
import '../../core/utils/format.dart';
import '../../data/models/agent.dart';
import '../../data/workspace_source.dart';

/// A single project: overview, assets, and the tasks working on it.
class ProjectScreen extends ConsumerWidget {
  const ProjectScreen({required this.projectId, super.key});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<ProjectSeed>> projects = ref.watch(projectsProvider);
    final AsyncValue<List<AssetSeed>> assets = ref.watch(
      assetsForProjectProvider(projectId),
    );
    final List<AgentSession> sessions =
        (ref.watch(sessionsProvider).value ?? const <AgentSession>[])
            .where((AgentSession s) => s.projectId == projectId)
            .toList(growable: false);

    final ProjectSeed? project = (projects.value ?? const <ProjectSeed>[])
        .where((ProjectSeed p) => p.id == projectId)
        .firstOrNull;

    final NoboColors c = context.nobo;

    if (projects.isLoading) {
      return Scaffold(
        backgroundColor: c.canvas,
        appBar: AppBar(),
        body: const NoboLoading(),
      );
    }

    if (project == null) {
      return Scaffold(
        backgroundColor: c.canvas,
        appBar: AppBar(),
        body: NoboEmptyState(
          title: 'Project not found',
          message: 'This project may have been removed.',
          icon: Icons.workspaces_outline,
          actionLabel: 'Back',
          onAction: () => context.pop(),
        ),
      );
    }

    final List<AssetSeed> projectAssets =
        assets.value ?? const <AssetSeed>[];

    return Scaffold(
      backgroundColor: c.canvas,
      body: CustomScrollView(
        slivers: <Widget>[
          SliverAppBar(
            pinned: true,
            expandedHeight: 248,
            backgroundColor: c.canvas,
            surfaceTintColor: Colors.transparent,
            leading: Padding(
              padding: const EdgeInsets.all(8),
              child: _CircleButton(
                icon: Icons.arrow_back_rounded,
                onTap: () => context.pop(),
              ),
            ),
            flexibleSpace: FlexibleSpaceBar(
              background: Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  if (project.cover != null)
                    NoboMediaTile(
                      source: project.cover,
                      aspectRatio: 4 / 3,
                      radius: 0,
                    )
                  else
                    ColoredBox(color: c.surfaceSunken),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: <Color>[
                          Colors.black.withValues(alpha: 0.28),
                          Colors.transparent,
                          Colors.black.withValues(alpha: 0.55),
                        ],
                        stops: const <double>[0, 0.45, 1],
                      ),
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
                NoboSpace.lg,
                NoboSpace.gutter,
                0,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              project.title,
                              style: NoboType.title.copyWith(color: c.ink),
                            ),
                            if (project.address != null) ...<Widget>[
                              const SizedBox(height: 3),
                              Text(
                                project.address!,
                                style: NoboType.body.copyWith(
                                  color: c.inkSecondary,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(width: NoboSpace.md),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Text(
                            project.price,
                            style: NoboType.numeric(
                              NoboType.headline.copyWith(
                                color: c.ink,
                                fontSize: 19,
                              ),
                            ),
                          ),
                          if (project.type != null)
                            Text(
                              project.type!,
                              style: NoboType.caption.copyWith(
                                color: c.inkTertiary,
                                fontSize: 11,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                  if (project.description != null) ...<Widget>[
                    const SizedBox(height: NoboSpace.base),
                    Text(
                      project.description!,
                      style: NoboType.body.copyWith(
                        color: c.inkSecondary,
                        height: 1.55,
                      ),
                    ),
                  ],
                  const SizedBox(height: NoboSpace.lg),
                  NoboButton(
                    label: 'Ask Nobogent about this project',
                    icon: Icons.auto_awesome,
                    expand: true,
                    onPressed: () => context.go(Routes.create),
                  ),
                ],
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              child: NoboSectionHeader(
                eyebrow: 'Generated',
                title: 'Assets',
                action: '${projectAssets.length}',
              ),
            ),
          ),
          if (projectAssets.isEmpty)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
                child: NoboCard(
                  child: Text(
                    'No assets for this project yet. Ask Nobogent to create a '
                    'video or a creative set and they will appear here.',
                  ),
                ),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              sliver: SliverGrid.builder(
                gridDelegate:
                    const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: NoboSpace.sm,
                      crossAxisSpacing: NoboSpace.sm,
                      childAspectRatio: 0.92,
                    ),
                itemCount: projectAssets.length,
                itemBuilder: (BuildContext context, int i) {
                  final AssetSeed a = projectAssets[i];
                  return NoboMediaTile(
                    source: a.preview,
                    isVideo: a.isVideo,
                    durationSeconds: a.durationSeconds,
                    aspectRatio: 0.92,
                    onTap: a.preview == null
                        ? null
                        : () => context.push(
                            '${Routes.media}?src='
                            '${Uri.encodeComponent(a.playable ?? a.preview!)}'
                            '&video=${a.isVideo ? 1 : 0}',
                          ),
                  );
                },
              ),
            ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              child: NoboSectionHeader(
                eyebrow: 'Activity',
                title: 'Tasks on this project',
                action: '${sessions.length}',
              ),
            ),
          ),
          if (sessions.isEmpty)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                child: Text(
                  'No tasks have been run for this project yet.',
                  style: NoboType.caption.copyWith(color: c.inkTertiary),
                ),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              sliver: SliverList.separated(
                itemCount: sessions.length,
                separatorBuilder: (_, _) => const SizedBox(height: NoboSpace.sm),
                itemBuilder: (BuildContext context, int i) {
                  final AgentSession s = sessions[i];
                  return NoboCard(
                    onTap: () => context.push(Routes.session(s.id)),
                    padding: const EdgeInsets.all(NoboSpace.base),
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                s.title,
                                style: NoboType.bodyStrong.copyWith(
                                  color: c.ink,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                timeAgo(s.updatedAt),
                                style: NoboType.caption.copyWith(
                                  color: c.inkTertiary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        AgentStatusPill(state: s.state),
                      ],
                    ),
                  );
                },
              ),
            ),
          const SliverToBoxAdapter(
            child: SizedBox(height: NoboSpace.xxl),
          ),
        ],
      ),
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.42),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, size: 19, color: Colors.white),
      ),
    );
  }
}
