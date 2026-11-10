import 'dart:async';

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
import '../../core/ui/nobo_mark_loader.dart';
import '../../core/ui/orbit_mark.dart';
import '../../core/ui/refresh.dart';
import '../../core/ui/surfaces.dart';
import '../../core/utils/format.dart';
import '../../data/models/agent.dart';
import '../../data/models/profile.dart';
import '../../data/workspace_source.dart';

/// The AI command center: describe the outcome, Nobogent does the work.
///
/// This is the hub — a composer, fast paths into the most common generation
/// jobs, and the list of independent task sessions, each keeping its own
/// conversation and execution context.
class CreateScreen extends ConsumerStatefulWidget {
  const CreateScreen({this.initialPrompt, super.key});

  final String? initialPrompt;

  @override
  ConsumerState<CreateScreen> createState() => _CreateScreenState();
}

class _CreateScreenState extends ConsumerState<CreateScreen> {
  final TextEditingController _input = TextEditingController();
  final FocusNode _focus = FocusNode();
  String? _projectId;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    final String? p = widget.initialPrompt;
    if (p != null && p.isNotEmpty) {
      _input.text = p;
    }
  }

  @override
  void dispose() {
    _input.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _start(String prompt, {String? projectId, String? title}) async {
    final String text = prompt.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);

    final SessionsController ctl = ref.read(sessionsProvider.notifier);
    final AgentSession created = await ctl.create(projectId: projectId);

    if (!mounted) return;
    _input.clear();
    setState(() => _sending = false);
    unawaited(
      context.push(
        '${Routes.session(created.id)}?prompt=${Uri.encodeComponent(text)}'
        '${title == null ? '' : '&title=${Uri.encodeComponent(title)}'}',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AgentSession>> sessions = ref.watch(sessionsProvider);
    final List<AgentSession> all = sessions.value ?? const <AgentSession>[];
    final AsyncValue<List<ProjectSeed>> projects = ref.watch(projectsProvider);
    final AsyncValue<NoboProfile?> account = ref.watch(accountProvider);
    final bool canUseAgent = account.value?.canUseAgent ?? false;

    return Scaffold(
      backgroundColor: context.nobo.canvas,
      body: SafeArea(
        bottom: false,
        child: NoboRefreshScroll(
          onRefresh: () async {
            ref.invalidate(sessionsProvider);
            ref.invalidate(projectsProvider);
            await ref.read(sessionsProvider.future);
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
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            'Create',
                            style: NoboType.title.copyWith(
                              color: context.nobo.ink,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: NoboSpace.md),
                    _Composer(
                      controller: _input,
                      focusNode: _focus,
                      projects: projects.value ?? const <ProjectSeed>[],
                      projectId: _projectId,
                      onProject: (String? id) =>
                          setState(() => _projectId = id),
                      onSend: () => _start(
                        _input.text,
                        projectId: _projectId,
                      ),
                      sending: _sending,
                      enabled: canUseAgent,
                    ),
                    if (!canUseAgent) ...<Widget>[
                      const SizedBox(height: NoboSpace.md),
                      _AgentRestrictedNotice(
                        role: account.value?.role ?? 'client',
                      ),
                    ],
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.xl,
                  NoboSpace.gutter,
                  0,
                ),
                child: _FastPaths(
                  enabled: canUseAgent,
                  onPick: (String prompt, String title) =>
                      _start(prompt, title: title),
                ),
              ),
            ),
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                child: NoboSectionHeader(
                  eyebrow: 'Sessions',
                  title: 'Your tasks',
                  padding: EdgeInsets.only(
                    top: NoboSpace.xl,
                    bottom: NoboSpace.md,
                  ),
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              sliver: SliverList.separated(
                itemCount: all.length,
                separatorBuilder: (_, _) => const SizedBox(height: NoboSpace.sm),
                itemBuilder: (BuildContext context, int i) =>
                    _SessionCard(session: all[i]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.projects,
    required this.projectId,
    required this.onProject,
    required this.onSend,
    required this.sending,
    required this.enabled,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final List<ProjectSeed> projects;
  final String? projectId;
  final ValueChanged<String?> onProject;
  final VoidCallback onSend;
  final bool sending;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final ProjectSeed? selected = projects
        .where((ProjectSeed p) => p.id == projectId)
        .firstOrNull;

    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(NoboRadius.lg),
        border: Border.all(color: c.border),
        boxShadow: NoboElevation.low,
      ),
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const OrbitMark(size: 18, active: true),
              const SizedBox(width: NoboSpace.sm),
              Text(
                'BRIEF NOBOGENT',
                style: NoboType.micro.copyWith(color: c.inkTertiary),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          TextField(
            controller: controller,
            focusNode: focusNode,
            enabled: enabled,
            minLines: 2,
            maxLines: 6,
            textCapitalization: TextCapitalization.sentences,
            style: NoboType.body.copyWith(color: c.ink, fontSize: 15.5),
            cursorColor: c.primary,
            decoration: InputDecoration(
              filled: false,
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              isDense: true,
              contentPadding: EdgeInsets.zero,
              hintText:
                  'Create a 15 second video for our Diwali launch, '
                  'vertical, with a calm voiceover…',
              hintStyle: NoboType.body.copyWith(
                color: c.inkTertiary,
                fontSize: 15.5,
              ),
            ),
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              _ProjectChip(
                label: selected?.title ?? 'No project',
                active: selected != null,
                onTap: () => _pickProject(context),
              ),
              const Spacer(),
              NoboIconButton(
                icon: Icons.attach_file_rounded,
                tooltip: 'Attach a file',
                size: 38,
                onPressed: enabled ? () {} : null,
              ),
              const SizedBox(width: 4),
              SizedBox(
                width: 38,
                height: 38,
                child: Material(
                  color: enabled ? c.primary : c.surfaceSunken,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: enabled && !sending ? onSend : null,
                    child: Center(
                      child: sending
                          ? NoboMarkLoader(
                              size: 15,
                              color: c.onPrimary,
                              semanticLabel: 'Sending',
                            )
                          : Icon(
                              Icons.arrow_upward_rounded,
                              size: 19,
                              color: enabled ? c.onPrimary : c.inkTertiary,
                            ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _pickProject(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.nobo.surface,
      shape: const RoundedRectangleBorder(borderRadius: NoboRadius.rSheetTop),
      builder: (BuildContext ctx) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SizedBox(height: NoboSpace.base),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.gutter,
              ),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Which project is this for?',
                  style: NoboType.subtitle.copyWith(color: context.nobo.ink),
                ),
              ),
            ),
            const SizedBox(height: NoboSpace.sm),
            ListTile(
              leading: const Icon(Icons.remove_circle_outline, size: 20),
              title: const Text('No project'),
              onTap: () {
                onProject(null);
                Navigator.of(ctx).pop();
              },
            ),
            for (final ProjectSeed p in projects)
              ListTile(
                leading: const Icon(Icons.workspaces_outline, size: 20),
                title: Text(p.title),
                subtitle: Text(p.address ?? ''),
                onTap: () {
                  onProject(p.id);
                  Navigator.of(ctx).pop();
                },
              ),
            const SizedBox(height: NoboSpace.sm),
          ],
        ),
      ),
    );
  }
}

class _ProjectChip extends StatelessWidget {
  const _ProjectChip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: NoboSpace.md,
          vertical: 7,
        ),
        decoration: BoxDecoration(
          color: active ? c.primaryWash : c.surfaceSunken,
          borderRadius: NoboRadius.rPill,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              Icons.workspaces_outline,
              size: 13,
              color: active ? c.primary : c.inkSecondary,
            ),
            const SizedBox(width: 5),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 150),
              child: Text(
                label,
                style: NoboType.caption.copyWith(
                  color: active ? c.primary : c.inkSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 3),
            Icon(
              Icons.expand_more_rounded,
              size: 14,
              color: active ? c.primary : c.inkTertiary,
            ),
          ],
        ),
      ),
    );
  }
}

class _FastPaths extends StatelessWidget {
  const _FastPaths({required this.onPick, required this.enabled});

  final void Function(String prompt, String title) onPick;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final List<({IconData icon, String title, String subtitle, String prompt})>
    items =
        <({IconData icon, String title, String subtitle, String prompt})>[
          (
            icon: Icons.movie_creation_outlined,
            title: 'Video',
            subtitle: '15–30s vertical film',
            prompt:
                'Create a 15 second vertical video for our latest project launch.',
          ),
          (
            icon: Icons.photo_library_outlined,
            title: 'Creatives',
            subtitle: 'Image set for ads',
            prompt:
                'Generate five Instagram creatives for our newest project.',
          ),
          (
            icon: Icons.campaign_outlined,
            title: 'Campaign',
            subtitle: 'Ads + audience',
            prompt:
                'Build and launch a lead campaign for our current offer.',
          ),
          (
            icon: Icons.chat_bubble_outline_rounded,
            title: 'Message',
            subtitle: 'WhatsApp follow-ups',
            prompt:
                'Write WhatsApp follow-up messages for the leads who went cold.',
          ),
        ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          'START SOMETHING',
          style: NoboType.micro.copyWith(color: context.nobo.inkTertiary),
        ),
        const SizedBox(height: NoboSpace.md),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: items.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: NoboSpace.sm,
            crossAxisSpacing: NoboSpace.sm,
            // Fixed extent rather than an aspect ratio: rows are immune to text
            // scaling, so a large Dynamic Type setting cannot overflow the card.
            mainAxisExtent: 74,
          ),
          itemBuilder: (BuildContext context, int index) {
            final (
              :IconData icon,
              :String title,
              :String subtitle,
              :String prompt,
            ) = items[index];
            return NoboCard(
              onTap: enabled ? () => onPick(prompt, title) : null,
              padding: const EdgeInsets.symmetric(
                horizontal: NoboSpace.md,
                vertical: NoboSpace.sm,
              ),
              child: Row(
                children: <Widget>[
                  Icon(
                    icon,
                    size: 18,
                    color: enabled
                        ? context.nobo.primary
                        : context.nobo.inkTertiary,
                  ),
                  const SizedBox(width: NoboSpace.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          title,
                          style: NoboType.bodyStrong.copyWith(
                            color: context.nobo.ink,
                            fontSize: 14.5,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          subtitle,
                          style: NoboType.caption.copyWith(
                            color: context.nobo.inkTertiary,
                            fontSize: 11.5,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

/// Explains the agent's current role restriction honestly instead of failing
/// with a raw 403 the moment the owner types something.
class _AgentRestrictedNotice extends StatelessWidget {
  const _AgentRestrictedNotice({required this.role});

  final String role;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      padding: const EdgeInsets.all(NoboSpace.md),
      decoration: BoxDecoration(
        color: c.cautionWash.withValues(alpha: 0.6),
        borderRadius: NoboRadius.rSm,
        border: Border.all(color: c.caution.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.info_outline_rounded, size: 16, color: c.caution),
          const SizedBox(width: NoboSpace.sm),
          Expanded(
            child: Text(
              'Nobogent AI is currently limited to workspace owners. Your '
              'account role is "$role", so the composer is read-only. '
              'Everything else in the app works normally.',
              style: NoboType.caption.copyWith(color: c.inkSecondary),
            ),
          ),
        ],
      ),
    );
  }
}

class _SessionCard extends StatelessWidget {
  const _SessionCard({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final int artifacts = session.allArtifacts.length;

    return NoboCard(
      onTap: () => context.push(Routes.session(session.id)),
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  session.title,
                  style: NoboType.bodyStrong.copyWith(color: c.ink),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: NoboSpace.sm),
              AgentStatusPill(state: session.state),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            session.preview,
            style: NoboType.caption.copyWith(color: c.inkSecondary),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: NoboSpace.md),
          Row(
            children: <Widget>[
              if (session.projectTitle != null) ...<Widget>[
                Icon(
                  Icons.workspaces_outline,
                  size: 11,
                  color: c.inkTertiary,
                ),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    session.projectTitle!,
                    style: NoboType.caption.copyWith(
                      color: c.inkTertiary,
                      fontSize: 11,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: NoboSpace.sm),
              ],
              if (artifacts > 0) ...<Widget>[
                Icon(Icons.photo_library_outlined, size: 11, color: c.inkTertiary),
                const SizedBox(width: 4),
                Text(
                  '$artifacts',
                  style: NoboType.caption.copyWith(
                    color: c.inkTertiary,
                    fontSize: 11,
                  ),
                ),
                const SizedBox(width: NoboSpace.sm),
              ],
              const Spacer(),
              Text(
                timeAgo(session.updatedAt),
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
}