import 'models/asset.dart';
import 'models/inbox_item.dart';
import 'models/lead.dart';
import 'models/project.dart';
import 'repositories/workspace_repository.dart';
import 'workspace_source.dart';

/// Adapter over the live Nobogent backend.
///
/// Maps wire models to the UI projections, so screens stay independent of
/// PostgREST row shapes and of the backend's status quirks.
class LiveWorkspace implements WorkspaceSource {
  const LiveWorkspace(this._repo);

  final WorkspaceRepository _repo;

  @override
  bool get isDemo => false;

  @override
  Future<List<ProjectSeed>> projects() async {
    final List<NoboProject> rows = await _repo.projects();
    final List<NoboAsset> assets = await _repo.assets(limit: 200);
    final Map<String, int> perProject = <String, int>{};
    for (final NoboAsset a in assets) {
      final String? pid = a.projectId;
      if (pid != null) perProject[pid] = (perProject[pid] ?? 0) + 1;
    }
    return rows
        .map(
          (NoboProject p) => (
            id: p.id,
            title: p.title,
            address: p.address,
            cover: p.coverUrl,
            price: p.priceLabel,
            status: p.status,
            type: p.propertyType,
            description: p.description,
            assetCount: perProject[p.id] ?? 0,
            taskCount: 0,
            autoGenerate: p.autoGenerate,
            onLandingPage: p.showOnLandingPage,
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<List<AssetSeed>> assets() async {
    final List<NoboAsset> rows = await _repo.assets();
    return rows
        .map(
          (NoboAsset a) => (
            id: a.id,
            isVideo: a.isVideo,
            preview: a.previewUrl,
            playable: a.playableUrl,
            title: a.displayTitle,
            caption: a.caption,
            createdAt: a.createdAt ?? DateTime.now(),
            projectId: a.projectId,
            durationSeconds: a.durationSeconds,
            status: a.status.name,
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<List<LeadSeed>> leads() async {
    final List<NoboLead> rows = await _repo.leads();
    return rows
        .map(
          (NoboLead l) => (
            id: l.id,
            name: l.name,
            phone: l.phone,
            stage: l.stage,
            source: l.source,
            createdAt: l.createdAt,
            nextFollowup: l.nextFollowup,
            projectId: l.projectId,
            notes: l.notes,
            dnp: l.dnpCount,
            lastCallStatus: l.lastCallStatus,
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<List<NoticeSeed>> notices() async {
    final List<InboxItem> rows = await _repo.notifications();
    return rows
        .map(
          (InboxItem n) => (
            id: n.id,
            kind: switch (n.kind) {
              InboxKind.approval => NoticeKind.approval,
              InboxKind.question => NoticeKind.question,
              InboxKind.taskDone => NoticeKind.done,
              InboxKind.taskFailed => NoticeKind.failed,
              InboxKind.lead => NoticeKind.lead,
              InboxKind.system => NoticeKind.system,
            },
            title: n.title,
            body: n.body,
            createdAt: n.createdAt,
            read: n.isRead,
            actionId: n.actionId,
            sessionId: n.sessionId,
          ),
        )
        .toList(growable: false);
  }
}
