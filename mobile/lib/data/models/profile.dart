import '../../core/utils/json.dart';

/// The signed-in workspace/tenant. Mirrors the `profiles` table, which is the
/// root of all tenancy in Nobogent (every other row carries `user_id`).
class NoboProfile {
  const NoboProfile({
    required this.id,
    required this.email,
    required this.fullName,
    required this.businessName,
    required this.role,
    required this.avatarUrl,
    required this.logoUrl,
    required this.credits,
    required this.subscriptionPlan,
    required this.subscriptionStatus,
    required this.contactNumber,
    required this.industry,
    required this.onboardingCompleted,
    required this.clientFeatures,
  });

  final String id;
  final String? email;
  final String? fullName;
  final String? businessName;
  final String role;
  final String? avatarUrl;
  final String? logoUrl;
  final double credits;
  final String? subscriptionPlan;
  final String? subscriptionStatus;
  final String? contactNumber;
  final String? industry;
  final bool onboardingCompleted;
  final List<String> clientFeatures;

  /// The AI agent is currently restricted to super-admin accounts server-side.
  /// The client surfaces this honestly rather than failing with a raw 403.
  bool get canUseAgent => role == 'super_admin';

  String get displayName {
    final String? n = (fullName?.trim().isNotEmpty ?? false)
        ? fullName!.trim()
        : null;
    if (n != null) return n;
    final String? b = (businessName?.trim().isNotEmpty ?? false)
        ? businessName!.trim()
        : null;
    if (b != null) return b;
    return email?.split('@').first ?? 'there';
  }

  /// First name only, for greetings.
  String get firstName => displayName.split(RegExp(r'\s+')).first;

  String get workspaceName =>
      (businessName?.trim().isNotEmpty ?? false) ? businessName! : 'Your workspace';

  factory NoboProfile.fromJson(Map<String, dynamic> json) {
    return NoboProfile(
      id: jStrOr(json['id']),
      email: jStr(json['email']),
      fullName: jStr(json['full_name']),
      businessName: jStr(json['business_name']),
      role: jStrOr(json['role'], 'client'),
      avatarUrl: jStr(json['avatar_url']),
      logoUrl: jStr(json['logo_url']),
      credits: jDbl(json['credits']),
      subscriptionPlan: jStr(json['subscription_plan']),
      subscriptionStatus: jStr(json['subscription_status']),
      contactNumber: jStr(json['contact_number']),
      industry: jStr(json['industry']),
      onboardingCompleted: jBool(json['onboarding_completed']),
      clientFeatures: jListStrs(json['client_features']),
    );
  }
}
