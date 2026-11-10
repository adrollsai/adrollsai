import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/demo/demo_workspace.dart';
import '../data/live_workspace.dart';
import '../data/local/session_repository.dart';
import '../data/models/agent.dart';
import '../data/models/comms.dart';
import '../data/models/profile.dart';
import '../data/remote/nobo_http.dart';
import '../data/repositories/agent_repository.dart';
import '../data/repositories/auth_repository.dart';
import '../data/repositories/workspace_repository.dart';
import '../data/workspace_source.dart';
import 'config/nobo_env.dart';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

final Provider<SupabaseClient> supabaseClientProvider = Provider<SupabaseClient>(
  (Ref ref) => Supabase.instance.client,
  name: 'supabaseClient',
);

final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>(
      (Ref ref) => AuthRepository(ref.watch(supabaseClientProvider)),
      name: 'authRepository',
    );

final Provider<NoboHttp> noboHttpProvider = Provider<NoboHttp>((Ref ref) {
  final NoboHttp http = NoboHttp(auth: ref.watch(authRepositoryProvider));
  ref.onDispose(http.dispose);
  return http;
}, name: 'noboHttp');

final Provider<WorkspaceRepository> workspaceRepositoryProvider =
    Provider<WorkspaceRepository>(
      (Ref ref) => WorkspaceRepository(
        client: ref.watch(supabaseClientProvider),
        auth: ref.watch(authRepositoryProvider),
        http: ref.watch(noboHttpProvider),
      ),
      name: 'workspaceRepository',
    );

final Provider<AgentRepository> agentRepositoryProvider =
    Provider<AgentRepository>(
      (Ref ref) => AgentRepository(
        http: ref.watch(noboHttpProvider),
        auth: ref.watch(authRepositoryProvider),
      ),
      name: 'agentRepository',
    );

final Provider<SessionRepository> sessionRepositoryProvider =
    Provider<SessionRepository>((Ref ref) => SessionRepository(),
        name: 'sessionRepository');

/// True when the app must run on the seeded dataset: either explicitly asked
/// for, or because no Supabase credentials were compiled in.
final Provider<bool> demoModeProvider = Provider<bool>(
  (Ref ref) => NoboEnv.demoMode || !NoboEnv.isConfigured,
  name: 'demoMode',
);

final Provider<WorkspaceSource> workspaceSourceProvider =
    Provider<WorkspaceSource>((Ref ref) {
      if (ref.watch(demoModeProvider)) return const DemoWorkspace();
      return LiveWorkspace(ref.watch(workspaceRepositoryProvider));
    }, name: 'workspaceSource');

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

/// User's appearance preference. [ThemeMode.system] follows the OS, which is
/// what both platforms expect by default.
class ThemeModeController extends Notifier<ThemeMode> {
  ThemeModeController({this.initial = ThemeMode.system});

  final ThemeMode initial;

  @override
  ThemeMode build() => initial;

  void set(ThemeMode mode) => state = mode;

  void cycle() {
    state = switch (state) {
      ThemeMode.system => ThemeMode.light,
      ThemeMode.light => ThemeMode.dark,
      ThemeMode.dark => ThemeMode.system,
    };
  }
}

final NotifierProvider<ThemeModeController, ThemeMode> themeModeProvider =
    NotifierProvider<ThemeModeController, ThemeMode>(
      ThemeModeController.new,
      name: 'themeMode',
    );

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/// How far a cold start has got.
///
/// The app paints before it is initialised — the splash is on screen while
/// credentials, preferences and the backend are still being wired up — so
/// "the UI exists" and "the app is usable" are two different moments.
enum NoboBootPhase {
  /// Flutter is painting, but the data layer may not be ready to serve a query.
  starting,

  /// Everything the first screen needs is in place; the splash may lift.
  ready,
}

/// Owns [NoboBootPhase]. The boot sequence drives it; the splash gate reads it.
class NoboBootController extends Notifier<NoboBootPhase> {
  @override
  NoboBootPhase build() => NoboBootPhase.starting;

  void markReady() {
    if (state != NoboBootPhase.ready) state = NoboBootPhase.ready;
  }
}

final NotifierProvider<NoboBootController, NoboBootPhase> noboBootPhaseProvider =
    NotifierProvider<NoboBootController, NoboBootPhase>(
      NoboBootController.new,
      name: 'bootPhase',
    );

// ---------------------------------------------------------------------------
// Session / account
// ---------------------------------------------------------------------------

/// Supabase auth state stream — drives redirects and data invalidation.
final StreamProvider<AuthState> authStateProvider = StreamProvider<AuthState>(
  (Ref ref) => ref.watch(authRepositoryProvider).changes,
  name: 'authState',
);

/// True once a session exists. In demo mode always true, so the shell renders.
final Provider<bool> signedInProvider = Provider<bool>((Ref ref) {
  if (ref.watch(demoModeProvider)) return true;
  final AuthState? s = ref.watch(authStateProvider).value;
  return (s?.session ?? ref.watch(authRepositoryProvider).currentSession) !=
      null;
}, name: 'signedIn');

/// Holds the signed-in tenant profile and reacts to Supabase auth changes.
class AccountController extends AsyncNotifier<NoboProfile?> {
  @override
  Future<NoboProfile?> build() async {
    // Check demo mode first: in demo there is no Supabase instance to touch.
    if (ref.watch(demoModeProvider)) {
      return const NoboProfile(
        id: 'demo-user',
        email: 'demo@nobogent.com',
        fullName: 'Aarav Sharma',
        businessName: 'Nobogent Realty',
        role: 'super_admin',
        avatarUrl: null,
        logoUrl: null,
        credits: 1840,
        subscriptionPlan: 'growth',
        subscriptionStatus: 'active',
        contactNumber: '+91 90000 00000',
        industry: 'Real estate',
        onboardingCompleted: true,
        clientFeatures: <String>[],
      );
    }

    // React to sign-in / sign-out / token refresh so cached workspace data is
    // dropped the moment the account changes.
    final AuthRepository auth = ref.watch(authRepositoryProvider);
    ref.listen<AsyncValue<AuthState>>(authStateProvider, (
      AsyncValue<AuthState>? prev,
      AsyncValue<AuthState> next,
    ) {
      final String? before = prev?.value?.session?.user.id;
      final String? after = next.value?.session?.user.id;
      if (before != after) {
        ref.invalidate(sessionsProvider);
        ref.invalidate(projectsProvider);
        ref.invalidate(assetsProvider);
        ref.invalidate(leadsProvider);
        ref.invalidate(noticesProvider);
      }
    });

    final User? user = auth.currentUser;
    if (user == null) return null;
    try {
      return await auth.fetchProfile(user.id);
    } catch (_) {
      return null;
    }
  }

  Future<void> signIn(String email, String password) async {
    state = const AsyncValue<NoboProfile?>.loading();
    final AuthRepository auth = ref.read(authRepositoryProvider);
    state = await AsyncValue.guard(() => auth.signIn(email, password));
  }

  Future<void> signUp({
    required String email,
    required String password,
    required String fullName,
    required String businessName,
  }) async {
    state = const AsyncValue<NoboProfile?>.loading();
    final AuthRepository auth = ref.read(authRepositoryProvider);
    state = await AsyncValue.guard(
      () => auth.signUp(
        email: email,
        password: password,
        fullName: fullName,
        businessName: businessName,
      ),
    );
  }

  Future<void> signOut() async {
    if (ref.read(demoModeProvider)) {
      state = const AsyncValue<NoboProfile?>.data(null);
      return;
    }
    await ref.read(authRepositoryProvider).signOut();
    ref.invalidate(sessionsProvider);
    state = const AsyncValue<NoboProfile?>.data(null);
  }

  Future<void> refresh() async {
    final AuthRepository auth = ref.read(authRepositoryProvider);
    final User? user = auth.currentUser;
    if (user == null) {
      state = const AsyncValue<NoboProfile?>.data(null);
      return;
    }
    state = await AsyncValue.guard(() => auth.fetchProfile(user.id));
  }
}

final AsyncNotifierProvider<AccountController, NoboProfile?> accountProvider =
    AsyncNotifierProvider<AccountController, NoboProfile?>(
      AccountController.new,
      name: 'account',
    );

// ---------------------------------------------------------------------------
// Workspace data
// ---------------------------------------------------------------------------

final FutureProvider<List<ProjectSeed>> projectsProvider =
    FutureProvider<List<ProjectSeed>>(
      (Ref ref) => ref.watch(workspaceSourceProvider).projects(),
      name: 'projects',
    );

final FutureProvider<List<AssetSeed>> assetsProvider =
    FutureProvider<List<AssetSeed>>(
      (Ref ref) => ref.watch(workspaceSourceProvider).assets(),
      name: 'assets',
    );

final FutureProvider<List<LeadSeed>> leadsProvider =
    FutureProvider<List<LeadSeed>>(
      (Ref ref) => ref.watch(workspaceSourceProvider).leads(),
      name: 'leads',
    );

final FutureProvider<List<NoticeSeed>> noticesProvider =
    FutureProvider<List<NoticeSeed>>(
      (Ref ref) => ref.watch(workspaceSourceProvider).notices(),
      name: 'notices',
    );

final assetsForProjectProvider =
    FutureProvider.family<List<AssetSeed>, String?>((Ref ref, String? id) async {
      final List<AssetSeed> all = await ref.watch(assetsProvider.future);
      if (id == null) return all;
      return all.where((AssetSeed a) => a.projectId == id).toList();
    }, name: 'assetsForProject');

// ---------------------------------------------------------------------------
// Ads and communications
// ---------------------------------------------------------------------------

final FutureProvider<List<NoboCampaign>> campaignsProvider =
    FutureProvider<List<NoboCampaign>>((Ref ref) {
      if (ref.watch(demoModeProvider)) {
        return Future.value(const <NoboCampaign>[]);
      }
      return ref.watch(workspaceRepositoryProvider).campaigns();
    }, name: 'campaigns');

final FutureProvider<List<WhatsAppChat>> whatsappChatsProvider =
    FutureProvider<List<WhatsAppChat>>((Ref ref) {
      if (ref.watch(demoModeProvider)) {
        return Future.value(const <WhatsAppChat>[]);
      }
      return ref.watch(workspaceRepositoryProvider).whatsappChats();
    }, name: 'whatsappChats');

final FutureProvider<List<WhatsAppBroadcast>> broadcastsProvider =
    FutureProvider<List<WhatsAppBroadcast>>((Ref ref) {
      if (ref.watch(demoModeProvider)) {
        return Future.value(const <WhatsAppBroadcast>[]);
      }
      return ref.watch(workspaceRepositoryProvider).whatsappBroadcasts();
    }, name: 'broadcasts');

final FutureProvider<List<WhatsAppFlow>> whatsappFlowsProvider =
    FutureProvider<List<WhatsAppFlow>>((Ref ref) {
      if (ref.watch(demoModeProvider)) {
        return Future.value(const <WhatsAppFlow>[]);
      }
      return ref.watch(workspaceRepositoryProvider).whatsappFlows();
    }, name: 'whatsappFlows');

final FutureProvider<List<NoboCallLog>> callLogsProvider =
    FutureProvider<List<NoboCallLog>>((Ref ref) {
      if (ref.watch(demoModeProvider)) {
        return Future.value(const <NoboCallLog>[]);
      }
      return ref.watch(workspaceRepositoryProvider).callLogs();
    }, name: 'callLogs');

final whatsappMessagesProvider =
    FutureProvider.family<List<WhatsAppMessage>, String>((
      Ref ref,
      String chatId,
    ) {
      if (ref.watch(demoModeProvider)) {
        return Future.value(const <WhatsAppMessage>[]);
      }
      return ref.watch(workspaceRepositoryProvider).whatsappMessages(chatId);
    }, name: 'whatsappMessages');

// ---------------------------------------------------------------------------
// Task sessions
// ---------------------------------------------------------------------------

/// Owns every task session. Persistence is device-local by design — see
/// [SessionRepository] for the reasoning.
class SessionsController extends AsyncNotifier<List<AgentSession>> {
  @override
  Future<List<AgentSession>> build() async {
    final SessionRepository repo = ref.watch(sessionRepositoryProvider);
    if (ref.watch(demoModeProvider)) {
      await repo.seedIfEmpty(demoSessions());
    }
    return repo.all();
  }

  Future<AgentSession> create({String? projectId, String? projectTitle}) async {
    final DateTime now = DateTime.now();
    final AgentSession session = AgentSession(
      id: 's-${now.microsecondsSinceEpoch}',
      title: 'New task',
      projectId: projectId,
      projectTitle: projectTitle,
      createdAt: now,
      updatedAt: now,
      messages: const <AgentMessage>[],
      state: SessionState.idle,
    );
    final SessionRepository repo = ref.read(sessionRepositoryProvider);
    await repo.upsert(session);
    state = AsyncValue<List<AgentSession>>.data(await repo.all());
    return session;
  }

  Future<void> save(AgentSession session) async {
    final SessionRepository repo = ref.read(sessionRepositoryProvider);
    await repo.upsert(session);
    state = AsyncValue<List<AgentSession>>.data(await repo.all());
  }

  Future<void> delete(String id) async {
    final SessionRepository repo = ref.read(sessionRepositoryProvider);
    await repo.delete(id);
    state = AsyncValue<List<AgentSession>>.data(await repo.all());
  }

  Future<void> rename(String id, String title) async {
    final List<AgentSession> current =
        state.value ?? const <AgentSession>[];
    final int i = current.indexWhere((AgentSession s) => s.id == id);
    if (i < 0) return;
    await save(current[i].copyWith(title: title));
  }
}

final AsyncNotifierProvider<SessionsController, List<AgentSession>>
sessionsProvider =
    AsyncNotifierProvider<SessionsController, List<AgentSession>>(
      SessionsController.new,
      name: 'sessions',
    );

/// Convenience: sessions that still need the owner, newest first.
final Provider<List<AgentSession>> actionNeededSessionsProvider =
    Provider<List<AgentSession>>((Ref ref) {
      final List<AgentSession> all =
          ref.watch(sessionsProvider).value ?? const <AgentSession>[];
      return all
          .where(
            (AgentSession s) =>
                s.state == SessionState.needsYou || s.pendingApprovals > 0,
          )
          .toList(growable: false);
    }, name: 'actionNeededSessions');

/// Total number of things that genuinely block the owner — pending approvals and
/// unanswered agent questions.
///
/// Deliberately excludes unread notification updates: the tab badge must agree
/// with the Inbox header's "N waiting on you" count. Two different numbers on
/// screen at once is worse than a slightly quieter badge.
final Provider<int> attentionCountProvider = Provider<int>((Ref ref) {
  final List<AgentSession> sessions = ref.watch(actionNeededSessionsProvider);
  final int approvals = sessions.fold<int>(
    0,
    (int sum, AgentSession s) => sum + s.pendingApprovals,
  );
  final int questions = sessions.fold<int>(
    0,
    (int sum, AgentSession s) =>
        sum +
        s.messages
            .expand((AgentMessage m) => m.artifacts)
            .where((AgentArtifact a) => a.kind == ArtifactKind.userInputPrompt)
            .length,
  );
  return approvals + questions;
}, name: 'attentionCount');

/// Deterministic clock label helper for greetings.
final Provider<String> greetingProvider = Provider<String>((Ref ref) {
  final int h = DateTime.now().hour;
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}, name: 'greeting');

// Kept for imports that only need the type.
typedef AuthStateStream = Stream<AuthState>;