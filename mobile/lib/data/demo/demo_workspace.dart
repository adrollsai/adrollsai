import '../models/agent.dart';
import '../workspace_source.dart';

/// Seeded dataset used when the app runs without backend credentials.
///
/// This is real product copy and real media from the Nobogent workspace, not
/// lorem ipsum — the point is that a design review of this build shows what the
/// shipped product will look like.
class DemoWorkspace implements WorkspaceSource {
  const DemoWorkspace();

  @override
  bool get isDemo => true;

  static DateTime get _now => DateTime.now();

  static const String projectAmritha = 'demo-proj-amritha';
  static const String projectBluesquare = 'demo-proj-bluesquare';
  static const String projectSarthak = 'demo-proj-sarthak';

  @override
  Future<List<ProjectSeed>> projects() async {
    return <ProjectSeed>[
      (
        id: projectAmritha,
        title: 'Amritha Vana',
        address: 'Kanakapura Road, Bengaluru',
        cover: 'assets/demo/property_hero.jpg',
        price: '₹1.24 Cr',
        status: 'active',
        type: 'Luxury dome resort plots',
        description:
            'Twelve geodesic dome villas on a forested lakefront estate. '
            'Marketing focus: weekend-buyer leads from Bengaluru South.',
        assetCount: 14,
        taskCount: 3,
        autoGenerate: true,
        onLandingPage: true,
      ),
      (
        id: projectBluesquare,
        title: 'Bluesquare Infra',
        address: 'Sector 82, Mohali',
        cover: 'assets/demo/property_2.jpg',
        price: '₹86.5 L',
        status: 'active',
        type: 'Premium residential floors',
        description:
            '3BHK independent floors with a rooftop clubhouse. Currently '
            'running a Diwali offer campaign.',
        assetCount: 22,
        taskCount: 4,
        autoGenerate: false,
        onLandingPage: true,
      ),
      (
        id: projectSarthak,
        title: 'Sarthak Infra',
        address: 'Aerocity, Mohali',
        cover: 'assets/demo/property_3.jpg',
        price: '₹1.05 Cr',
        status: 'active',
        type: 'Commercial SCO plots',
        description:
            'SCO plots opposite the Aerocity transit corridor. Lead flow is '
            'strong; follow-up speed is the bottleneck.',
        assetCount: 9,
        taskCount: 2,
        autoGenerate: false,
        onLandingPage: false,
      ),
    ];
  }

  @override
  Future<List<AssetSeed>> assets() async {
    final DateTime now = _now;
    return <AssetSeed>[
      (
        id: 'demo-asset-1',
        isVideo: true,
        preview: 'assets/demo/property_hero.jpg',
        playable: null,
        title: 'Diwali film — Amritha Vana',
        caption: 'Sunrise over the dome. A quiet Diwali. Amritha Vana.',
        createdAt: now.subtract(const Duration(minutes: 42)),
        projectId: projectAmritha,
        durationSeconds: 15,
        status: 'ready',
      ),
      (
        id: 'demo-asset-2',
        isVideo: false,
        preview: 'assets/demo/property_2.jpg',
        playable: null,
        title: 'Instagram creative — poolside',
        caption: 'Evenings by the pergola pool.',
        createdAt: now.subtract(const Duration(hours: 2)),
        projectId: projectBluesquare,
        durationSeconds: null,
        status: 'ready',
      ),
      (
        id: 'demo-asset-3',
        isVideo: false,
        preview: 'assets/demo/property_4.jpg',
        playable: null,
        title: 'Interior story frame',
        caption: 'Waking up inside the canopy.',
        createdAt: now.subtract(const Duration(hours: 3)),
        projectId: projectAmritha,
        durationSeconds: null,
        status: 'ready',
      ),
      (
        id: 'demo-asset-4',
        isVideo: true,
        preview: 'assets/demo/property_3.jpg',
        playable: null,
        title: 'Bluesquare Diwali reel',
        caption: 'This Diwali, move into something permanent.',
        createdAt: now.subtract(const Duration(hours: 5)),
        projectId: projectBluesquare,
        durationSeconds: 20,
        status: 'ready',
      ),
      (
        id: 'demo-asset-5',
        isVideo: false,
        preview: 'assets/demo/property_5.jpg',
        playable: null,
        title: 'Orchard walk carousel 1/5',
        caption: 'Five frames for the weekend-buyer audience.',
        createdAt: now.subtract(const Duration(hours: 7)),
        projectId: projectAmritha,
        durationSeconds: null,
        status: 'ready',
      ),
      (
        id: 'demo-asset-6',
        isVideo: false,
        preview: 'assets/demo/property_6.jpg',
        playable: null,
        title: 'Treehouse angle — draft',
        caption: 'Awaiting your approval.',
        createdAt: now.subtract(const Duration(hours: 9)),
        projectId: projectBluesquare,
        durationSeconds: null,
        status: 'ready',
      ),
    ];
  }

  @override
  Future<List<LeadSeed>> leads() async {
    final DateTime now = _now;
    DateTime day(int offset) => now.add(Duration(days: offset));
    return <LeadSeed>[
      (
        id: 'demo-lead-1',
        name: 'Raman Khurana',
        phone: '+91 98140 22318',
        stage: 'Qualified',
        source: 'Meta — Diwali offer',
        createdAt: now.subtract(const Duration(hours: 3)),
        nextFollowup: day(0),
        projectId: projectBluesquare,
        notes: 'Wants a corner unit. Budget flexible up to 92L.',
        dnp: 0,
        lastCallStatus: 'CONNECTED',
      ),
      (
        id: 'demo-lead-2',
        name: 'Priya Menon',
        phone: '+91 90080 71120',
        stage: 'Meeting Scheduled',
        source: 'Website form',
        createdAt: now.subtract(const Duration(hours: 8)),
        nextFollowup: day(1),
        projectId: projectAmritha,
        notes: 'Site visit confirmed for Saturday 11am.',
        dnp: 0,
        lastCallStatus: 'CONNECTED',
      ),
      (
        id: 'demo-lead-3',
        name: 'Amish Gupta',
        phone: '+91 98765 40021',
        stage: 'New Lead',
        source: '99acres',
        createdAt: now.subtract(const Duration(hours: 11)),
        nextFollowup: day(0),
        projectId: projectSarthak,
        notes: null,
        dnp: 0,
        lastCallStatus: null,
      ),
      (
        id: 'demo-lead-4',
        name: 'Gunheer Singh',
        phone: '+91 99887 21190',
        stage: 'Negotiation',
        source: 'Meta — lead form',
        createdAt: now.subtract(const Duration(days: 2)),
        nextFollowup: day(-1),
        projectId: projectBluesquare,
        notes: 'Asking for a 4L discount. Decision expected this week.',
        dnp: 1,
        lastCallStatus: 'CONNECTED',
      ),
      (
        id: 'demo-lead-5',
        name: 'Sneha Iyer',
        phone: '+91 97400 55831',
        stage: 'Contacted',
        source: 'Referral',
        createdAt: now.subtract(const Duration(days: 3)),
        nextFollowup: day(-2),
        projectId: projectAmritha,
        notes: 'Prefers a call after 7pm.',
        dnp: 2,
        lastCallStatus: 'DNP',
      ),
      (
        id: 'demo-lead-6',
        name: 'Vikram Rathore',
        phone: '+91 98110 90045',
        stage: 'Deal Won',
        source: 'Meta — Diwali offer',
        createdAt: now.subtract(const Duration(days: 6)),
        nextFollowup: null,
        projectId: projectSarthak,
        notes: 'Token paid. Documentation in progress.',
        dnp: 0,
        lastCallStatus: 'CONNECTED',
      ),
      (
        id: 'demo-lead-7',
        name: 'Nikhil Bansal',
        phone: '+91 95990 41277',
        stage: 'Follow Up Later',
        source: 'Housing.com',
        createdAt: now.subtract(const Duration(days: 9)),
        nextFollowup: day(4),
        projectId: projectBluesquare,
        notes: 'Waiting on a home loan pre-approval.',
        dnp: 1,
        lastCallStatus: 'CONNECTED',
      ),
    ];
  }

  @override
  Future<List<NoticeSeed>> notices() async {
    final DateTime now = _now;
    return <NoticeSeed>[
      (
        id: 'demo-notice-1',
        kind: NoticeKind.approval,
        title: 'Approve WhatsApp broadcast',
        body:
            'Nobogent prepared a 116-recipient Diwali broadcast for Bluesquare '
            'Infra. Estimated 116 credits.',
        createdAt: now.subtract(const Duration(minutes: 18)),
        read: false,
        actionId: 'act_demo_broadcast',
        sessionId: 'demo-session-2',
      ),
      (
        id: 'demo-notice-2',
        kind: NoticeKind.question,
        title: 'Nobogent needs a decision',
        body:
            'Should the Sarthak Infra follow-up go out in Hindi or English?',
        createdAt: now.subtract(const Duration(minutes: 51)),
        read: false,
        actionId: null,
        sessionId: 'demo-session-3',
      ),
      (
        id: 'demo-notice-3',
        kind: NoticeKind.lead,
        title: '3 new leads from Meta',
        body: 'Diwali offer campaign delivered 3 new leads in the last hour.',
        createdAt: now.subtract(const Duration(hours: 1)),
        read: false,
        actionId: null,
        sessionId: null,
      ),
      (
        id: 'demo-notice-4',
        kind: NoticeKind.done,
        title: 'Diwali film rendered',
        body: 'Your 15-second film for Amritha Vana is ready to review.',
        createdAt: now.subtract(const Duration(minutes: 42)),
        read: true,
        actionId: null,
        sessionId: 'demo-session-1',
      ),
      (
        id: 'demo-notice-5',
        kind: NoticeKind.failed,
        title: 'Reel render failed',
        body:
            'The Bluesquare carousel render stopped at scene 3. Nobogent '
            'retried twice.',
        createdAt: now.subtract(const Duration(hours: 6)),
        read: true,
        actionId: null,
        sessionId: null,
      ),
    ];
  }
}

/// Demo agent transcripts.
///
/// The tool timelines and artifacts mirror exactly what the SSE parser in
/// `AgentRepository` produces from the live endpoint, so the rendering path
/// exercised by these fixtures is the same one used in production.
List<AgentSession> demoSessions() {
  final DateTime now = DateTime.now();

  AgentToolCall tool(
    String id,
    String name,
    ToolRunState state, {
    String? detail,
    int seconds = 2,
  }) {
    return AgentToolCall(
      id: id,
      name: name,
      label: ToolLabels.forTool(name),
      state: state,
      detail: detail,
      startedAt: now.subtract(Duration(minutes: 40, seconds: seconds)),
      finishedAt: state == ToolRunState.running
          ? null
          : now.subtract(const Duration(minutes: 40)),
    );
  }

  final AgentSession diwaliFilm = AgentSession(
    id: 'demo-session-1',
    title: 'Diwali film for Amritha Vana',
    projectId: DemoWorkspace.projectAmritha,
    projectTitle: 'Amritha Vana',
    createdAt: now.subtract(const Duration(hours: 2)),
    updatedAt: now.subtract(const Duration(minutes: 42)),
    state: SessionState.done,
    messages: <AgentMessage>[
      AgentMessage(
        id: 'm1',
        role: AgentRole.user,
        text:
            'Create a 15 second Diwali film for Amritha Vana. Sunrise, the '
            'dome, and a calm voiceover. Vertical for Instagram.',
        reasoning: '',
        artifacts: const <AgentArtifact>[],
        tools: const <AgentToolCall>[],
        at: now.subtract(const Duration(hours: 2)),
        isStreaming: false,
        error: null,
      ),
      AgentMessage(
        id: 'm2',
        role: AgentRole.assistant,
        text:
            'Done. I pulled the sunrise and poolside frames from your Amritha '
            'Vana library, wrote a 15-second vertical script, generated the '
            'voiceover, and rendered the film. It is 9:16 and ready to review.',
        reasoning:
            'Owner asked for a calm Diwali film. Best-performing existing '
            'frames are the sunrise hero and the pergola pool shot. Keep '
            'voiceover under 32 words for a 15s cut.',
        artifacts: const <AgentArtifact>[
          AgentArtifact(
            kind: ArtifactKind.videoPlayer,
            title: 'Diwali film — Amritha Vana (15s, 9:16)',
            url: 'assets/demo/property_hero.jpg',
            actionId: null,
            status: 'ready',
            description: null,
            estimatedCost: null,
            actionType: null,
            question: null,
            options: <String>[],
            bodyText: null,
            durationSeconds: 15,
          ),
        ],
        tools: <AgentToolCall>[
          tool('t1', 'nobogent_inventory_search', ToolRunState.done,
              detail: 'Matched Amritha Vana'),
          tool('t2', 'nobogent_assets_list', ToolRunState.done,
              detail: '14 usable frames'),
          tool('t3', 'sandbox_write_file', ToolRunState.done,
              detail: 'diwali_script.md'),
          tool('t4', 'sandbox_render_video', ToolRunState.done,
              detail: '15s · 1080×1920 · H.264', seconds: 8),
        ],
        at: now.subtract(const Duration(minutes: 42)),
        isStreaming: false,
        error: null,
      ),
    ],
  );

  final AgentSession bluesquareBroadcast = AgentSession(
    id: 'demo-session-2',
    title: 'Diwali WhatsApp broadcast — Bluesquare',
    projectId: DemoWorkspace.projectBluesquare,
    projectTitle: 'Bluesquare Infra',
    createdAt: now.subtract(const Duration(hours: 1)),
    updatedAt: now.subtract(const Duration(minutes: 18)),
    state: SessionState.needsYou,
    messages: <AgentMessage>[
      AgentMessage(
        id: 'm1',
        role: AgentRole.user,
        text:
            'Send the Diwali offer to everyone in the Bluesquare pipeline who '
            'has not been contacted in a week.',
        reasoning: '',
        artifacts: const <AgentArtifact>[],
        tools: const <AgentToolCall>[],
        at: now.subtract(const Duration(hours: 1)),
        isStreaming: false,
        error: null,
      ),
      AgentMessage(
        id: 'm2',
        role: AgentRole.assistant,
        text:
            'I have drafted the broadcast and selected 116 leads whose last '
            'contact was more than seven days ago. Sending spends 116 credits, '
            'so I need your go-ahead before it goes out.',
        reasoning: '',
        artifacts: const <AgentArtifact>[
          AgentArtifact(
            kind: ArtifactKind.actionConfirmation,
            title: 'WhatsApp broadcast to 116 leads',
            url: null,
            actionId: 'act_demo_broadcast',
            status: 'pending',
            description:
                'Template: diwali_offer_2026 · Audience: Bluesquare Infra, '
                'no contact in 7 days · Estimated reach 116.',
            estimatedCost: '116 credits',
            actionType: 'whatsapp_broadcast',
            question: null,
            options: <String>[],
            bodyText: null,
            durationSeconds: null,
          ),
        ],
        tools: <AgentToolCall>[
          tool('t1', 'nobogent_crm_query_leads', ToolRunState.done,
              detail: '116 matching leads'),
          tool('t2', 'nobogent_whatsapp_list_templates', ToolRunState.done,
              detail: 'diwali_offer_2026 approved'),
          tool('t3', 'request_human_approval', ToolRunState.running,
              detail: 'Awaiting your decision'),
        ],
        at: now.subtract(const Duration(minutes: 18)),
        isStreaming: false,
        error: null,
      ),
    ],
  );

  final AgentSession sarthakFollowUp = AgentSession(
    id: 'demo-session-3',
    title: 'Sarthak Infra follow-ups',
    projectId: DemoWorkspace.projectSarthak,
    projectTitle: 'Sarthak Infra',
    createdAt: now.subtract(const Duration(hours: 4)),
    updatedAt: now.subtract(const Duration(minutes: 51)),
    state: SessionState.needsYou,
    messages: <AgentMessage>[
      AgentMessage(
        id: 'm1',
        role: AgentRole.user,
        text: 'Write follow-up messages for the Sarthak leads who went cold.',
        reasoning: '',
        artifacts: const <AgentArtifact>[],
        tools: const <AgentToolCall>[],
        at: now.subtract(const Duration(hours: 4)),
        isStreaming: false,
        error: null,
      ),
      AgentMessage(
        id: 'm2',
        role: AgentRole.assistant,
        text:
            'I have written 9 follow-ups. Before I send them — most of these '
            'leads replied in Hindi last time. Which language should I use?',
        reasoning: '',
        artifacts: const <AgentArtifact>[
          AgentArtifact(
            kind: ArtifactKind.userInputPrompt,
            title: 'Which language?',
            url: null,
            actionId: null,
            status: 'awaiting_user_input',
            description: null,
            estimatedCost: null,
            actionType: null,
            question:
                'Should the Sarthak Infra follow-ups go out in Hindi or English?',
            options: <String>['Hindi', 'English', 'Match each lead'],
            bodyText: null,
            durationSeconds: null,
          ),
        ],
        tools: <AgentToolCall>[
          tool('t1', 'nobogent_crm_query_leads', ToolRunState.done,
              detail: '9 cold leads'),
          tool('t2', 'request_user_input', ToolRunState.running,
              detail: 'Waiting on you'),
        ],
        at: now.subtract(const Duration(minutes: 51)),
        isStreaming: false,
        error: null,
      ),
    ],
  );

  final AgentSession instagramCreatives = AgentSession(
    id: 'demo-session-4',
    title: 'Five Instagram creatives',
    projectId: DemoWorkspace.projectAmritha,
    projectTitle: 'Amritha Vana',
    createdAt: now.subtract(const Duration(minutes: 12)),
    updatedAt: now.subtract(const Duration(minutes: 2)),
    state: SessionState.working,
    messages: <AgentMessage>[
      AgentMessage(
        id: 'm1',
        role: AgentRole.user,
        text: 'Generate five Instagram creatives for the Amritha Vana launch.',
        reasoning: '',
        artifacts: const <AgentArtifact>[],
        tools: const <AgentToolCall>[],
        at: now.subtract(const Duration(minutes: 12)),
        isStreaming: false,
        error: null,
      ),
      AgentMessage(
        id: 'm2',
        role: AgentRole.assistant,
        text: 'Working on frame 3 of 5 —',
        reasoning:
            'Match the Diwali film palette. Keep headline under 6 words so it '
            'stays legible at feed size.',
        artifacts: const <AgentArtifact>[
          AgentArtifact(
            kind: ArtifactKind.imagePreview,
            title: 'Frame 1 — sunrise',
            url: 'assets/demo/property_hero.jpg',
            actionId: null,
            status: 'ready',
            description: null,
            estimatedCost: null,
            actionType: null,
            question: null,
            options: <String>[],
            bodyText: null,
            durationSeconds: null,
          ),
          AgentArtifact(
            kind: ArtifactKind.imagePreview,
            title: 'Frame 2 — poolside',
            url: 'assets/demo/property_2.jpg',
            actionId: null,
            status: 'ready',
            description: null,
            estimatedCost: null,
            actionType: null,
            question: null,
            options: <String>[],
            bodyText: null,
            durationSeconds: null,
          ),
        ],
        tools: <AgentToolCall>[
          tool('t1', 'nobogent_brand_get_profile', ToolRunState.done,
              detail: 'Palette loaded'),
          tool('t2', 'sandbox_render_video', ToolRunState.running,
              detail: 'Frame 3 of 5'),
        ],
        at: now.subtract(const Duration(minutes: 2)),
        isStreaming: true,
        error: null,
      ),
    ],
  );

  return <AgentSession>[
    instagramCreatives,
    bluesquareBroadcast,
    diwaliFilm,
    sarthakFollowUp,
  ];
}
