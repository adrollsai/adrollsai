import 'models/agent.dart';

/// A project as the UI presents it.
///
/// Kept separate from the wire model so the interface is not coupled to
/// PostgREST row shapes.
typedef ProjectView = ({String id, String title, String? cover, String price, String status});

/// The read surface every screen depends on.
///
/// Two implementations exist: one talks to the live Nobogent backend, one
/// serves a seeded dataset so the interface can be reviewed and screenshot-
/// tested on a machine with no credentials. Screens never know which they have.
abstract interface class WorkspaceSource {
  bool get isDemo;

  Future<List<ProjectSeed>> projects();

  Future<List<AssetSeed>> assets();

  Future<List<LeadSeed>> leads();

  Future<List<NoticeSeed>> notices();
}

/// Minimal, UI-facing projections. Using plain records keeps the demo dataset
/// and the live mapping from drifting into two parallel model hierarchies.
typedef ProjectSeed = ({
  String id,
  String title,
  String? address,
  String? cover,
  String price,
  String status,
  String? type,
  String? description,
  int assetCount,
  int taskCount,
  bool autoGenerate,
  bool onLandingPage,
});

typedef AssetSeed = ({
  String id,
  bool isVideo,
  String? preview,
  String? playable,
  String? title,
  String? caption,
  DateTime createdAt,
  String? projectId,
  int? durationSeconds,
  String status,
});

typedef LeadSeed = ({
  String id,
  String name,
  String? phone,
  String stage,
  String? source,
  DateTime? createdAt,
  DateTime? nextFollowup,
  String? projectId,
  String? notes,
  int dnp,
  String? lastCallStatus,
});

typedef NoticeSeed = ({
  String id,
  NoticeKind kind,
  String title,
  String? body,
  DateTime createdAt,
  bool read,
  String? actionId,
  String? sessionId,
});

enum NoticeKind { approval, question, done, failed, lead, system }

/// Seeds used by the demo implementation and by tests.
class DemoSessionSeed {
  const DemoSessionSeed(this.session);
  final AgentSession session;
}
