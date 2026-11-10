import '../../core/utils/json.dart';

/// Wire models for the communication surfaces: Meta campaigns, the WhatsApp
/// portal and call logs. Field names mirror the live schema exactly.

/// A Meta ad campaign (`campaigns` table).
class NoboCampaign {
  const NoboCampaign({
    required this.id,
    required this.name,
    required this.status,
    required this.budgetType,
    required this.budget,
    required this.startAt,
    required this.endAt,
    required this.metaCampaignId,
  });

  final String id;
  final String name;
  final String status;
  final String? budgetType;
  final double? budget;
  final DateTime? startAt;
  final DateTime? endAt;
  final String? metaCampaignId;

  bool get isActive => status.toUpperCase() == 'ACTIVE';
  bool get isPaused => status.toUpperCase() == 'PAUSED';

  String get budgetLabel {
    final double? b = budget;
    if (b == null || b <= 0) return '—';
    final String amount = b >= 1000
        ? '₹${(b / 1000).toStringAsFixed(1)}k'
        : '₹${b.toStringAsFixed(0)}';
    final String cadence = (budgetType ?? '').toLowerCase().contains('daily')
        ? '/day'
        : ' total';
    return '$amount$cadence';
  }

  factory NoboCampaign.fromJson(Map<String, dynamic> json) => NoboCampaign(
    id: jStrOr(json['id']),
    name: jStrOr(json['name'], 'Untitled campaign'),
    status: jStrOr(json['status'], 'UNKNOWN'),
    budgetType: jStr(json['budget_type']),
    budget: jDblN(json['total_budget']),
    startAt: jDate(json['start_time']),
    endAt: jDate(json['end_time']),
    metaCampaignId: jStr(json['meta_campaign_id']),
  );
}

/// A WhatsApp conversation (`whatsapp_chats` table).
class WhatsAppChat {
  const WhatsAppChat({
    required this.id,
    required this.phone,
    required this.name,
    required this.lastMessage,
    required this.unread,
    required this.updatedAt,
    required this.leadId,
  });

  final String id;
  final String phone;
  final String? name;
  final String? lastMessage;
  final int unread;
  final DateTime? updatedAt;
  final String? leadId;

  String get displayName {
    final String? n = name;
    if (n != null && n.trim().isNotEmpty) return n.trim();
    return phone;
  }

  factory WhatsAppChat.fromJson(Map<String, dynamic> json) => WhatsAppChat(
    id: jStrOr(json['id']),
    phone: jStrOr(json['recipient_phone'], '—'),
    name: jStr(json['recipient_name']),
    lastMessage: jStr(json['last_message_text']),
    unread: jInt(json['unread_count']),
    updatedAt: jDate(json['updated_at']) ?? jDate(json['created_at']),
    leadId: jStr(json['lead_id']),
  );
}

/// One message inside a WhatsApp conversation (`whatsapp_messages` table).
class WhatsAppMessage {
  const WhatsAppMessage({
    required this.id,
    required this.inbound,
    required this.text,
    required this.at,
    required this.mediaUrl,
    required this.mediaType,
  });

  final String id;
  final bool inbound;
  final String? text;
  final DateTime? at;
  final String? mediaUrl;
  final String? mediaType;

  factory WhatsAppMessage.fromJson(Map<String, dynamic> json) => WhatsAppMessage(
    id: jStrOr(json['id']),
    inbound: jStrOr(json['direction']) == 'inbound',
    text: jStr(json['message_text']),
    at: jDate(json['created_at']),
    mediaUrl: jStr(json['media_url']),
    mediaType: jStr(json['media_type']),
  );
}

/// A sent or scheduled WhatsApp broadcast (`whatsapp_broadcasts` table).
class WhatsAppBroadcast {
  const WhatsAppBroadcast({
    required this.id,
    required this.title,
    required this.templateName,
    required this.status,
    required this.sentAt,
    required this.scheduledAt,
  });

  final String id;
  final String title;
  final String? templateName;
  final String status;
  final DateTime? sentAt;
  final DateTime? scheduledAt;

  factory WhatsAppBroadcast.fromJson(Map<String, dynamic> json) =>
      WhatsAppBroadcast(
        id: jStrOr(json['id']),
        title: jStrOr(json['title'], 'Untitled broadcast'),
        templateName: jStr(json['template_name']),
        status: jStrOr(json['status'], 'draft'),
        sentAt: jDate(json['sent_at']),
        scheduledAt: jDate(json['scheduled_at']),
      );
}

/// A WhatsApp automation (`whatsapp_flows` table).
class WhatsAppFlow {
  const WhatsAppFlow({
    required this.id,
    required this.title,
    required this.description,
    required this.active,
    required this.templateName,
  });

  final String id;
  final String title;
  final String? description;
  final bool active;
  final String? templateName;

  factory WhatsAppFlow.fromJson(Map<String, dynamic> json) => WhatsAppFlow(
    id: jStrOr(json['id']),
    title: jStrOr(json['title'], 'Untitled flow'),
    description: jStr(json['description']),
    active: jBool(json['is_active']),
    templateName: jStr(json['template_name']),
  );
}

/// A logged phone call (`call_logs` table).
class NoboCallLog {
  const NoboCallLog({
    required this.id,
    required this.phone,
    required this.type,
    required this.duration,
    required this.status,
    required this.startedAt,
    required this.recordingUrl,
    required this.notes,
  });

  final String id;
  final String phone;
  final String? type;
  final int duration;
  final String? status;
  final DateTime? startedAt;
  final String? recordingUrl;
  final String? notes;

  bool get connected => (status ?? '').toUpperCase() == 'CONNECTED';

  String get durationLabel {
    if (duration <= 0) return '—';
    final int m = duration ~/ 60;
    final int s = duration % 60;
    return m > 0 ? '${m}m ${s}s' : '${s}s';
  }

  factory NoboCallLog.fromJson(Map<String, dynamic> json) => NoboCallLog(
    id: jStrOr(json['id']),
    phone: jStrOr(json['phone_number'], '—'),
    type: jStr(json['call_type']),
    duration: jInt(json['duration']),
    status: jStr(json['status']),
    startedAt: jDate(json['started_at']) ?? jDate(json['created_at']),
    recordingUrl: jStr(json['recording_url']),
    notes: jStr(json['notes']),
  );
}
