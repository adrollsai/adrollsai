import '../../core/utils/json.dart';

/// A Nobogent "project" — which in the real backend is a row in `properties`.
///
/// The PWA has no `projects` table; the UI concept "project" is `properties`
/// and `properties.id` is what every generation endpoint accepts as
/// `propertyId`. Modelling it as `NoboProject` here keeps the mobile UI honest
/// without inventing an incompatible schema.
class NoboProject {
  const NoboProject({
    required this.id,
    required this.title,
    required this.description,
    required this.address,
    required this.price,
    required this.imageUrl,
    required this.images,
    required this.status,
    required this.propertyType,
    required this.createdAt,
    required this.metaCampaignStatus,
    required this.autoGenerate,
  });

  final String id;
  final String title;
  final String? description;
  final String? address;
  final double? price;
  final String? imageUrl;
  final List<String> images;
  final String status;
  final String? propertyType;
  final DateTime? createdAt;
  final String? metaCampaignStatus;
  final bool autoGenerate;

  /// Cover image: explicit cover first, then the first gallery image.
  String? get coverUrl {
    final String? c = jStr(imageUrl);
    if (c != null) return c;
    for (final String i in images) {
      if (i.trim().isNotEmpty) return i;
    }
    return null;
  }

  String get priceLabel {
    final double? p = price;
    if (p == null || p <= 0) return '—';
    if (p >= 10000000) return '₹${(p / 10000000).toStringAsFixed(2)} Cr';
    if (p >= 100000) return '₹${(p / 100000).toStringAsFixed(2)} L';
    if (p >= 1000) return '₹${(p / 1000).toStringAsFixed(1)}K';
    return '₹${p.toStringAsFixed(0)}';
  }

  bool get isLive => (metaCampaignStatus ?? '').toUpperCase() == 'ACTIVE';

  factory NoboProject.fromJson(Map<String, dynamic> json) {
    return NoboProject(
      id: jStrOr(json['id']),
      title: jStrOr(json['title'], 'Untitled project'),
      description: jStr(json['description']),
      address: jStr(json['address']),
      price: jDblN(json['price']),
      imageUrl: jStr(json['image_url']),
      images: jListStrs(json['images']),
      status: jStrOr(json['status'], 'active'),
      propertyType: jStr(json['property_type']),
      createdAt: jDate(json['created_at']),
      metaCampaignStatus: jStr(json['meta_campaign_status']),
      autoGenerate: jBool(json['auto_generate']),
    );
  }
}
