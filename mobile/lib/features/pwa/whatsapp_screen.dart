import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/media.dart';
import '../../core/ui/navigation.dart';
import '../../core/utils/format.dart';
import '../../data/models/comms.dart';
import 'pwa_widgets.dart';

/// WhatsApp Portal — the web app's `/dashboard/whatsapp`.
///
/// Three tabs mirroring the web portal: Chats (the real conversation inbox),
/// Broadcasts and Flows. All three read live data.
class WhatsAppScreen extends ConsumerStatefulWidget {
  const WhatsAppScreen({super.key});

  @override
  ConsumerState<WhatsAppScreen> createState() => _WhatsAppScreenState();
}

class _WhatsAppScreenState extends ConsumerState<WhatsAppScreen> {
  int _tab = 0;
  static const List<String> _tabs = <String>['Chats', 'Broadcasts', 'Flows'];

  Future<void> _refresh() async {
    ref.invalidate(whatsappChatsProvider);
    ref.invalidate(broadcastsProvider);
    ref.invalidate(whatsappFlowsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    return RefreshIndicator(
      onRefresh: _refresh,
      color: c.primary,
      backgroundColor: c.surface,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: <Widget>[
          NoboPageHeader(
            title: 'WhatsApp Portal',
            subtitle: 'Conversations, broadcasts and automations',
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
            child: SizedBox(
              height: 40,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.zero,
                itemCount: _tabs.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (BuildContext context, int i) => PwaFilterPill(
                  label: _tabs[i],
                  selected: i == _tab,
                  onTap: () => setState(() => _tab = i),
                ),
              ),
            ),
          ),
          const SizedBox(height: NoboSpace.base),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
            child: switch (_tab) {
              0 => const _ChatsTab(),
              1 => const _BroadcastsTab(),
              _ => const _FlowsTab(),
            },
          ),
          const SizedBox(height: NoboSpace.xxl),
        ],
      ),
    );
  }
}

class _ChatsTab extends ConsumerWidget {
  const _ChatsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<WhatsAppChat>> async = ref.watch(
      whatsappChatsProvider,
    );
    final List<WhatsAppChat> chats = async.value ?? const <WhatsAppChat>[];

    if (async.isLoading) {
      return const SizedBox(height: 220, child: PwaLoading());
    }
    if (chats.isEmpty) {
      return const _Empty(
        icon: Icons.chat_bubble_outline_rounded,
        title: 'No conversations yet',
        body:
            'Inbound WhatsApp replies land here. Your qualifying flows and '
            'broadcasts start the conversation from the web app.',
      );
    }
    return Column(
      children: <Widget>[
        for (final WhatsAppChat chat in chats.take(60))
          Padding(
            padding: const EdgeInsets.only(bottom: NoboSpace.sm),
            child: PwaCard(
              padding: const EdgeInsets.all(NoboSpace.md),
              onTap: () => context.push(Routes.whatsappChat(chat.id)),
              child: Row(
                children: <Widget>[
                  NoboAvatar(name: chat.displayName, size: 42),
                  const SizedBox(width: NoboSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            Expanded(
                              child: Text(
                                chat.displayName,
                                style: NoboType.label.copyWith(
                                  color: c.ink,
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (chat.updatedAt != null)
                              Text(
                                timeAgo(chat.updatedAt),
                                style: NoboType.caption.copyWith(
                                  color: c.inkTertiary,
                                  fontSize: 10.5,
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: <Widget>[
                            Expanded(
                              child: Text(
                                chat.lastMessage ?? 'No messages',
                                style: NoboType.caption.copyWith(
                                  color: c.inkSecondary,
                                  fontSize: 12,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (chat.unread > 0) ...<Widget>[
                              const SizedBox(width: NoboSpace.sm),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 1,
                                ),
                                decoration: const BoxDecoration(
                                  color: NoboBrand.whatsapp,
                                  borderRadius: NoboRadius.rPill,
                                ),
                                child: Text(
                                  '${chat.unread}',
                                  style: NoboType.caption.copyWith(
                                    color: Colors.white,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _BroadcastsTab extends ConsumerWidget {
  const _BroadcastsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<WhatsAppBroadcast>> async = ref.watch(
      broadcastsProvider,
    );
    final List<WhatsAppBroadcast> items =
        async.value ?? const <WhatsAppBroadcast>[];

    if (async.isLoading) {
      return const SizedBox(height: 220, child: PwaLoading());
    }
    if (items.isEmpty) {
      return const _Empty(
        icon: Icons.campaign_outlined,
        title: 'No broadcasts yet',
        body:
            'Create a broadcast in the web app; its delivery status appears '
            'here.',
      );
    }
    return Column(
      children: <Widget>[
        for (final WhatsAppBroadcast b in items)
          Padding(
            padding: const EdgeInsets.only(bottom: NoboSpace.sm),
            child: PwaCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          b.title,
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
                      PwaFilterPill(
                        label: b.status,
                        selected: false,
                        onTap: () {},
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: <Widget>[
                      Icon(
                        Icons.description_outlined,
                        size: 12,
                        color: c.inkTertiary,
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          b.templateName ?? 'No template',
                          style: NoboType.caption.copyWith(
                            color: c.inkSecondary,
                            fontSize: 11.5,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (b.sentAt != null)
                        Text(
                          timeAgo(b.sentAt),
                          style: NoboType.caption.copyWith(
                            color: c.inkTertiary,
                            fontSize: 10.5,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _FlowsTab extends ConsumerWidget {
  const _FlowsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<WhatsAppFlow>> async = ref.watch(
      whatsappFlowsProvider,
    );
    final List<WhatsAppFlow> items = async.value ?? const <WhatsAppFlow>[];

    if (async.isLoading) {
      return const SizedBox(height: 220, child: PwaLoading());
    }
    if (items.isEmpty) {
      return const _Empty(
        icon: Icons.account_tree_outlined,
        title: 'No automations yet',
        body: 'Build a qualifying flow in the web app to start capturing '
            'answers from WhatsApp.',
      );
    }
    return Column(
      children: <Widget>[
        for (final WhatsAppFlow f in items.take(40))
          Padding(
            padding: const EdgeInsets.only(bottom: NoboSpace.sm),
            child: PwaCard(
              child: Row(
                children: <Widget>[
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: f.active
                          ? c.positiveWash
                          : c.surfaceSunken,
                      borderRadius: NoboRadius.rSm,
                    ),
                    child: Icon(
                      Icons.account_tree_outlined,
                      size: 17,
                      color: f.active ? c.positive : c.inkTertiary,
                    ),
                  ),
                  const SizedBox(width: NoboSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          f.title,
                          style: NoboType.label.copyWith(
                            color: c.ink,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (f.description != null)
                          Text(
                            f.description!,
                            style: NoboType.caption.copyWith(
                              color: c.inkSecondary,
                              fontSize: 11.5,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: NoboSpace.sm),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: f.active ? c.positiveWash : c.surfaceSunken,
                      borderRadius: NoboRadius.rPill,
                    ),
                    child: Text(
                      f.active ? 'ACTIVE' : 'OFF',
                      style: NoboType.micro.copyWith(
                        color: f.active ? c.positive : c.inkTertiary,
                        fontSize: 9,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return PwaCard(
      child: Column(
        children: <Widget>[
          Icon(icon, size: 30, color: c.inkTertiary),
          const SizedBox(height: NoboSpace.md),
          Text(title, style: NoboType.subtitle.copyWith(color: c.ink)),
          const SizedBox(height: 4),
          Text(
            body,
            textAlign: TextAlign.center,
            style: NoboType.caption.copyWith(color: c.inkSecondary),
          ),
        ],
      ),
    );
  }
}

/// A single WhatsApp conversation.
class WhatsAppThreadScreen extends ConsumerWidget {
  const WhatsAppThreadScreen({
    required this.chatId,
    required this.title,
    super.key,
  });

  final String chatId;
  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<WhatsAppMessage>> async = ref.watch(
      whatsappMessagesProvider(chatId),
    );
    final List<WhatsAppMessage> messages =
        async.value ?? const <WhatsAppMessage>[];

    return Scaffold(
      backgroundColor: c.canvas,
      appBar: AppBar(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, size: 20),
          onPressed: () => context.pop(),
        ),
        title: Text(
          title,
          style: NoboType.subtitle.copyWith(
            color: c.ink,
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: async.isLoading
          ? const PwaLoading(label: 'Loading conversation…')
          : messages.isEmpty
          ? Center(
              child: Text(
                'No messages in this conversation yet.',
                style: NoboType.body.copyWith(color: c.inkSecondary),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.all(NoboSpace.base),
              itemCount: messages.length,
              separatorBuilder: (_, _) => const SizedBox(height: 6),
              itemBuilder: (BuildContext context, int i) {
                final WhatsAppMessage m = messages[i];
                final bool mine = !m.inbound;
                return Align(
                  alignment: mine
                      ? Alignment.centerRight
                      : Alignment.centerLeft,
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 300),
                    padding: const EdgeInsets.symmetric(
                      horizontal: NoboSpace.md,
                      vertical: 9,
                    ),
                    decoration: BoxDecoration(
                      color: mine
                          ? NoboBrand.whatsapp.withValues(alpha: 0.14)
                          : c.surface,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(NoboRadius.md),
                        topRight: Radius.circular(NoboRadius.md),
                        bottomLeft: Radius.circular(NoboRadius.md),
                        bottomRight: Radius.circular(4),
                      ),
                      border: Border.all(color: c.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (m.text != null && m.text!.isNotEmpty)
                          Text(
                            m.text!,
                            style: NoboType.body.copyWith(
                              color: c.ink,
                              fontSize: 14,
                              height: 1.4,
                            ),
                          ),
                        if (m.mediaUrl != null) ...<Widget>[
                          const SizedBox(height: 6),
                          Text(
                            m.mediaType == 'image'
                                ? '📷 Photo'
                                : m.mediaType == 'video'
                                ? '🎬 Video'
                                : '📎 Attachment',
                            style: NoboType.caption.copyWith(
                              color: c.primary,
                            ),
                          ),
                        ],
                        if (m.at != null) ...<Widget>[
                          const SizedBox(height: 3),
                          Text(
                            clockTime(m.at!),
                            style: NoboType.caption.copyWith(
                              color: c.inkTertiary,
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}
