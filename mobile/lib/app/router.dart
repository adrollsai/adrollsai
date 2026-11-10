import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoPage;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/platform/nobo_platform.dart';
import '../core/providers.dart';
import '../core/ui/navigation.dart';
import '../features/auth/login_screen.dart';
import '../features/pwa/agent_screen.dart';
import '../features/pwa/creation_screen.dart';
import '../features/pwa/notifications_screen.dart';
import '../features/create/session_screen.dart';
import '../features/crm/crm_screen.dart';
import '../features/crm/lead_screen.dart';
import '../features/media/media_viewer_screen.dart';
import '../features/pwa/analytics_screen.dart';
import '../features/pwa/assets_screen.dart';
import '../features/pwa/catalog_screen.dart';
import '../features/settings/settings_screen.dart';

/// Route paths. These mirror the web app's dashboard URLs so the two products
/// share one vocabulary.
abstract final class Routes {
  const Routes._();

  static const String login = '/login';
  static const String analytics = '/analytics';
  static const String nobogent = '/nobogent';
  static const String catalog = '/catalog';
  static const String creation = '/creation';
  static const String ads = '/ads';
  static const String crm = '/crm';
  static const String whatsapp = '/whatsapp';
  static const String gbp = '/gbp';
  static const String gbpAudit = '/gbp-audit';
  static const String assets = '/assets';
  static const String profile = '/profile';
  static const String settings = '/settings';
  static const String notifications = '/notifications';
  static String session(String id) => '/session/$id';
  static String project(String id) => '/project/$id';
  static String lead(String id) => '/lead/$id';
  static String media(String url) => '/media?src=${Uri.encodeComponent(url)}';
}

/// Wraps a screen in the platform's own page transition: Cupertino's horizontal
/// slide with interactive back-swipe on iOS, Material's predictive-back-aware
/// transition on Android.
Page<void> _noboPage<T>({
  required Widget child,
  required GoRouterState state,
}) {
  if (NoboPlatform.isIOS) {
    return CupertinoPage<void>(key: state.pageKey, child: child);
  }
  return MaterialPage<void>(key: state.pageKey, child: child);
}

/// One branch per destination in the web app's navigation, in the same order.
StatefulShellBranch _branch(String path, Widget screen) {
  return StatefulShellBranch(
    routes: <RouteBase>[
      GoRoute(
        path: path,
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(state: state, child: screen),
      ),
    ],
  );
}

final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  // Drives GoRouter's re-evaluation when the session appears or disappears.
  final _AuthRefresh refresh = _AuthRefresh(ref);

  final GoRouter router = GoRouter(
    // The web app sends you to Analytics after sign-in.
    initialLocation: Routes.analytics,
    refreshListenable: refresh,
    // Auth guard: an unauthenticated user only ever sees the sign-in screen.
    // Demo builds skip it so the interface can be reviewed without credentials.
    redirect: (BuildContext context, GoRouterState state) {
      final bool demo = ref.read(demoModeProvider);
      if (demo) return null;
      final bool signedIn =
          ref.read(authRepositoryProvider).currentSession != null;
      final bool onLogin = state.matchedLocation == Routes.login;
      if (!signedIn && !onLogin) return Routes.login;
      if (signedIn && onLogin) return Routes.analytics;
      return null;
    },
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
          _branch(Routes.analytics, const AnalyticsScreen()),
          _branch(Routes.nobogent, const AgentScreen()),
          _branch(Routes.catalog, const CatalogScreen()),
          _branch(Routes.creation, const CreationScreen()),
          _branch(
            Routes.ads,
            const WebToolScreen(
              title: 'AI Ads Manager',
              subtitle: 'Launch and optimise Meta campaigns',
              icon: Icons.bolt_rounded,
              body:
                  'Campaign creation, audience building and ad optimisation '
                  'stay in the web app for now, where the full Meta Ads flow '
                  'lives.',
            ),
          ),
          _branch(Routes.crm, const CrmScreen()),
          _branch(
            Routes.whatsapp,
            const WebToolScreen(
              title: 'WhatsApp Portal',
              subtitle: 'Broadcasts, templates and the chat inbox',
              icon: Icons.chat_bubble_rounded,
              body:
                  'The WhatsApp portal handles template approval and broadcast '
                  'sending in the web app.',
            ),
          ),
          _branch(
            Routes.gbp,
            const WebToolScreen(
              title: 'GBP Suite',
              subtitle: 'Google Business Profile optimisation',
              icon: Icons.place_rounded,
              body:
                  'Posts, reviews, keywords and geotagging for your Google '
                  'Business Profile live in the web app.',
            ),
          ),
          _branch(
            Routes.gbpAudit,
            const WebToolScreen(
              title: 'GBP Audit',
              subtitle: 'Local rank heatmap and profile audit',
              icon: Icons.travel_explore_rounded,
              body:
                  'The free profile audit and local rank heatmap run in the '
                  'web app.',
            ),
          ),
          _branch(Routes.assets, const AssetsScreen()),
          _branch(Routes.profile, const ProfileScreen()),
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
        path: '/lead/:id',
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(
              state: state,
              child: LeadScreen(leadId: state.pathParameters['id']!),
            ),
      ),
      GoRoute(
        path: Routes.notifications,
        pageBuilder: (BuildContext context, GoRouterState state) =>
            _noboPage<void>(
              state: state,
              child: const NotificationsScreen(),
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
  ref.onDispose(() {
    refresh.dispose();
    router.dispose();
  });
  return router;
});

/// The persistent shell: the web app's eleven-destination bar, always visible so
/// the current section is never ambiguous.
class AppShell extends ConsumerWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(bottom: false, child: navigationShell),
      bottomNavigationBar: NoboBottomNav(
        currentIndex: navigationShell.currentIndex,
        onSelected: (int index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
      ),
    );
  }
}
/// Bridges Supabase auth changes into a [Listenable] for GoRouter.
class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(Ref ref) {
    _sub = ref.read(authRepositoryProvider).changes.listen((_) {
      notifyListeners();
    });
  }

  late final StreamSubscription<AuthState> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}