import '../config/app_version.dart';

class Promotion {
  const Promotion({
    required this.id,
    required this.title,
    required this.description,
    this.imageUrl,
    required this.buttonText,
    this.buttonUrl,
    required this.type,
    required this.priority,
    required this.showMode,
    required this.backgroundStyle,
    required this.forceUpdate,
    this.minRequiredVersion,
  });

  final int id;
  final String title;
  final String description;
  final String? imageUrl;
  final String buttonText;
  final String? buttonUrl;
  final String type;
  final int priority;
  final String showMode;
  final String backgroundStyle;
  final bool forceUpdate;
  final String? minRequiredVersion;

  factory Promotion.fromJson(Map<String, dynamic> json) {
    final idRaw = json['id'];
    return Promotion(
      id: idRaw is num ? idRaw.toInt() : int.tryParse('$idRaw') ?? 0,
      title: json['title']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      imageUrl: json['imageUrl']?.toString() ?? json['image_url']?.toString(),
      buttonText:
          json['buttonText']?.toString() ?? json['button_text']?.toString() ?? 'Learn More',
      buttonUrl: json['buttonUrl']?.toString() ?? json['button_url']?.toString(),
      type: json['type']?.toString() ?? 'text',
      priority: (json['priority'] as num?)?.toInt() ?? 3,
      showMode: json['showMode']?.toString() ?? json['show_mode']?.toString() ?? 'daily',
      backgroundStyle: json['backgroundStyle']?.toString() ??
          json['background_style']?.toString() ??
          'dark_glass',
      forceUpdate: json['forceUpdate'] == true || json['force_update'] == true,
      minRequiredVersion: json['minRequiredVersion']?.toString() ??
          json['min_required_version']?.toString(),
    );
  }

  bool get isImageType => type == 'image' && (imageUrl?.isNotEmpty ?? false);

  bool get blocksAppForUpdate {
    if (!forceUpdate && type != 'force_update') return false;
    final minV = minRequiredVersion?.trim();
    if (minV == null || minV.isEmpty) return forceUpdate;
    return compareSemver(kAppVersion, minV) < 0;
  }
}
