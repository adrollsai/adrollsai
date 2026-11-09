import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import '../platform/nobo_platform.dart';

/// Presents a sheet using each platform's own presentation style.
///
/// iOS presents a large, grabber-led sheet that the user can flick down;
/// Android presents a Material modal bottom sheet with a drag handle and a
/// scrim. Same content, native ergonomics.
Future<T?> showNoboSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool expand = false,
  bool isDismissible = true,
}) {
  final NoboColors c = context.nobo;

  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    enableDrag: true,
    isDismissible: isDismissible,
    backgroundColor: Colors.transparent,
    barrierColor: c.scrim,
    useSafeArea: true,
    builder: (BuildContext ctx) {
      final double topInset = MediaQuery.paddingOf(ctx).top;
      final double maxHeight =
          MediaQuery.sizeOf(ctx).height - topInset - (expand ? 8 : 48);

      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: NoboRadius.rSheetTop,
            boxShadow: NoboElevation.high,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              // Grabber: iOS users read this as "drag me"; Android users read
              // it as a sheet handle. Both are correct.
              Padding(
                padding: const EdgeInsets.only(top: 8, bottom: 4),
                child: Container(
                  width: 36,
                  height: 4.5,
                  decoration: BoxDecoration(
                    color: c.borderStrong,
                    borderRadius: NoboRadius.rPill,
                  ),
                ),
              ),
              Flexible(child: builder(ctx)),
            ],
          ),
        ),
      );
    },
  );
}

/// Standard sheet header with a title, optional subtitle and a close action.
class NoboSheetHeader extends StatelessWidget {
  const NoboSheetHeader({
    required this.title,
    this.subtitle,
    this.onClose,
    this.trailing,
    super.key,
  });

  final String title;
  final String? subtitle;
  final VoidCallback? onClose;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        NoboSpace.gutter,
        NoboSpace.md,
        NoboSpace.sm,
        NoboSpace.md,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: NoboType.headline.copyWith(color: c.ink)),
                if (subtitle != null) ...<Widget>[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    style: NoboType.caption.copyWith(color: c.inkSecondary),
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) trailing!,
          if (onClose != null)
            if (NoboPlatform.isIOS)
              CupertinoButton(
                padding: EdgeInsets.zero,
                minimumSize: const Size(44, 44),
                onPressed: onClose,
                child: Text(
                  'Done',
                  style: NoboType.label
                      .copyWith(color: c.primary, fontSize: 16),
                ),
              )
            else
              IconButton(
                onPressed: onClose,
                icon: Icon(Icons.close_rounded, size: 20, color: c.inkSecondary),
                tooltip: 'Close',
              ),
        ],
      ),
    );
  }
}

/// Confirmation dialog. Material on Android, Cupertino alert on iOS.
Future<bool> showNoboConfirm({
  required BuildContext context,
  required String title,
  required String message,
  String confirmLabel = 'Confirm',
  String cancelLabel = 'Cancel',
  bool destructive = false,
}) async {
  final NoboColors c = context.nobo;

  if (NoboPlatform.isIOS) {
    final bool? ok = await showCupertinoDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => CupertinoAlertDialog(
        title: Text(title),
        content: Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(message),
        ),
        actions: <Widget>[
          CupertinoDialogAction(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(cancelLabel),
          ),
          CupertinoDialogAction(
            isDestructiveAction: destructive,
            isDefaultAction: !destructive,
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  final bool? ok = await showDialog<bool>(
    context: context,
    builder: (BuildContext ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: Text(
            cancelLabel,
            style: NoboType.label.copyWith(color: c.inkSecondary),
          ),
        ),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: Text(
            confirmLabel,
            style: NoboType.label.copyWith(
              color: destructive ? c.danger : c.primary,
            ),
          ),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Lightweight action list used by context menus and overflow buttons.
class NoboActionSheetItem {
  const NoboActionSheetItem({
    required this.label,
    required this.icon,
    this.onTap,
    this.destructive = false,
    this.subtitle,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  final bool destructive;
  final String? subtitle;
}

Future<void> showNoboActions({
  required BuildContext context,
  required String title,
  required List<NoboActionSheetItem> actions,
}) async {
  final NoboColors c = context.nobo;

  if (NoboPlatform.isIOS) {
    await showCupertinoModalPopup<void>(
      context: context,
      builder: (BuildContext ctx) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(NoboSpace.sm),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              CupertinoActionSheet(
                title: Text(title),
                actions: <Widget>[
                  for (final NoboActionSheetItem a in actions)
                    CupertinoActionSheetAction(
                      isDestructiveAction: a.destructive,
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        a.onTap?.call();
                      },
                      child: Text(a.label),
                    ),
                ],
                cancelButton: CupertinoActionSheetAction(
                  isDefaultAction: true,
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Cancel'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    return;
  }

  await showNoboSheet<void>(
    context: context,
    builder: (BuildContext ctx) => SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              NoboSpace.gutter,
              NoboSpace.xs,
              NoboSpace.gutter,
              NoboSpace.md,
            ),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                title,
                style: NoboType.subtitle.copyWith(color: c.ink),
              ),
            ),
          ),
          for (final NoboActionSheetItem a in actions)
            ListTile(
              leading: Icon(
                a.icon,
                size: 20,
                color: a.destructive ? c.danger : c.inkSecondary,
              ),
              title: Text(
                a.label,
                style: NoboType.body.copyWith(
                  color: a.destructive ? c.danger : c.ink,
                ),
              ),
              subtitle: a.subtitle == null
                  ? null
                  : Text(
                      a.subtitle!,
                      style: NoboType.caption.copyWith(color: c.inkTertiary),
                    ),
              onTap: () {
                Navigator.of(ctx).pop();
                a.onTap?.call();
              },
            ),
          const SizedBox(height: NoboSpace.sm),
        ],
      ),
    ),
  );
}
