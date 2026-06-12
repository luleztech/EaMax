/// Parses premium fields from `/api/payments/status` or `/api/users/:id` payloads.
class PremiumSnapshot {
  const PremiumSnapshot({required this.isPremium, this.expiresAt});

  final bool isPremium;
  final DateTime? expiresAt;

  /// Expiry date is authoritative when present — premium stays active until it passes.
  static bool resolveActive({
    required bool blocked,
    required bool apiPremium,
    DateTime? expiresAt,
    DateTime? now,
  }) {
    if (blocked) return false;
    final clock = now ?? DateTime.now();
    if (expiresAt != null) return expiresAt.isAfter(clock);
    return apiPremium;
  }

  static PremiumSnapshot? fromDynamic(Object? data) {
    if (data is! Map) return null;
    final map = Map<String, dynamic>.from(data);
    final blocked = map['blocked'] == true;
    final apiPremium = map['isPremium'] == true || map['is_premium'] == true;
    final endRaw = map['subscriptionEndDate'] ??
        map['premiumExpiresAt'] ??
        map['premium_expires_at'];
    DateTime? expires;
    if (endRaw != null && endRaw.toString().isNotEmpty) {
      expires = DateTime.tryParse(endRaw.toString());
    }
    final premium = resolveActive(
      blocked: blocked,
      apiPremium: apiPremium,
      expiresAt: expires,
    );
    return PremiumSnapshot(isPremium: premium, expiresAt: expires);
  }
}
