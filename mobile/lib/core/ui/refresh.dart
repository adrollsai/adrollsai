import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../design/nobo_colors.dart';
import '../platform/nobo_platform.dart';

/// A scroll view with the platform's own pull-to-refresh affordance.
///
/// iOS gets [CupertinoSliverRefreshControl] — the rubber-band spinner that only
/// appears past the top edge. Android gets [RefreshIndicator] and its material
/// spinner. Getting this wrong is one of the most noticeable "this is a web app
/// in a shell" tells.
class NoboRefreshScroll extends StatelessWidget {
  const NoboRefreshScroll({
    required this.slivers,
    this.onRefresh,
    this.controller,
    this.padding = const EdgeInsets.only(bottom: 24),
    super.key,
  });

  final List<Widget> slivers;
  final Future<void> Function()? onRefresh;
  final ScrollController? controller;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    final Widget padded = SliverPadding(
      padding: padding,
      sliver: SliverList(
        delegate: SliverChildListDelegate(<Widget>[
          const SizedBox.shrink(),
        ]),
      ),
    );

    if (NoboPlatform.isIOS) {
      return CustomScrollView(
        controller: controller,
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        slivers: <Widget>[
          if (onRefresh != null)
            CupertinoSliverRefreshControl(onRefresh: onRefresh!),
          ...slivers,
          padded,
        ],
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh ?? () async {},
      color: c.primary,
      backgroundColor: c.surface,
      edgeOffset: MediaQuery.paddingOf(context).top + 8,
      child: CustomScrollView(
        controller: controller,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: <Widget>[...slivers, padded],
      ),
    );
  }
}
