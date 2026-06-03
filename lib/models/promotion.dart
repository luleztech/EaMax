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
    this.offerAmountTsh,
    this.offerPeriodDays,
    this.offerEndsAt,
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
  final int? offerAmountTsh;
  final int? offerPeriodDays;
  final DateTime? offerEndsAt;

  static String _normalizeType(String? raw) {
    final t = (raw ?? 'ujumbe').toLowerCase();
    switch (t) {
      case 'image':
        return 'picha';
      case 'text':
        return 'ujumbe';
      case 'announcement':
      case 'force_update':
        return 'tangazo';
      default:
        return t;
    }
  }

  factory Promotion.fromJson(Map<String, dynamic> json) {
    final idRaw = json['id'];
    DateTime? ends;
    final endsRaw = json['offerEndsAt'] ?? json['offer_ends_at'];
    if (endsRaw != null) {
      ends = DateTime.tryParse(endsRaw.toString());
    }
    return Promotion(
      id: idRaw is num ? idRaw.toInt() : int.tryParse('$idRaw') ?? 0,
      title: json['title']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      imageUrl: json['imageUrl']?.toString() ?? json['image_url']?.toString(),
      buttonText:
          json['buttonText']?.toString() ?? json['button_text']?.toString() ?? '',
      buttonUrl: json['buttonUrl']?.toString() ?? json['button_url']?.toString(),
      type: _normalizeType(json['type']?.toString()),
      priority: (json['priority'] as num?)?.toInt() ?? 3,
      showMode: json['showMode']?.toString() ?? json['show_mode']?.toString() ?? 'daily',
      backgroundStyle: json['backgroundStyle']?.toString() ??
          json['background_style']?.toString() ??
          'dark_glass',
      offerAmountTsh: (json['offerAmountTsh'] ?? json['offer_amount_tsh'] as num?)
          ?.toInt(),
      offerPeriodDays: (json['offerPeriodDays'] ?? json['offer_period_days'] as num?)
          ?.toInt(),
      offerEndsAt: ends,
    );
  }

  bool get isPicha => type == 'picha';

  bool get isUjumbe => type == 'ujumbe';

  bool get isTangazo => type == 'tangazo';

  bool get isOfa => type == 'ofa';

  bool get hasImage => isPicha && (imageUrl?.isNotEmpty ?? false);

  bool get hasExternalLink {
    final url = buttonUrl?.trim();
    return url != null && url.isNotEmpty;
  }

  bool get showLinkButton => hasExternalLink && !isOfa;

  String get periodLabelSw {
    final d = offerPeriodDays ?? 7;
    if (d == 7) return 'wiki moja';
    if (d == 30) return 'mwezi mmoja';
    if (d % 7 == 0 && d < 60) return 'wiki ${d ~/ 7}';
    return 'siku $d';
  }
}
