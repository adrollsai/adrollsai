import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../design/nobo_metrics.dart';
import '../design/nobo_type.dart';
import '../platform/nobo_platform.dart';

/// One destination, mirroring the web app's navigation exactly.
///
/// Labels, icons and order are taken from the PWA's `components/BottomNav.tsx`
/// so the native app uses the same vocabulary and the same sequence the owner
/// already knows.
class NoboDestination {
  const NoboDestination({
    required this.label,
    required this.route,
    required this.icon,
    required this.iconSelected,
  });

  final String label;
  final String route;
  final IconData icon;
  final IconData iconSelected;
}

/// The web app's eleven destinations, in the web app's order:
/// Analytics, Nobogent, Catalog, Creation, Ads, CRM, WhatsApp, GBP Suite,
/// GBP Audit, Assets, Profile.
///
/// Nothing is reordered and nothing is merged. The mobile bar scrolls
/// horizontally exactly as the web app's does.
const List<NoboDestination> noboDestinations = <NoboDestination>[
  NoboDestination(
    label: 'Analytics',
    route: '/analytics',
    icon: Icons.bar_chart_outlined,
    iconSelected: Icons.bar_chart_rounded,
  ),
  NoboDestination(
    label: 'Nobogent',
    route: '/nobogent',
    icon: Icons.smart_toy_outlined,
    iconSelected: Icons.smart_toy_rounded,
  ),
  NoboDestination(
    label: 'Catalog',
    route: '/catalog',
    icon: Icons.grid_view_outlined,
    iconSelected: Icons.grid_view_rounded,
  ),
  NoboDestination(
    label: 'Creation',
    route: '/creation',
    icon: Icons.auto_awesome_outlined,
    iconSelected: Icons.auto_awesome,
  ),
  NoboDestination(
    label: 'Ads',
    route: '/ads',
    icon: Icons.bolt_outlined,
    iconSelected: Icons.bolt_rounded,
  ),
  NoboDestination(
    label: 'CRM',
    route: '/crm',
    icon: Icons.people_outline_rounded,
    iconSelected: Icons.people_rounded,
  ),
  NoboDestination(
    label: 'WhatsApp',
    route: '/whatsapp',
    icon: Icons.chat_bubble_outline_rounded,
    iconSelected: Icons.chat_bubble_rounded,
  ),
  NoboDestination(
    label: 'GBP Suite',
    route: '/gbp',
    icon: Icons.place_outlined,
    iconSelected: Icons.place_rounded,
  ),
  NoboDestination(
    label: 'GBP Audit',
    route: '/gbp-audit',
    icon: Icons.travel_explore_outlined,
    iconSelected: Icons.travel_explore_rounded,
  ),
  NoboDestination(
    label: 'Assets',
    route: '/assets',
    icon: Icons.grid_on_outlined,
    iconSelected: Icons.grid_on_rounded,
  ),
  NoboDestination(
    label: 'Profile',
    route: '/profile',
    icon: Icons.person_outline_rounded,
    iconSelected: Icons.person_rounded,
  ),
];

/// The web app's bottom navigation, reproduced.
///
/// Unlike the web version this keeps the **active** destination scrolled into
/// view, because on a phone the act of "not seeing which tab I'm on" was the
/// single most confusing part of the mobile web app.
///
/// Platform behaviour differs, appearance does not: Android items ripple,
/// iOS items use the tap-dip the platform expects.
class NoboBottomNav extends StatefulWidget {
  const NoboBottomNav({
    required this.currentIndex,
    required this.onSelected,
    super.key,
  });

  final int currentIndex;
  final ValueChanged<int> onSelected;

  @override
  State<NoboBottomNav> createState() => _NoboBottomNavState();
}

class _NoboBottomNavState extends State<NoboBottomNav> {
  final ScrollController _controller = ScrollController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _revealActive());
  }

  @override
  void didUpdateWidget(NoboBottomNav old) {
    super.didUpdateWidget(old);
    if (old.currentIndex != widget.currentIndex) _revealActive();
  }

  void _revealActive() {
    if (!_controller.hasClients) return;
    const double itemWidth = 78;
    final double target =
        (widget.currentIndex * itemWidth) - (itemWidth * 1.6);
    final double clamped = target.clamp(
      0.0,
      _controller.position.maxScrollExtent,
    );
    _controller.animateTo(
      clamped,
      duration: NoboMotion.medium,
      curve: NoboMotion.standard,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.surface.withValues(alpha: 0.97),
        border: Border(top: BorderSide(color: c.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 60,
          child: ListView.builder(
            controller: _controller,
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: NoboSpace.sm),
            itemCount: noboDestinations.length,
            itemBuilder: (BuildContext context, int i) => _NavItem(
              destination: noboDestinations[i],
              selected: i == widget.currentIndex,
              onTap: () => widget.onSelected(i),
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatefulWidget {
  const _NavItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final NoboDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_NavItem> createState() => _NavItemState();
}

class _NavItemState extends State<_NavItem> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final Color tint = widget.selected ? c.primary : c.inkTertiary;

    final Widget inner = Container(
      width: 70,
      padding: const EdgeInsets.symmetric(vertical: 5),
      decoration: BoxDecoration(
        // The web app marks the active tab with a light blue rounded block.
        color: widget.selected ? c.primaryWash : Colors.transparent,
        borderRadius: NoboRadius.rMd,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Icon(
            widget.selected
                ? widget.destination.iconSelected
                : widget.destination.icon,
            size: 21,
            color: tint,
          ),
          const SizedBox(height: 3),
          Text(
            widget.destination.label,
            style: NoboType.caption.copyWith(
              fontSize: 10,
              height: 1.1,
              fontWeight: widget.selected ? FontWeight.w700 : FontWeight.w500,
              color: tint,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );

    final Widget tappable = NoboPlatform.isAndroid
        ? Material(
            color: Colors.transparent,
            borderRadius: NoboRadius.rMd,
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: widget.onTap,
              borderRadius: NoboRadius.rMd,
              splashFactory: InkSparkle.splashFactory,
              child: inner,
            ),
          )
        : GestureDetector(
            onTapDown: (_) => setState(() => _down = true),
            onTapUp: (_) => setState(() => _down = false),
            onTapCancel: () => setState(() => _down = false),
            onTap: widget.onTap,
            behavior: HitTestBehavior.opaque,
            child: AnimatedOpacity(
              opacity: _down ? 0.55 : 1,
              duration: NoboMotion.instant,
              child: inner,
            ),
          );

    return Semantics(
      button: true,
      selected: widget.selected,
      label: widget.destination.label,
      child: tappable,
    );
  }
}

/// The page header the web app uses on every dashboard screen: a large bold
/// title, an optional grey subtitle, and trailing circular actions.
class NoboPageHeader extends StatelessWidget {
  const NoboPageHeader({
    required this.title,
    this.subtitle,
    this.actions = const <Widget>[],
    this.eyebrow,
    this.leading,
    super.key,
  });

  final String title;
  final String? subtitle;
  final List<Widget> actions;

  /// Small light-blue uppercase label above the title, as on Analytics.
  final String? eyebrow;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool ios = NoboPlatform.isIOS;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        NoboSpace.gutter,
        NoboSpace.md,
        NoboSpace.gutter,
        NoboSpace.base,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (eyebrow != null) ...<Widget>[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: c.primaryWash,
                borderRadius: NoboRadius.rPill,
              ),
              child: Text(
                eyebrow!.toUpperCase(),
                style: NoboType.micro.copyWith(
                  color: c.primary,
                  fontSize: 10,
                  letterSpacing: 0.6,
                ),
              ),
            ),
            const SizedBox(height: NoboSpace.md),
          ],
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (leading != null) ...<Widget>[
                leading!,
                const SizedBox(width: NoboSpace.md),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      title,
                      style: NoboType.headline.copyWith(
                        color: c.ink,
                        fontSize: ios ? 30 : 28,
                        fontWeight: FontWeight.w700,
                        height: 1.15,
                        letterSpacing: -0.5,
                      ),
                    ),
                    if (subtitle != null) ...<Widget>[
                      const SizedBox(height: 5),
                      Text(
                        subtitle!,
                        style: NoboType.body.copyWith(
                          color: c.inkSecondary,
                          fontSize: 14,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (actions.isNotEmpty) ...<Widget>[
                const SizedBox(width: NoboSpace.sm),
                Column(
                  children: <Widget>[
                    for (int i = 0; i < actions.length; i++) ...<Widget>[
                      if (i > 0) const SizedBox(height: NoboSpace.sm),
                      actions[i],
                    ],
                  ],
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

/// The circular icon button the web app places in page headers (refresh).
class NoboCircleAction extends StatelessWidget {
  const NoboCircleAction({
    required this.icon,
    required this.onTap,
    this.tooltip,
    this.size = 40,
    super.key,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final String? tooltip;
  final double size;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final Widget button = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: c.surface,
        shape: BoxShape.circle,
        border: Border.all(color: c.border),
        boxShadow: NoboElevation.low,
      ),
      child: Icon(icon, size: size * 0.45, color: c.inkSecondary),
    );

    final Widget tappable = NoboPlatform.isAndroid
        ? Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap,
              customBorder: const CircleBorder(),
              child: button,
            ),
          )
        : GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: button,
          );

    final Widget sized = SizedBox(width: size, height: size, child: tappable);
    return tooltip == null ? sized : Tooltip(message: tooltip!, child: sized);
  }
}
