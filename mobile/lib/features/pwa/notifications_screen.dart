import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/navigation.dart';
import '../../core/utils/format.dart';
import '../../data/workspace_source.dart';
import 'pwa_widgets.dart';

/// Notifications & Alerts — the web app's `/dashboard/notifications`.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<NoticeSeed>> async = ref.watch(noticesProvider);
    final List<NoticeSeed> all = async.value ?? const <NoticeSeed>[];
    final int unread = all.where((NoticeSeed n) => !n.read).length;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(noticesProvider);
        await ref
            .read(noticesProvider.future)
            .catchError((Object _) => const <NoticeSeed>[]);
      },
      color: c.primary,
      backgroundColor: c.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: <Widget>[
          NoboPageHeader(
            title: 'Notifications & Alerts',
            subtitle: unread == 0
                ? 'You are all caught up'
                : '$unread unread',
            actions: <Widget>[
              NoboCircleAction(
                icon: Icons.done_all_rounded,
                onTap: () async {
                  await ref
                      .read(workspaceRepositoryProvider)
                      .markAllNotificationsRead();
                  ref.invalidate(noticesProvider);
                },
                tooltip: 'Mark all read',
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: async.isLoading
                ? const SizedBox(height: 200, child: PwaLoading())
                : all.isEmpty
                ? PwaCard(
                    child: Column(
                      children: <Widget>[
                        Icon(
                          Icons.notifications_none_rounded,
                          size: 28,
                          color: c.inkTertiary,
                        ),
                        const SizedBox(height: NoboSpace.md),
                        Text(
                          'No notifications',
                          style: NoboType.subtitle.copyWith(color: c.ink),
                        ),
                      ],
                    ),
                  )
                : Column(
                    children: <Widget>[
                      for (final NoticeSeed n in all)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: NoboSpace.sm,
                          ),
                          child: _NoticeRow(notice: n),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }
}

class _NoticeRow extends StatelessWidget {
  const _NoticeRow({required this.notice});

  final NoticeSeed notice;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final (IconData icon, Color tone) = switch (notice.kind) {
      NoticeKind.approval => (Icons.shield_outlined, c.danger),
      NoticeKind.question => (Icons.help_outline_rounded, c.primary),
      NoticeKind.done => (Icons.check_circle_outline_rounded, c.positive),
      NoticeKind.failed => (Icons.error_outline_rounded, c.caution),
      NoticeKind.lead => (Icons.person_add_alt_1_outlined, c.positive),
      NoticeKind.system => (Icons.info_outline_rounded, c.inkSecondary),
    };

    return PwaCard(
      padding: const EdgeInsets.all(NoboSpace.base),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.10),
              borderRadius: NoboRadius.rSm,
            ),
            child: Icon(icon, size: 17, color: tone),
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
                        notice.title,
                        style: NoboType.body.copyWith(
                          color: c.ink,
                          fontSize: 14,
                          fontWeight: notice.read
                              ? FontWeight.w500
                              : FontWeight.w700,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!notice.read)
                      Container(
                        width: 7,
                        height: 7,
                        margin: const EdgeInsets.only(left: 6),
                        decoration: BoxDecoration(
                          color: c.danger,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                if (notice.body != null) ...<Widget>[
                  const SizedBox(height: 3),
                  Text(
                    notice.body!,
                    style: NoboType.caption.copyWith(
                      color: c.inkSecondary,
                      height: 1.4,
                    ),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: 5),
                Text(
                  timeAgo(notice.createdAt),
                  style: NoboType.caption.copyWith(
                    color: c.inkTertiary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
