import '../../core/utils/json.dart';

/// Canonical pipeline stages, mirrored from `utils/pipeline-stages.ts` in the
/// web repo. The column is free text server-side (no enum), so unknown values
/// are preserved verbatim and only the *bucket* is derived locally.
abstract final class LeadStages {
  const LeadStages._();

  static const String newLead = 'New Lead';
  static const String contacted = 'Contacted';
  static const String qualified = 'Qualified';
  static const String meetingScheduled = 'Meeting Scheduled';
  static const String meetingDone = 'Meeting Done';
  static const String proposalSent = 'Proposal Sent';
  static const String negotiation = 'Negotiation';
  static const String dealWon = 'Deal Won';
  static const String followUpLater = 'Follow Up Later';
  static const String unresponsive = 'Unresponsive';
  static const String lost = 'Lost / Disqualified';

  /// Order used for pipeline columns and progress meters.
  static const List<String> ordered = <String>[
    newLead,
    contacted,
    qualified,
    meetingScheduled,
    meetingDone,
    proposalSent,
    negotiation,
    dealWon,
  ];

  static const List<String> terminal = <String>[
    dealWon,
    lost,
    unresponsive,
  ];

  /// Substring rules from the backend's own categoriser — kept in sync so the
  /// mobile grouping matches what the web CRM shows.
  static bool isNegative(String stage) {
    final String s = stage.toLowerCase();
    return s.contains('lost') ||
        s.contains('not interested') ||
        s.contains('junk') ||
        s.contains('unqualified') ||
        s.contains('disqualified') ||
        s.contains('wrong number') ||
        s.contains('fake') ||
        s.contains('unresponsive');
  }

  static bool isWon(String stage) {
    final String s = stage.toLowerCase();
    return s.contains('won') || s.contains('token paid') || s.contains('deal /');
  }
}

/// A CRM lead (`leads` table — 48 columns; only the mobile-relevant ones map).
class NoboLead {
  const NoboLead({
    required this.id,
    required this.name,
    required this.phone,
    required this.email,
    required this.stage,
    required this.source,
    required this.notes,
    required this.createdAt,
    required this.nextFollowup,
    required this.projectId,
    required this.value,
    required this.budget,
    required this.priorityStatus,
    required this.voiceCallStatus,
    required this.voiceCallSummary,
    required this.assignedTo,
    required this.lastCallAt,
    required this.lastCallStatus,
    required this.dnpCount,
  });

  final String id;
  final String name;
  final String? phone;
  final String? email;
  final String stage;
  final String? source;
  final String? notes;
  final DateTime? createdAt;
  final DateTime? nextFollowup;
  final String? projectId;
  final double? value;
  final String? budget;
  final String? priorityStatus;
  final String? voiceCallStatus;
  final String? voiceCallSummary;
  final String? assignedTo;
  final DateTime? lastCallAt;
  final String? lastCallStatus;
  final int dnpCount;

  bool get isWon => LeadStages.isWon(stage);
  bool get isNegative => LeadStages.isNegative(stage);

  /// A lead is overdue when its follow-up was due on an earlier *calendar day*
  /// and it is not already closed out.
  ///
  /// Deliberately day-granular: something scheduled for 5pm today is not overdue
  /// at 5:01pm, because the owner still has today to act on it.
  bool get isOverdue {
    final DateTime? f = nextFollowup;
    if (f == null) return false;
    if (isWon || isNegative) return false;
    final DateTime now = DateTime.now();
    final DateTime due = DateTime(f.year, f.month, f.day);
    final DateTime today = DateTime(now.year, now.month, now.day);
    return due.isBefore(today);
  }

  bool get isDueToday {
    final DateTime? f = nextFollowup;
    if (f == null) return false;
    final DateTime now = DateTime.now();
    return f.year == now.year && f.month == now.month && f.day == now.day;
  }

  /// Initials for the avatar fallback (avatars beat initials beat generic icons).
  String get initials {
    final List<String> parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((String p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      return parts.first.characters(1).toUpperCase();
    }
    return (parts.first.characters(1) + parts[1].characters(1)).toUpperCase();
  }

  factory NoboLead.fromJson(Map<String, dynamic> json) {
    final String rawStage =
        jStr(json['pipeline_stage']) ?? jStr(json['status']) ?? 'New Lead';
    return NoboLead(
      id: jStrOr(json['id']),
      name: jStrOr(json['name'], 'Unnamed lead'),
      phone: jStr(json['phone']),
      email: jStr(json['email']),
      stage: rawStage,
      source: jStr(json['source']) ?? jStr(json['ad_name']),
      notes: jStr(json['notes']),
      createdAt: jDate(json['created_at']),
      nextFollowup: jDate(json['next_followup']),
      projectId: jStr(json['property_id']),
      value: jDblN(json['value']),
      budget: jStr(json['budget']),
      priorityStatus: jStr(json['priority_status']),
      voiceCallStatus: jStr(json['voice_call_status']),
      voiceCallSummary: jStr(json['voice_call_summary']),
      assignedTo: jStr(json['assigned_to']),
      // Not present in the generated types but written by the API — read
      // defensively rather than assuming absence.
      lastCallAt: jDate(json['last_call_at']),
      lastCallStatus: jStr(json['last_call_status']),
      dnpCount: jInt(json['dnp_count']),
    );
  }
}

extension on String {
  String characters(int n) => length <= n ? this : substring(0, n);
}
