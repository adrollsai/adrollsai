import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/agent_widgets.dart';
import '../../core/ui/feedback.dart';
import '../../core/ui/media.dart';
import '../../core/ui/orbit_mark.dart';
import '../../core/ui/refresh.dart';
import '../../core/ui/surfaces.dart';
import '../../data/models/agent.dart';
import '../../data/models/profile.dart';
import '../../data/workspace_source.dart';
import '../../core/utils/format.dart';

/// The command center.
///
/// Structured around "what should I do next", not around metrics: one large
/// command entry, then anything genuinely blocking, then work in flight, then
/// recent output. Deliberately not a dashboard.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(projectsProvider);
    ref.invalidate(assetsProvider);
    ref.invalidate(leadsProvider);
    ref.invalidate(noticesProvider);
    ref.invalidate(sessionsProvider);
    await ref.read(projectsProvider.future).catchError(
      (Object _) => const <ProjectSeed>[],
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<NoboProfile?> account = ref.watch(accountProvider);
    final AsyncValue<List<AgentSession>> sessions = ref.watch(sessionsProvider);
    final AsyncValue<List<AssetSeed>> assets = ref.watch(assetsProvider);
    final AsyncValue<List<LeadSeed>> leads = ref.watch(leadsProvider);
    final List<AgentSession> allSessions =
        sessions.value ?? const <AgentSession>[];

    final List<AgentSession> needing = allSessions
        .where(
          (AgentSession s) =>
              s.state == SessionState.needsYou || s.pendingApprovals > 0,
        )
        .toList(growable: false);
    final List<AgentSession> working = allSessions
        .where((AgentSession s) => s.state == SessionState.working)
        .toList(growable: false);

    final String greeting = ref.watch(greetingProvider);
    final String name = account.value?.firstName ?? 'there';

    return Scaffold(
      backgroundColor: context.nobo.canvas,
      body: SafeArea(
        bottom: false,
        child: NoboRefreshScroll(
          onRefresh: () => _refresh(ref),
          slivers: <Widget>[
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.md,
                  NoboSpace.gutter,
                  0,
                ),
                child: _GreetingRow(
                  greeting: greeting,
                  name: name,
                  profile: account.value,
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
                child: _CommandEntry(
                  onTap: () => context.go(Routes.create),
                  suggestions: _suggestions(leads.value ?? const <LeadSeed>[]),
                  onSuggestion: (String s) =>
                      context.go('${Routes.create}?prompt=${Uri.encodeComponent(s)}'),
                ),
              ),
            ),

            // Only rendered when something genuinely needs the owner.
            if (needing.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    NoboSpace.gutter,
                    NoboSpace.xl,
                    NoboSpace.gutter,
                    0,
                  ),
                  child: _NeedsYouSection(sessions: needing),
                ),
              ),

            if (working.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    NoboSpace.gutter,
                    NoboSpace.lg,
                    NoboSpace.gutter,
                    0,
                  ),
                  child: _WorkingStrip(sessions: working),
                ),
              ),

            SliverToBoxAdapter(child: _RecentOutput(assets: assets)),

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.xl,
                  NoboSpace.gutter,
                  0,
                ),
                child: _PulseStrip(
                  leads: leads.value ?? const <LeadSeed>[],
                  sessions: allSessions,
                  credits: account.value?.credits ?? 0,
                ),
              ),
            ),

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                child: NoboSectionHeader(
                  eyebrow: 'Your work',
                  title: 'Recent tasks',
                  action: allSessions.length > 3 ? 'See all' : null,
                  onAction: () => context.go(Routes.create),
                ),
              ),
            ),

            if (sessions.isLoading)
              const SliverToBoxAdapter(
                child: SizedBox(height: 160, child: NoboLoading()),
              )
            else if (allSessions.isEmpty)
              SliverToBoxAdapter(
                child: NoboEmptyState(
                  title: 'No tasks yet',
                  message:
                      'Tell Nobogent what you need — a video, a campaign, a set '
                      'of creatives — and it will get to work.',
                  icon: Icons.bolt_rounded,
                  actionLabel: 'Start a task',
                  onAction: () => context.go(Routes.create),
                  compact: true,
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                sliver: SliverList.separated(
                  itemCount: allSessions.length > 3
                      ? 3
                      : allSessions.length,
                  separatorBuilder: (_, _) =>
                      const SizedBox(height: NoboSpace.sm),
                  itemBuilder: (BuildContext context, int i) =>
                      _TaskRow(session: allSessions[i]),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// Contextual suggestions rather than generic ones — derived from the
  /// workspace's own state.
  List<String> _suggestions(List<LeadSeed> leads) {
    final List<String> out = <String>[];
    final int overdue = leads
        .where(
          (LeadSeed l) =>
              l.nextFollowup != null &&
              l.nextFollowup!.isBefore(DateTime.now()),
        )
        .length;
    if (overdue > 0) out.add('Follow up $overdue overdue');
    out.add('Create a video');
    out.add('5 Instagram creatives');
    return out.take(3).toList(growable: false);
  }
}

class _GreetingRow extends StatelessWidget {
  const _GreetingRow({
    required this.greeting,
    required this.name,
    required this.profile,
  });

  final String greeting;
  final String name;
  final NoboProfile? profile;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                greeting.toUpperCase(),
                style: NoboType.micro.copyWith(color: c.inkTertiary),
              ),
              const SizedBox(height: 4),
              Text(
                name,
                style: NoboType.title.copyWith(color: c.ink),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        if (profile != null)
          GestureDetector(
            onTap: () => context.push(Routes.settings),
            child: NoboAvatar(
              name: profile!.displayName,
              imageUrl: profile!.avatarUrl,
              size: 40,
            ),
          ),
      ],
    );
  }
}

/// The signature surface: the single place to instruct the agent.
class _CommandEntry extends StatelessWidget {
  const _CommandEntry({
    required this.onTap,
    required this.suggestions,
    required this.onSuggestion,
  });

  final VoidCallback onTap;
  final List<String> suggestions;
  final ValueChanged<String> onSuggestion;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: Container(
            decoration: BoxDecoration(
              gradient: NoboGradients.orbit,
              borderRadius: BorderRadius.circular(NoboRadius.xl),
              boxShadow: NoboElevation.glow(NoboBrand.violet600),
            ),
            padding: const EdgeInsets.all(NoboSpace.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    const OrbitMark(
                      size: 30,
                      active: true,
                      color: Colors.white,
                      secondaryColor: Color(0xFFB9A0FF),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: Text(
                        'What should Nobogent do next?',
                        style: NoboType.subtitle.copyWith(
                          color: Colors.white,
                          fontSize: 16.5,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: NoboSpace.base),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.base,
                    vertical: 13,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: isDark ? 0.10 : 0.16),
                    borderRadius: BorderRadius.circular(NoboRadius.md),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.22),
                    ),
                  ),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          'Describe what you need done…',
                          style: NoboType.body.copyWith(
                            color: Colors.white.withValues(alpha: 0.72),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: NoboSpace.sm),
                      Container(
                        width: 30,
                        height: 30,
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.arrow_upward_rounded,
                          size: 17,
                          color: Color(0xFF4E1CB8),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: NoboSpace.md),
        // Wrapped rather than a horizontal scroller: three short chips fit in two
        // rows, and nothing is left clipped at the screen edge.
        Wrap(
          spacing: NoboSpace.sm,
          runSpacing: NoboSpace.sm,
          children: <Widget>[
            for (final String suggestion in suggestions)
              GestureDetector(
                onTap: () => onSuggestion(suggestion),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.md,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: NoboRadius.rPill,
                    border: Border.all(color: c.border),
                  ),
                  child: Text(
                    suggestion,
                    style: NoboType.caption.copyWith(
                      color: c.inkSecondary,
                      fontSize: 12.5,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _NeedsYouSection extends StatelessWidget {
  const _NeedsYouSection({required this.sessions});

  final List<AgentSession> sessions;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        NoboSectionHeader(
          eyebrow: 'Blocking',
          title: 'Needs your decision',
          padding: EdgeInsets.zero,
          action: 'Open inbox',
          onAction: () => context.go(Routes.inbox),
        ),
        for (final AgentSession s in sessions.take(2))
          Padding(
            padding: const EdgeInsets.only(bottom: NoboSpace.sm),
            child: NoboCard(
              onTap: () => context.push(Routes.session(s.id)),
              padding: const EdgeInsets.all(NoboSpace.base),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: c.dangerWash,
                      borderRadius: BorderRadius.circular(NoboRadius.sm),
                    ),
                    child: Icon(
                      Icons.shield_outlined,
                      size: 17,
                      color: c.danger,
                    ),
                  ),
                  const SizedBox(width: NoboSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          s.title,
                          style: NoboType.bodyStrong.copyWith(color: c.ink),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _reason(s),
                          style: NoboType.caption.copyWith(
                            color: c.inkSecondary,
                          ),
                          maxLines: 2,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: NoboSpace.sm),
                  Icon(
                    Icons.chevron_right_rounded,
                    size: 20,
                    color: c.inkTertiary,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  String _reason(AgentSession s) {
    final int approvals = s.pendingApprovals;
    if (approvals > 0) {
      return approvals == 1
          ? 'Nobogent is waiting for one approval.'
          : 'Nobogent is waiting for $approvals approvals.';
    }
    return 'Nobogent asked you a question.';
  }
}

class _WorkingStrip extends StatelessWidget {
  const _WorkingStrip({required this.sessions});

  final List<AgentSession> sessions;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Text(
              'IN PROGRESS',
              style: NoboType.micro.copyWith(color: c.inkTertiary),
            ),
          ],
        ),
        const SizedBox(height: NoboSpace.md),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.only(right: NoboSpace.gutter),
            itemCount: sessions.length,
            separatorBuilder: (_, _) => const SizedBox(width: NoboSpace.sm),
            itemBuilder: (BuildContext context, int i) {
              final AgentSession s = sessions[i];
              return GestureDetector(
                onTap: () => context.push(Routes.session(s.id)),
                child: Container(
                  width: 248,
                  padding: const EdgeInsets.all(NoboSpace.md),
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: BorderRadius.circular(NoboRadius.md),
                    border: Border.all(
                      color: c.primary.withValues(alpha: 0.22),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          OrbitMark(size: 14, active: true, color: c.primary),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              s.title,
                              style: NoboType.label.copyWith(
                                fontSize: 12.5,
                                color: c.ink,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        s.preview,
                        style: NoboType.caption.copyWith(
                          color: c.inkTertiary,
                          fontSize: 11.5,
                          height: 1.35,
                        ),
                        maxLines: 2,
                      ),
                      const Spacer(),
                      const NoboProgressBar(value: 0.6, height: 3),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _RecentOutput extends StatelessWidget {
  const _RecentOutput({required this.assets});

  final AsyncValue<List<AssetSeed>> assets;

  @override
  Widget build(BuildContext context) {
    final List<AssetSeed> items = (assets.value ?? const <AssetSeed>[])
        .take(10)
        .toList(growable: false);
    if (items.isEmpty && !assets.isLoading) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
          child: NoboSectionHeader(
            eyebrow: 'Generated',
            title: 'Recent output',
            action: 'Library',
            onAction: () => context.go(Routes.projects),
          ),
        ),
        SizedBox(
          height: 172,
          child: assets.isLoading
              ? ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.gutter,
                  ),
                  itemCount: 3,
                  separatorBuilder: (_, _) =>
                      const SizedBox(width: NoboSpace.sm),
                  itemBuilder: (_, _) => const NoboSkeleton(
                    width: 126,
                    height: 168,
                    radius: NoboRadius.md,
                  ),
                )
              : ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.gutter,
                  ),
                  itemCount: items.length,
                  separatorBuilder: (_, _) =>
                      const SizedBox(width: NoboSpace.sm),
                  itemBuilder: (BuildContext context, int i) {
                    final AssetSeed a = items[i];
                    return SizedBox(
                      width: 126,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          NoboMediaTile(
                            source: a.preview,
                            isVideo: a.isVideo,
                            durationSeconds: a.durationSeconds,
                            width: 126,
                            aspectRatio: 126 / 140,
                            onTap: a.preview == null
                                ? null
                                : () => context.push(
                                    '${Routes.media}?src='
                                    '${Uri.encodeComponent(a.playable ?? a.preview!)}'
                                    '&video=${a.isVideo ? 1 : 0}',
                                  ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            a.title ?? 'Untitled',
                            style: NoboType.caption.copyWith(
                              color: c2(context),
                              fontSize: 11.5,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
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

  Color c2(BuildContext context) => context.nobo.inkSecondary;
}

class _PulseStrip extends StatelessWidget {
  const _PulseStrip({
    required this.leads,
    required this.sessions,
    required this.credits,
  });

  final List<LeadSeed> leads;
  final List<AgentSession> sessions;
  final double credits;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final DateTime now = DateTime.now();
    final int newLeads = leads
        .where(
          (LeadSeed l) =>
              l.createdAt != null &&
              now.difference(l.createdAt!).inHours < 24,
        )
        .length;
    final int done = sessions
        .where((AgentSession s) => s.state == SessionState.done)
        .length;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: NoboSpace.base,
        vertical: NoboSpace.md,
      ),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(NoboRadius.md),
        border: Border.all(color: c.border),
      ),
      child: Row(
        children: <Widget>[
          _PulseItem(
            value: '$newLeads',
            label: 'new leads',
            tone: c.positive,
          ),
          _Divider(color: c.hairline),
          _PulseItem(value: '$done', label: 'tasks done', tone: c.primary),
          _Divider(color: c.hairline),
          _PulseItem(
            value: credits >= 1000
                ? '${(credits / 1000).toStringAsFixed(1)}k'
                : credits.toStringAsFixed(0),
            label: 'credits',
            tone: c.credit,
          ),
        ],
      ),
    );
  }
}

class _PulseItem extends StatelessWidget {
  const _PulseItem({
    required this.value,
    required this.label,
    required this.tone,
  });

  final String value;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Expanded(
      child: Column(
        children: <Widget>[
          Text(
            value,
            style: NoboType.numeric(
              NoboType.headline.copyWith(color: c.ink, fontSize: 19),
            ),
          ),
          const SizedBox(height: 1),
          Text(
            label,
            style: NoboType.caption.copyWith(color: c.inkTertiary),
          ),
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(width: 1, height: 26, color: color);
  }
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AgentMessage? last = session.messages.isEmpty
        ? null
        : session.messages.last;

    return NoboCard(
      onTap: () => context.push(Routes.session(session.id)),
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: session.state == SessionState.needsYou
                  ? c.dangerWash
                  : c.primaryWash,
              borderRadius: BorderRadius.circular(NoboRadius.sm),
            ),
            child: Icon(
              session.state == SessionState.needsYou
                  ? Icons.shield_outlined
                  : Icons.auto_awesome,
              size: 17,
              color: session.state == SessionState.needsYou
                  ? c.danger
                  : c.primary,
            ),
          ),
          const SizedBox(width: NoboSpace.md),
          Expanded(
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
                    Text(
                      timeAgo(session.updatedAt),
                      style: NoboType.caption.copyWith(
                        color: c.inkTertiary,
                        fontSize: 11.5,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  last?.text ?? session.preview,
                  style: NoboType.caption.copyWith(color: c.inkSecondary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (session.projectTitle != null) ...<Widget>[
                  const SizedBox(height: 6),
                  Row(
                    children: <Widget>[
                      Icon(
                        Icons.workspaces_outline,
                        size: 11,
                        color: c.inkTertiary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        session.projectTitle!,
                        style: NoboType.caption.copyWith(
                          color: c.inkTertiary,
                          fontSize: 11,
                        ),
                      ),
                      const SizedBox(width: NoboSpace.sm),
                      AgentStatusPill(state: session.state),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
