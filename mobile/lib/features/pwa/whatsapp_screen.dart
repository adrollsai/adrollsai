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
import '../../data/repositories/auth_repository.dart';
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

/// A single WhatsApp conversation, with a working reply composer.
///
/// Sending goes through `POST /api/whatsapp/chat`, which performs the Meta Cloud
/// API call and persists the outbound message, then the thread refreshes.
class WhatsAppThreadScreen extends ConsumerStatefulWidget {
  const WhatsAppThreadScreen({
    required this.chatId,
    required this.title,
    super.key,
  });

  final String chatId;
  final String title;

  @override
  ConsumerState<WhatsAppThreadScreen> createState() =>
      _WhatsAppThreadScreenState();
}

class _WhatsAppThreadScreenState
    extends ConsumerState<WhatsAppThreadScreen> {
  final TextEditingController _input = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final String text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref
          .read(workspaceRepositoryProvider)
          .sendWhatsAppText(chatId: widget.chatId, text: text);
      _input.clear();
      ref.invalidate(whatsappMessagesProvider(widget.chatId));
      ref.invalidate(whatsappChatsProvider);
      if (mounted) setState(() => _sending = false);
    } on NoboFailure catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _sending = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final AsyncValue<List<WhatsAppMessage>> async = ref.watch(
      whatsappMessagesProvider(widget.chatId),
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
          widget.title,
          style: NoboType.subtitle.copyWith(
            color: c.ink,
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: <Widget>[
          IconButton(
            onPressed: () =>
                ref.invalidate(whatsappMessagesProvider(widget.chatId)),
            icon: Icon(Icons.refresh_rounded, color: c.inkSecondary),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          if (_error != null)
            Container(
              width: double.infinity,
              color: c.dangerWash,
              padding: const EdgeInsets.all(NoboSpace.md),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(
                    Icons.error_outline_rounded,
                    size: 15,
                    color: c.danger,
                  ),
                  const SizedBox(width: NoboSpace.sm),
                  Expanded(
                    child: Text(
                      _error!,
                      style: NoboType.caption.copyWith(color: c.danger),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => setState(() => _error = null),
                    child: Icon(
                      Icons.close_rounded,
                      size: 15,
                      color: c.danger,
                    ),
                  ),
                ],
              ),
            ),
          Expanded(
            child: async.isLoading
                ? const PwaLoading(label: 'Loading conversation…')
                : messages.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(NoboSpace.xl),
                      child: Text(
                        'No messages yet. Say hello below.',
                        textAlign: TextAlign.center,
                        style: NoboType.body.copyWith(
                          color: c.inkSecondary,
                        ),
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(NoboSpace.base),
                    itemCount: messages.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 6),
                    itemBuilder: (BuildContext context, int i) =>
                        _Bubble(message: messages[i]),
                  ),
          ),
          Container(
            decoration: BoxDecoration(
              color: c.surface,
              border: Border(top: BorderSide(color: c.border)),
            ),
            padding: EdgeInsets.fromLTRB(
              NoboSpace.gutter,
              NoboSpace.sm,
              NoboSpace.gutter,
              NoboSpace.sm + MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      color: c.surface,
                      borderRadius: NoboRadius.rPill,
                      border: Border.all(color: c.border),
                    ),
                    padding: const EdgeInsets.symmetric(
                      horizontal: NoboSpace.base,
                      vertical: 2,
                    ),
                    child: TextField(
                      controller: _input,
                      maxLines: 4,
                      minLines: 1,
                      textCapitalization: TextCapitalization.sentences,
                      style: NoboType.body.copyWith(
                        color: c.ink,
                        fontSize: 14.5,
                      ),
                      cursorColor: c.primary,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        isDense: true,
                        filled: false,
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(
                          vertical: 11,
                        ),
                        hintText: 'Message…',
                        hintStyle: NoboType.body.copyWith(
                          color: c.inkTertiary,
                          fontSize: 14.5,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: NoboSpace.sm),
                SizedBox(
                  width: 44,
                  height: 44,
                  child: Material(
                    color: _sending ? c.surfaceSunken : NoboBrand.whatsapp,
                    shape: const CircleBorder(),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: _sending ? null : _send,
                      child: Center(
                        child: _sending
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    c.inkTertiary,
                                  ),
                                ),
                              )
                            : const Icon(
                                Icons.send_rounded,
                                size: 19,
                                color: Colors.white,
                              ),
                      ),
                    ),
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

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final WhatsAppMessage message;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool mine = !message.inbound;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
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
            if (message.text != null && message.text!.isNotEmpty)
              Text(
                message.text!,
                style: NoboType.body.copyWith(
                  color: c.ink,
                  fontSize: 14,
                  height: 1.4,
                ),
              ),
            if (message.mediaUrl != null) ...<Widget>[
              const SizedBox(height: 6),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(
                    message.mediaType == 'image'
                        ? Icons.image_outlined
                        : message.mediaType == 'video'
                        ? Icons.videocam_outlined
                        : Icons.attach_file_rounded,
                    size: 13,
                    color: c.primary,
                  ),
                  const SizedBox(width: 5),
                  Text(
                    message.mediaType == 'image'
                        ? 'Photo'
                        : message.mediaType == 'video'
                        ? 'Video'
                        : 'Attachment',
                    style: NoboType.caption.copyWith(color: c.primary),
                  ),
                ],
              ),
            ],
            if (message.at != null) ...<Widget>[
              const SizedBox(height: 3),
              Text(
                clockTime(message.at!),
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
  }
}