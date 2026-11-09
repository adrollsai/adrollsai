import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import '../platform/nobo_platform.dart';
import 'controls.dart';

/// One tab destination, with icons for both platforms.
class NoboDestination {
  const NoboDestination({
    required this.label,
    required this.materialIcon,
    required this.materialIconSelected,
    required this.cupertinoIcon,
    required this.cupertinoIconSelected,
  });

  final String label;
  final IconData materialIcon;
  final IconData materialIconSelected;
  final IconData cupertinoIcon;
  final IconData cupertinoIconSelected;
}

/// The five primary destinations.
///
/// Deliberately five, not the eleven the web bottom bar carries: a native tab
/// bar holds 3–5 items, and the rest of the web surface (Analytics, GBP, Ads,
/// WhatsApp, Assets) lives behind Projects and Settings where it belongs on a
/// phone rather than being crammed into the bar.
const List<NoboDestination> noboDestinations = <NoboDestination>[
  NoboDestination(
    label: 'Home',
    materialIcon: Icons.home_outlined,
    materialIconSelected: Icons.home_rounded,
    cupertinoIcon: CupertinoIcons.house,
    cupertinoIconSelected: CupertinoIcons.house_fill,
  ),
  NoboDestination(
    label: 'Create',
    materialIcon: Icons.auto_awesome_outlined,
    materialIconSelected: Icons.auto_awesome,
    cupertinoIcon: CupertinoIcons.sparkles,
    cupertinoIconSelected: CupertinoIcons.sparkles,
  ),
  NoboDestination(
    label: 'Projects',
    materialIcon: Icons.grid_view_outlined,
    materialIconSelected: Icons.grid_view_rounded,
    cupertinoIcon: CupertinoIcons.square_stack,
    cupertinoIconSelected: CupertinoIcons.square_stack_fill,
  ),
  NoboDestination(
    label: 'Inbox',
    materialIcon: Icons.notifications_none_rounded,
    materialIconSelected: Icons.notifications_rounded,
    cupertinoIcon: CupertinoIcons.tray,
    cupertinoIconSelected: CupertinoIcons.tray_fill,
  ),
  NoboDestination(
    label: 'Business',
    materialIcon: Icons.people_outline_rounded,
    materialIconSelected: Icons.people_rounded,
    cupertinoIcon: CupertinoIcons.person_2,
    cupertinoIconSelected: CupertinoIcons.person_2_fill,
  ),
];

/// Android bottom navigation — Material 3 [NavigationBar] with the app's own
/// indicator and type treatment, sitting on a hairline rather than a shadow.
class AndroidNavBar extends StatelessWidget {
  const AndroidNavBar({
    required this.currentIndex,
    required this.onSelected,
    required this.badges,
    super.key,
  });

  final int currentIndex;
  final ValueChanged<int> onSelected;

  /// Badge counts keyed by destination index.
  final Map<int, int> badges;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(top: BorderSide(color: c.border)),
      ),
      child: SafeArea(
        top: false,
        child: NavigationBar(
          selectedIndex: currentIndex,
          onDestinationSelected: onSelected,
          backgroundColor: Colors.transparent,
          elevation: 0,
          destinations: <Widget>[
            for (int i = 0; i < noboDestinations.length; i++)
              NavigationDestination(
                icon: _withBadge(
                  Icon(
                    noboDestinations[i].materialIcon,
                    size: 23,
                    color: c.inkTertiary,
                  ),
                  badges[i] ?? 0,
                ),
                selectedIcon: _withBadge(
                  Icon(
                    noboDestinations[i].materialIconSelected,
                    size: 23,
                    color: c.primary,
                  ),
                  badges[i] ?? 0,
                ),
                label: noboDestinations[i].label,
                tooltip: '',
              ),
          ],
        ),
      ),
    );
  }

  Widget _withBadge(Widget icon, int count) {
    if (count <= 0) return icon;
    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        icon,
        Positioned(top: -5, right: -11, child: NoboBadge(count: count)),
      ],
    );
  }
}

/// iOS tab bar — a real [CupertinoTabBar], which is a translucent bar with the
/// system's own blur, hairlines and hit behaviour.
class IosTabBar extends StatelessWidget {
  const IosTabBar({
    required this.currentIndex,
    required this.onSelected,
    required this.badges,
    super.key,
  });

  final int currentIndex;
  final ValueChanged<int> onSelected;
  final Map<int, int> badges;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool isDark = Theme.of(context).brightness == Brightness.dark;

    return CupertinoTabBar(
      currentIndex: currentIndex,
      onTap: onSelected,
      backgroundColor: c.surface.withValues(alpha: isDark ? 0.86 : 0.90),
      inactiveColor: c.inkTertiary,
      activeColor: c.primary,
      border: Border(top: BorderSide(color: c.border, width: 0.5)),
      height: 52,
      iconSize: 25,
      items: <BottomNavigationBarItem>[
        for (int i = 0; i < noboDestinations.length; i++)
          BottomNavigationBarItem(
            icon: _badged(
              Icon(
                noboDestinations[i].cupertinoIcon,
                size: 25,
                color: c.inkTertiary,
              ),
              badges[i] ?? 0,
            ),
            activeIcon: _badged(
              Icon(
                noboDestinations[i].cupertinoIconSelected,
                size: 25,
                color: c.primary,
              ),
              badges[i] ?? 0,
            ),
            label: noboDestinations[i].label,
          ),
      ],
    );
  }

  Widget _badged(Widget icon, int count) {
    if (count <= 0) return icon;
    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        icon,
        Positioned(top: -4, right: -12, child: NoboBadge(count: count)),
      ],
    );
  }
}

/// A large, iOS-style screen title that collapses into the nav bar on scroll.
/// Android screens use a Material large app bar instead — see [AndroidLargeHeader].
class IosLargeTitle extends StatelessWidget {
  const IosLargeTitle({
    required this.title,
    this.trailing,
    this.leading,
    super.key,
  });

  final String title;
  final Widget? trailing;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        NoboSpace.gutter,
        NoboSpace.sm,
        NoboSpace.md,
        NoboSpace.sm,
      ),
      child: Row(
        children: <Widget>[
          if (leading != null) ...<Widget>[leading!, const SizedBox(width: 8)],
          Expanded(
            child: Text(
              title,
              style: NoboType.display.copyWith(color: c.ink, fontSize: 33),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Android section header: tighter, sentence case, with the action inline.
class AndroidLargeHeader extends StatelessWidget {
  const AndroidLargeHeader({
    required this.title,
    this.subtitle,
    this.trailing,
    super.key,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        NoboSpace.gutter,
        NoboSpace.md,
        NoboSpace.md,
        NoboSpace.sm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: NoboType.title.copyWith(color: c.ink)),
                if (subtitle != null) ...<Widget>[
                  const SizedBox(height: 3),
                  Text(
                    subtitle!,
                    style: NoboType.caption.copyWith(color: c.inkSecondary),
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Small helper so screens can pick the platform-correct header in one line.
Widget platformHeader({
  required String title,
  String? subtitle,
  Widget? trailing,
}) {
  return NoboPlatform.isIOS
      ? IosLargeTitle(title: title, trailing: trailing)
      : AndroidLargeHeader(title: title, subtitle: subtitle, trailing: trailing);
}
