import 'package:flutter/cupertino.dart' show CupertinoPage;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/platform/nobo_platform.dart';
import '../core/providers.dart';
import '../core/ui/navigation.dart';
import '../features/auth/login_screen.dart';
import '../features/create/create_screen.dart';
import '../features/create/session_screen.dart';
import '../features/crm/crm_screen.dart';
import '../features/crm/lead_screen.dart';
import '../features/home/home_screen.dart';
import '../features/inbox/inbox_screen.dart';
import '../features/media/media_viewer_screen.dart';
import '../features/projects/project_screen.dart';
import '../features/projects/projects_screen.dart';
import '../features/settings/settings_screen.dart';

/// Route paths, kept in one place so navigation calls cannot drift.
abstract final class Routes {
  const Routes._();

  static const String login = '/login';
  static const String home = '/home';
  static const String create = '/create';
  static const String projects = '/projects';
  static const String inbox = '/inbox';
  static const String crm = '/business';
  static const String settings = '/settings';
  static String session(String id) => '/session/$id';
  static String project(String id) => '/project/$id';
  static String lead(String id) => '/lead/$id';
  static String media(String url) =>
      '/media?src=${Uri.encodeComponent(url)}';
}

/// Wraps a screen in the platform's own page transition.
///
/// iOS gets the horizontal slide plus interactive back-swipe; Android gets
/// Material's predictive-back-aware transition.
Page<void> _noboPage<T>({
  required Widget child,
  required GoRouterState state,
}) {
  if (NoboPlatform.isIOS) {
    return CupertinoPage<void>(key: state.pageKey, child: child);
  }
  return MaterialPage<void>(key: state.pageKey, child: child);
}

final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  final GoRouter router = GoRouter(
    initialLocation: Routes.home,
    routes: <RouteBase>[
      GoRoute(
        path: Routes.login,
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(state: state, child: const LoginScreen()),
      ),
      StatefulShellRoute.indexedStack(
        builder:
            (
              BuildContext context,
              GoRouterState state,
              StatefulNavigationShell shell,
            ) => AppShell(navigationShell: shell),
        branches: <StatefulShellBranch>[
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: Routes.home,
                pageBuilder: (BuildContext context, GoRouterState state) =>
                    _noboPage<void>(state: state, child: const HomeScreen()),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: Routes.create,
                pageBuilder: (BuildContext context, GoRouterState state) =>
                    _noboPage<void>(
                      state: state,
                      child: CreateScreen(
                        initialPrompt: state.uri.queryParameters['prompt'],
                      ),
                    ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: Routes.projects,
                pageBuilder: (BuildContext context, GoRouterState state) =>
                    _noboPage<void>(
                      state: state,
                      child: const ProjectsScreen(),
                    ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: Routes.inbox,
                pageBuilder: (BuildContext context, GoRouterState state) =>
                    _noboPage<void>(state: state, child: const InboxScreen()),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: Routes.crm,
                pageBuilder: (BuildContext context, GoRouterState state) =>
                    _noboPage<void>(state: state, child: const CrmScreen()),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/session/:id',
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(
              state: state,
              child: SessionScreen(
                sessionId: state.pathParameters['id']!,
                initialPrompt: state.uri.queryParameters['prompt'],
                initialTitle: state.uri.queryParameters['title'],
              ),
            ),
      ),
      GoRoute(
        path: '/project/:id',
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(
              state: state,
              child: ProjectScreen(projectId: state.pathParameters['id']!),
            ),
      ),
      GoRoute(
        path: '/lead/:id',
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(
              state: state,
              child: LeadScreen(leadId: state.pathParameters['id']!),
            ),
      ),
      GoRoute(
        path: Routes.settings,
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(state: state, child: const SettingsScreen()),
      ),
      GoRoute(
        path: '/media',
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(
              state: state,
              child: MediaViewerScreen(
                source: state.uri.queryParameters['src'] ?? '',
                isVideo: state.uri.queryParameters['video'] == '1',
              ),
            ),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

/// The persistent shell around the five primary destinations.
class AppShell extends ConsumerWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int attention = ref.watch(attentionCountProvider);
    final Map<int, int> badges = <int, int>{3: attention};

    void onSelected(int index) {
      navigationShell.goBranch(
        index,
        // Tapping the current tab returns it to its root, which is the
        // behaviour users expect on both platforms.
        initialLocation: index == navigationShell.currentIndex,
      );
    }

    if (NoboPlatform.isIOS) {
      return Scaffold(
        // Let content flow under the translucent iOS tab bar.
        extendBody: true,
        body: navigationShell,
        bottomNavigationBar: IosTabBar(
          currentIndex: navigationShell.currentIndex,
          onSelected: onSelected,
          badges: badges,
        ),
      );
    }

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: AndroidNavBar(
        currentIndex: navigationShell.currentIndex,
        onSelected: onSelected,
        badges: badges,
      ),
    );
  }
}
