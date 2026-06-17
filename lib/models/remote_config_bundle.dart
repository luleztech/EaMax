import 'app_config.dart';

class RemoteConfigBundle {
  const RemoteConfigBundle({
    required this.configVersion,
    required this.appVersion,
    required this.featureFlags,
    required this.paymentConfig,
    required this.playerConfig,
    required this.sectionLabels,
    required this.emergency,
    required this.ads,
  });

  final int configVersion;
  final AppConfig appVersion;
  final RemoteFeatureFlags featureFlags;
  final RemotePaymentConfig paymentConfig;
  final RemotePlayerConfig playerConfig;
  final Map<String, dynamic> sectionLabels;
  final RemoteEmergencyConfig emergency;
  final RemoteAdsConfig ads;

  factory RemoteConfigBundle.fromJson(Map<String, dynamic> json) {
    final appVersionJson = json['appVersion'] is Map
        ? Map<String, dynamic>.from(json['appVersion'] as Map)
        : json;
    return RemoteConfigBundle(
      configVersion: int.tryParse('${json['configVersion']}') ?? 0,
      appVersion: AppConfig.fromJson(appVersionJson),
      featureFlags: RemoteFeatureFlags.fromJson(
        json['featureFlags'] is Map
            ? Map<String, dynamic>.from(json['featureFlags'] as Map)
            : const {},
      ),
      paymentConfig: RemotePaymentConfig.fromJson(
        json['paymentConfig'] is Map
            ? Map<String, dynamic>.from(json['paymentConfig'] as Map)
            : const {},
      ),
      playerConfig: RemotePlayerConfig.fromJson(
        json['playerConfig'] is Map
            ? Map<String, dynamic>.from(json['playerConfig'] as Map)
            : const {},
      ),
      sectionLabels: json['sectionLabels'] is Map
          ? Map<String, dynamic>.from(json['sectionLabels'] as Map)
          : const {},
      emergency: RemoteEmergencyConfig.fromJson(
        json['emergency'] is Map
            ? Map<String, dynamic>.from(json['emergency'] as Map)
            : const {},
      ),
      ads: RemoteAdsConfig.fromJson(
        json['ads'] is Map
            ? Map<String, dynamic>.from(json['ads'] as Map)
            : const {},
      ),
    );
  }

  bool get shouldBlockAccess => appVersion.shouldBlockAccess;
}

class RemoteFeatureFlags {
  const RemoteFeatureFlags({
    required this.channelsPremiumOnly,
    required this.paymentsEnabled,
    required this.channelsEnabled,
    required this.adsEnabled,
    required this.ratibaTab,
  });

  final bool channelsPremiumOnly;
  final bool paymentsEnabled;
  final bool channelsEnabled;
  final bool adsEnabled;
  final bool ratibaTab;

  factory RemoteFeatureFlags.fromJson(Map<String, dynamic> json) {
    return RemoteFeatureFlags(
      channelsPremiumOnly: json['channelsPremiumOnly'] == true,
      paymentsEnabled: json['paymentsEnabled'] != false,
      channelsEnabled: json['channelsEnabled'] != false,
      adsEnabled: json['adsEnabled'] != false,
      ratibaTab: json['ratibaTab'] != false,
    );
  }
}

class RemotePaymentConfig {
  const RemotePaymentConfig({
    required this.provider,
    required this.currency,
    required this.whatsappNumber,
    required this.plans,
  });

  final String provider;
  final String currency;
  final String? whatsappNumber;
  final List<RemoteSubscriptionPlan> plans;

  factory RemotePaymentConfig.fromJson(Map<String, dynamic> json) {
    final rawPlans = json['plans'];
    final plans = rawPlans is List
        ? rawPlans
            .whereType<Map>()
            .map((e) => RemoteSubscriptionPlan.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : <RemoteSubscriptionPlan>[];
    return RemotePaymentConfig(
      provider: json['provider']?.toString() ?? 'zeno',
      currency: json['currency']?.toString() ?? 'TZS',
      whatsappNumber: json['whatsappNumber']?.toString(),
      plans: plans,
    );
  }
}

class RemoteSubscriptionPlan {
  const RemoteSubscriptionPlan({
    required this.slug,
    required this.nameSw,
    required this.nameEn,
    required this.priceTzs,
    required this.durationDays,
    required this.durationLabelSw,
    required this.priceLineSw,
    required this.isPopular,
    required this.badgeText,
  });

  final String slug;
  final String nameSw;
  final String nameEn;
  final int priceTzs;
  final int durationDays;
  final String durationLabelSw;
  final String priceLineSw;
  final bool isPopular;
  final String? badgeText;

  factory RemoteSubscriptionPlan.fromJson(Map<String, dynamic> json) {
    return RemoteSubscriptionPlan(
      slug: json['slug']?.toString() ?? '',
      nameSw: json['nameSw']?.toString() ?? '',
      nameEn: json['nameEn']?.toString() ?? '',
      priceTzs: int.tryParse('${json['priceTzs']}') ?? 0,
      durationDays: int.tryParse('${json['durationDays']}') ?? 0,
      durationLabelSw: json['durationLabelSw']?.toString() ?? '',
      priceLineSw: json['priceLineSw']?.toString() ?? '',
      isPopular: json['isPopular'] == true,
      badgeText: json['badgeText']?.toString(),
    );
  }

  String get formattedPrice {
    final s = priceTzs.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      final pos = s.length - i;
      buf.write(s[i]);
      if (pos > 1 && pos % 3 == 1) buf.write(',');
    }
    return buf.toString();
  }

  /// Human-readable period when server label is missing.
  String get displayDurationLabel {
    if (durationLabelSw.isNotEmpty) return durationLabelSw;
    switch (durationDays) {
      case 7:
        return '7 siku';
      case 30:
        return '30 siku';
      case 90:
        return 'miezi 3';
      case 365:
        return 'mwaka 1';
      case 1:
        return 'siku 1';
      default:
        return '$durationDays siku';
    }
  }

  /// Price line shown on the payments screen (auto-built from amount + period).
  String get displayPriceLine {
    if (priceLineSw.isNotEmpty) return priceLineSw;
    final period = switch (durationDays) {
      7 => 'wiki moja',
      30 => 'mwezi mmoja',
      90 => 'miezi mitatu',
      365 => 'mwaka mmoja',
      1 => 'siku moja',
      _ => displayDurationLabel,
    };
    return 'Tsh.$formattedPrice/= $period';
  }

  String get displayName {
    if (nameSw.isNotEmpty) return nameSw;
    switch (durationDays) {
      case 7:
        return 'Kwa Wiki';
      case 30:
        return 'Mwezi';
      case 90:
        return 'Miezi 3';
      case 365:
        return 'Mwaka';
      default:
        return slug.isNotEmpty ? slug : displayDurationLabel;
    }
  }
}

class RemotePlayerConfig {
  const RemotePlayerConfig({
    required this.preferredEngine,
    required this.bufferMinMs,
    required this.bufferMaxMs,
    required this.retryMax,
    required this.retryDelayMs,
    required this.reconnectEnabled,
    required this.autoPlay,
    required this.defaultQuality,
    required this.failoverToWebview,
  });

  final String preferredEngine;
  final int bufferMinMs;
  final int bufferMaxMs;
  final int retryMax;
  final int retryDelayMs;
  final bool reconnectEnabled;
  final bool autoPlay;
  final String defaultQuality;
  final bool failoverToWebview;

  factory RemotePlayerConfig.fromJson(Map<String, dynamic> json) {
    return RemotePlayerConfig(
      preferredEngine: json['preferredEngine']?.toString() ?? 'auto',
      bufferMinMs: int.tryParse('${json['bufferMinMs']}') ?? 1500,
      bufferMaxMs: int.tryParse('${json['bufferMaxMs']}') ?? 30000,
      retryMax: int.tryParse('${json['retryMax']}') ?? 4,
      retryDelayMs: int.tryParse('${json['retryDelayMs']}') ?? 1200,
      reconnectEnabled: json['reconnectEnabled'] != false,
      autoPlay: json['autoPlay'] != false,
      defaultQuality: json['defaultQuality']?.toString() ?? '360p',
      failoverToWebview: json['failoverToWebview'] != false,
    );
  }
}

class RemoteEmergencyConfig {
  const RemoteEmergencyConfig({
    required this.disabledChannelIds,
    required this.disabledFeatures,
  });

  final List<int> disabledChannelIds;
  final List<String> disabledFeatures;

  factory RemoteEmergencyConfig.fromJson(Map<String, dynamic> json) {
    final ids = json['disabledChannelIds'];
    final features = json['disabledFeatures'];
    return RemoteEmergencyConfig(
      disabledChannelIds: ids is List
          ? ids.map((e) => int.tryParse('$e') ?? 0).where((n) => n > 0).toList()
          : const [],
      disabledFeatures: features is List
          ? features.map((e) => e.toString()).toList()
          : const [],
    );
  }
}

class RemoteAdsConfig {
  const RemoteAdsConfig({required this.rewardPoints});

  final int rewardPoints;

  factory RemoteAdsConfig.fromJson(Map<String, dynamic> json) {
    return RemoteAdsConfig(
      rewardPoints: int.tryParse('${json['rewardPoints']}') ?? 20,
    );
  }
}

/// Legacy fallback plans — matches backend DEFAULT_PLANS / old hardcoded bundles.
List<RemoteSubscriptionPlan> defaultSubscriptionPlans() {
  return const [
    RemoteSubscriptionPlan(
      slug: 'week',
      nameSw: 'Kwa Wiki',
      nameEn: 'Weekly',
      priceTzs: 2000,
      durationDays: 7,
      durationLabelSw: '7 siku',
      priceLineSw: 'Tsh.2,000/= wiki moja',
      isPopular: false,
      badgeText: null,
    ),
    RemoteSubscriptionPlan(
      slug: 'month',
      nameSw: 'Mwezi',
      nameEn: 'Monthly',
      priceTzs: 5000,
      durationDays: 30,
      durationLabelSw: '30 siku',
      priceLineSw: 'Tsh.5,000/= mwezi mmoja',
      isPopular: true,
      badgeText: null,
    ),
    RemoteSubscriptionPlan(
      slug: 'year',
      nameSw: 'Miezi 3',
      nameEn: 'Quarter',
      priceTzs: 12000,
      durationDays: 90,
      durationLabelSw: 'miezi 3',
      priceLineSw: 'Tsh.12,000/= miezi mitatu',
      isPopular: false,
      badgeText: null,
    ),
  ];
}
