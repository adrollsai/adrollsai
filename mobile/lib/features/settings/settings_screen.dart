import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/router.dart';
import '../../core/config/nobo_env.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/platform/nobo_platform.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../core/ui/controls.dart';
import '../../core/ui/media.dart';
import '../../core/ui/orbit_mark.dart';
import '../../core/ui/surfaces.dart';
import '../../data/models/profile.dart';

/// Account, workspace and appearance.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NoboColors c = context.nobo;
    final NoboProfile? profile = ref.watch(accountProvider).value;
    final ThemeMode mode = ref.watch(themeModeProvider);
    final bool demo = ref.watch(demoModeProvider);

    return Scaffold(
      backgroundColor: c.canvas,
      appBar: AppBar(
        leading: IconButton(
          icon: Icon(
            NoboPlatform.isIOS
                ? Icons.arrow_back_ios_new_rounded
                : Icons.arrow_back_rounded,
            size: 20,
          ),
          onPressed: () => context.pop(),
        ),
        title: Text(
          'Settings',
          style: NoboType.bodyStrong.copyWith(color: c.ink),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          NoboSpace.gutter,
          0,
          NoboSpace.gutter,
          NoboSpace.xxl,
        ),
        children: <Widget>[
          NoboCard(
            child: Row(
              children: <Widget>[
                NoboAvatar(
                  name: profile?.displayName ?? 'Nobogent',
                  imageUrl: profile?.avatarUrl,
                  size: 52,
                ),
                const SizedBox(width: NoboSpace.base),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        profile?.displayName ?? 'Not signed in',
                        style: NoboType.subtitle.copyWith(color: c.ink),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (profile?.email != null)
                        Text(
                          profile!.email!,
                          style: NoboType.caption.copyWith(
                            color: c.inkSecondary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      const SizedBox(height: NoboSpace.sm),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: <Widget>[
                          if (profile != null)
                            NoboPill(
                              label: profile.workspaceName,
                              tone: NoboPillTone.neutral,
                              dense: true,
                            ),
                          if (profile != null)
                            NoboPill(
                              label: (profile.subscriptionPlan ?? 'free')
                                  .toUpperCase(),
                              tone: NoboPillTone.brand,
                              dense: true,
                            ),
                          if (demo)
                            const NoboPill(
                              label: 'Demo data',
                              tone: NoboPillTone.caution,
                              dense: true,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const NoboSectionHeader(title: 'Appearance'),
          NoboCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                NoboSegmented<ThemeMode>(
                  selected: mode,
                  onChanged: (ThemeMode m) =>
                      ref.read(themeModeProvider.notifier).set(m),
                  segments: const <({ThemeMode value, String label})>[
                    (value: ThemeMode.system, label: 'System'),
                    (value: ThemeMode.light, label: 'Light'),
                    (value: ThemeMode.dark, label: 'Dark'),
                  ],
                ),
                const SizedBox(height: NoboSpace.md),
                Text(
                  'System follows your phone. Both themes are hand-tuned — '
                  'dark is not an inverted light theme.',
                  style: NoboType.caption.copyWith(color: c.inkTertiary),
                ),
              ],
            ),
          ),

          const NoboSectionHeader(title: 'Workspace'),
          NoboCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: <Widget>[
                _Row(
                  icon: Icons.bolt_rounded,
                  label: 'Credits',
                  value: profile == null
                      ? '—'
                      : profile.credits.toStringAsFixed(0),
                  tone: c.credit,
                ),
                Divider(height: 1, color: c.hairline),
                _Row(
                  icon: Icons.workspaces_outline,
                  label: 'Business',
                  value: profile?.workspaceName ?? '—',
                ),
                Divider(height: 1, color: c.hairline),
                _Row(
                  icon: Icons.badge_outlined,
                  label: 'Role',
                  value: profile?.role ?? '—',
                ),
                Divider(height: 1, color: c.hairline),
                _Row(
                  icon: Icons.verified_user_outlined,
                  label: 'Nobogent AI',
                  value: (profile?.canUseAgent ?? false) ? 'Enabled' : 'Locked',
                  tone: (profile?.canUseAgent ?? false)
                      ? c.positive
                      : c.inkTertiary,
                ),
              ],
            ),
          ),

          const NoboSectionHeader(title: 'About'),
          NoboCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: <Widget>[
                const _Row(
                  icon: Icons.info_outline_rounded,
                  label: 'Version',
                  value: '2.0.0 (4)',
                ),
                Divider(height: 1, color: c.hairline),
                _Row(
                  icon: Icons.dns_outlined,
                  label: 'Backend',
                  value: NoboEnv.isConfigured
                      ? Uri.tryParse(NoboEnv.apiBaseUrl)?.host ?? 'configured'
                      : 'Not configured (demo)',
                ),
                Divider(height: 1, color: c.hairline),
                _Row(
                  icon: Icons.phone_iphone_rounded,
                  label: 'Experience',
                  value: NoboPlatform.isIOS
                      ? 'iOS · Human Interface Guidelines'
                      : 'Android · Material 3',
                ),
                Divider(height: 1, color: c.hairline),
                _TapRow(
                  icon: Icons.description_outlined,
                  label: 'Privacy policy',
                  onTap: () => launchUrl(
                    Uri.parse('https://nobogent.com/privacy-policy'),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
              ],
            ),
          ),

          const NoboSectionHeader(title: 'Session'),
          NoboButton(
            label: 'Sign out',
            variant: NoboButtonVariant.outline,
            icon: Icons.logout_rounded,
            expand: true,
            onPressed: () async {
              final bool ok = await showNoboConfirm(
                context: context,
                title: 'Sign out?',
                message:
                    'Your tasks stay on this device. You will need to sign in '
                    'again to reach your workspace.',
                confirmLabel: 'Sign out',
                destructive: true,
              );
              if (!ok || !context.mounted) return;
              await ref.read(accountProvider.notifier).signOut();
              if (context.mounted) context.go(Routes.login);
            },
          ),

          const SizedBox(height: NoboSpace.xl),
          Center(
            child: Column(
              children: <Widget>[
                const OrbitMark(size: 34),
                const SizedBox(height: NoboSpace.sm),
                Text(
                  'nobogent',
                  style: NoboType.label.copyWith(
                    color: c.inkTertiary,
                    letterSpacing: -0.3,
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

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.label,
    required this.value,
    this.tone,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: NoboSpace.base,
        vertical: NoboSpace.md,
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 16, color: c.inkTertiary),
          const SizedBox(width: NoboSpace.md),
          Expanded(
            child: Text(
              label,
              style: NoboType.body.copyWith(color: c.ink),
            ),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 190),
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: NoboType.caption.copyWith(
                color: tone ?? c.inkSecondary,
                fontWeight: tone != null ? FontWeight.w600 : FontWeight.w400,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _TapRow extends StatelessWidget {
  const _TapRow({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: NoboSpace.base,
          vertical: NoboSpace.md,
        ),
        child: Row(
          children: <Widget>[
            Icon(icon, size: 16, color: c.inkTertiary),
            const SizedBox(width: NoboSpace.md),
            Expanded(
              child: Text(
                label,
                style: NoboType.body.copyWith(color: c.ink),
              ),
            ),
            Icon(
              Icons.open_in_new_rounded,
              size: 14,
              color: c.inkTertiary,
            ),
          ],
        ),
      ),
    );
  }
}