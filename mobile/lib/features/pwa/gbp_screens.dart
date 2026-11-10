import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/nobo_env.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/navigation.dart';
import '../../data/models/profile.dart';
import 'pwa_widgets.dart';

/// Opens the corresponding page in the web app.
///
/// Google Business Profile management (posts, reviews, keywords, geotagging) and
/// the local-rank audit are web-only tools: they drive Google APIs and produce
/// map/heatmap output that has no native equivalent yet. Rather than fake them,
/// the screens present the real workspace context and hand off to the web app.
Future<void> _openWeb(String path) async {
  final Uri uri = Uri.parse('${NoboEnv.apiBaseUrl}$path');
  try {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    // No browser available — nothing else to do.
  }
}

/// GBP Suite — the web app's `/dashboard/gbp`.
class GbpScreen extends ConsumerWidget {
  const GbpScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final NoboProfile? profile = ref.watch(accountProvider).value;

    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        NoboPageHeader(
          title: 'GBP Suite',
          subtitle: 'Google Business Profile optimisation',
          actions: <Widget>[
            NoboCircleAction(
              icon: Icons.open_in_new_rounded,
              onTap: () => _openWeb('/dashboard/gbp'),
              tooltip: 'Open in web app',
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
          child: Column(
            children: <Widget>[
              PwaCard(
                child: Row(
                  children: <Widget>[
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: c.primaryWash,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.place_rounded,
                        size: 21,
                        color: c.primary,
                      ),
                    ),
                    const SizedBox(width: NoboSpace.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            profile?.workspaceName ?? 'Your business',
                            style: NoboType.label.copyWith(
                              color: c.ink,
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            profile?.industry ?? 'Google Business Profile',
                            style: NoboType.caption.copyWith(
                              color: c.inkSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: NoboSpace.base),
              const _ToolRow(
                icon: Icons.article_outlined,
                title: 'Posts',
                body: 'Publish updates, offers and events to your profile.',
              ),
              const _ToolRow(
                icon: Icons.star_outline_rounded,
                title: 'Reviews',
                body: 'Read and respond to Google reviews.',
              ),
              const _ToolRow(
                icon: Icons.photo_outlined,
                title: 'Photos',
                body: 'Manage the images that appear on your listing.',
              ),
              const _ToolRow(
                icon: Icons.tag_rounded,
                title: 'Keywords',
                body: 'Track the searches your profile ranks for.',
              ),
              const _ToolRow(
                icon: Icons.my_location_rounded,
                title: 'Geotagging',
                body: 'Add location data to listing images.',
              ),
              const SizedBox(height: NoboSpace.base),
              PwaPrimaryButton(
                label: 'Open GBP Suite in the web app',
                icon: Icons.open_in_new_rounded,
                onPressed: () => _openWeb('/dashboard/gbp'),
              ),
            ],
          ),
        ),
        const SizedBox(height: NoboSpace.xxl),
      ],
    );
  }
}

class _ToolRow extends StatelessWidget {
  const _ToolRow({
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
    return Padding(
      padding: const EdgeInsets.only(bottom: NoboSpace.sm),
      child: PwaCard(
        padding: const EdgeInsets.all(NoboSpace.md),
        onTap: () => _openWeb('/dashboard/gbp'),
        child: Row(
          children: <Widget>[
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: c.surfaceSunken,
                borderRadius: NoboRadius.rSm,
              ),
              child: Icon(icon, size: 17, color: c.inkSecondary),
            ),
            const SizedBox(width: NoboSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: NoboType.label.copyWith(
                      color: c.ink,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    body,
                    style: NoboType.caption.copyWith(
                      color: c.inkSecondary,
                      fontSize: 11.5,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: c.inkTertiary,
            ),
          ],
        ),
      ),
    );
  }
}

/// GBP Audit — the web app's `/dashboard/gbp-audit`.
class GbpAuditScreen extends ConsumerWidget {
  const GbpAuditScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;

    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        const NoboPageHeader(
          title: 'GBP Audit',
          subtitle: 'Local rank heatmap and profile audit',
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NoboSpace.gutter),
          child: Column(
            children: <Widget>[
              PwaCard(
                child: Column(
                  children: <Widget>[
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: c.primaryWash,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.travel_explore_rounded,
                        size: 26,
                        color: c.primary,
                      ),
                    ),
                    const SizedBox(height: NoboSpace.base),
                    Text(
                      'Free Google Business Profile audit',
                      textAlign: TextAlign.center,
                      style: NoboType.subtitle.copyWith(
                        color: c.ink,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'The audit scans your profile for gaps, measures where you '
                      'rank across a grid of local points, and returns a heatmap '
                      'with prioritised fixes. It runs on Google Places data and '
                      'renders a map, so it stays in the web app.',
                      textAlign: TextAlign.center,
                      style: NoboType.caption.copyWith(
                        color: c.inkSecondary,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: NoboSpace.base),
                    PwaPrimaryButton(
                      label: 'Run an audit in the web app',
                      icon: Icons.open_in_new_rounded,
                      onPressed: () => _openWeb('/dashboard/gbp-audit'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: NoboSpace.base),
              PwaCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const PwaLabel('What the audit checks'),
                    const SizedBox(height: NoboSpace.md),
                    for (final String item in <String>[
                      'Profile completeness and category accuracy',
                      'Keyword coverage against your service area',
                      'Review volume, rating and response rate',
                      'Photo coverage and geotagging',
                      'Local rank across a 5×5 grid of search points',
                    ])
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Icon(
                              Icons.check_circle_outline_rounded,
                              size: 15,
                              color: c.positive,
                            ),
                            const SizedBox(width: NoboSpace.sm),
                            Expanded(
                              child: Text(
                                item,
                                style: NoboType.caption.copyWith(
                                  color: c.inkSecondary,
                                  height: 1.4,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: NoboSpace.xxl),
      ],
    );
  }
}
