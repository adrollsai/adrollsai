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
import '../../core/utils/format.dart';
import '../../data/models/agent.dart';
import '../../data/models/profile.dart';
import 'pwa_widgets.dart';

/// Nobogent — the web app's agent ("Harness") screen.
///
/// The web version is a two-pane layout: a workspace/session sidebar and the chat
/// pane with its model-picker composer. Two panes do not fit a phone, so the
/// session list is the screen and the conversation opens on top of it — same
/// information, arranged for one hand.
class AgentScreen extends ConsumerStatefulWidget {
  const AgentScreen({super.key});

  @override
  ConsumerState<AgentScreen> createState() => _AgentScreenState();
}

class _AgentScreenState extends ConsumerState<AgentScreen> {
  final TextEditingController _prompt = TextEditingController();

  @override
  void dispose() {
    _prompt.dispose();
    super.dispose();
  }

  Future<void> _newSession([String? brief]) async {
    final SessionsController ctl = ref.read(sessionsProvider.notifier);
    final AgentSession created = await ctl.create();
    if (!mounted) return;
    final String text = (brief ?? _prompt.text).trim();
    _prompt.clear();
    unawaited(
      context.push(
        '${Routes.session(created.id)}'
        '${text.isEmpty ? '' : '?prompt=${Uri.encodeComponent(text)}'}',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final NoboProfile? profile = ref.watch(accountProvider).value;
    final List<AgentSession> sessions =
        ref.watch(sessionsProvider).value ?? const <AgentSession>[];

    return Column(
      children: <Widget>[
        Expanded(
          child: ListView(
            padding: EdgeInsets.zero,
            children: <Widget>[
              // Header: brand + HARNESS tag, as in the web sidebar.
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.md,
                  NoboSpace.gutter,
                  0,
                ),
                child: Row(
                  children: <Widget>[
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: c.navy,
                        borderRadius: NoboRadius.rSm,
                      ),
                      child: Icon(
                        Icons.smart_toy_rounded,
                        size: 19,
                        color: c.onNavy,
                      ),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Flexible(
                      child: Text(
                        'Nobogent',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: NoboType.subtitle.copyWith(
                          color: c.ink,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.3,
                        ),
                      ),
                    ),
                    const SizedBox(width: NoboSpace.sm),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: c.surfaceSunken,
                        borderRadius: NoboRadius.rXs,
                      ),
                      child: Text(
                        'HARNESS',
                        style: NoboType.micro.copyWith(
                          color: c.inkSecondary,
                          fontSize: 8.5,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Icon(
                      Icons.download_outlined,
                      size: 18,
                      color: c.inkTertiary,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: NoboSpace.base),

              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                child: PwaPrimaryButton(
                  label: 'New session',
                  icon: Icons.add_rounded,
                  dark: true,
                  onPressed: () => _newSession(),
                ),
              ),
              const SizedBox(height: NoboSpace.xl),

              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                ),
                child: Row(
                  children: <Widget>[
                    PwaLabel(profile?.workspaceName ?? 'Workspace'),
                    const Spacer(),
                    Icon(
                      Icons.search_rounded,
                      size: 16,
                      color: c.inkTertiary,
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Icon(
                      Icons.create_new_folder_outlined,
                      size: 16,
                      color: c.inkTertiary,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: NoboSpace.sm),

              // Sessions.
              if (sessions.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(NoboSpace.xl),
                  child: PwaCard(
                    child: Column(
                      children: <Widget>[
                        Icon(
                          Icons.chat_bubble_outline_rounded,
                          size: 26,
                          color: c.inkTertiary,
                        ),
                        const SizedBox(height: NoboSpace.md),
                        Text(
                          'No sessions yet',
                          style: NoboType.subtitle.copyWith(color: c.ink),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Start a session and tell Nobogent what to do.',
                          textAlign: TextAlign.center,
                          style: NoboType.caption.copyWith(
                            color: c.inkSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              else
                for (final AgentSession s in sessions)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      NoboSpace.gutter,
                      0,
                      NoboSpace.gutter,
                      NoboSpace.sm,
                    ),
                    child: PwaCard(
                      padding: const EdgeInsets.all(NoboSpace.base),
                      onTap: () => context.push(Routes.session(s.id)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            children: <Widget>[
                              Expanded(
                                child: Text(
                                  s.title,
                                  style: NoboType.label.copyWith(
                                    color: c.ink,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: NoboSpace.sm),
                              AgentStatusPill(state: s.state),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            s.preview,
                            style: NoboType.caption.copyWith(
                              color: c.inkSecondary,
                              height: 1.4,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 6),
                          Row(
                            children: <Widget>[
                              Icon(
                                Icons.schedule_rounded,
                                size: 11,
                                color: c.inkTertiary,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                timeAgo(s.updatedAt),
                                style: NoboType.caption.copyWith(
                                  color: c.inkTertiary,
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
              const SizedBox(height: NoboSpace.xxl),
            ],
          ),
        ),

        // Composer, mirroring the web app's model picker + send row.
        Container(
          decoration: BoxDecoration(
            color: c.surface,
            border: Border(top: BorderSide(color: c.border)),
          ),
          padding: EdgeInsets.fromLTRB(
            NoboSpace.gutter,
            NoboSpace.md,
            NoboSpace.gutter,
            NoboSpace.sm + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                decoration: BoxDecoration(
                  color: c.surface,
                  borderRadius: NoboRadius.rLg,
                  border: Border.all(color: c.border),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.base,
                  vertical: 2,
                ),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: _prompt,
                        maxLines: 1,
                        style: NoboType.body.copyWith(
                          color: c.ink,
                          fontSize: 14.5,
                        ),
                        cursorColor: c.primary,
                        onSubmitted: (String v) => _newSession(v),
                        decoration: InputDecoration(
                          isDense: true,
                          filled: false,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(
                            vertical: 12,
                          ),
                          hintText: 'Message Nobogent…',
                          hintStyle: NoboType.body.copyWith(
                            color: c.inkTertiary,
                            fontSize: 14.5,
                          ),
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: c.surfaceSunken,
                        borderRadius: NoboRadius.rPill,
                      ),
                      child: Row(
                        children: <Widget>[
                          Icon(
                            Icons.auto_awesome,
                            size: 11,
                            color: c.accent,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Nobogent Flash',
                            style: NoboType.caption.copyWith(
                              color: c.inkSecondary,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: NoboSpace.sm),
                    Icon(
                      Icons.send_rounded,
                      size: 18,
                      color: c.primary,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Text(
                  'Standard mode · Full Access',
                  style: NoboType.caption.copyWith(
                    color: c.inkTertiary,
                    fontSize: 10.5,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
