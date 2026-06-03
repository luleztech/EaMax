/// Parses premium fields from `/api/payments/status` or `/api/users/:id` payloads.
class PremiumSnapshot {
  const PremiumSnapshot({required this.isPremium, this.expiresAt});

  final bool isPremium;
  final DateTime? expiresAt;

  static PremiumSnapshot? fromDynamic(Object? data) {
    if (data is! Map) return null;
    final map = Map<String, dynamic>.from(data);
    final blocked = map['blocked'] == true;
    final premium = !blocked && map['isPremium'] == true;
    final endRaw = map['subscriptionEndDate'] ??
        map['premiumExpiresAt'] ??
        map['premium_expires_at'];
    DateTime? expires;
    if (premium && endRaw != null) {
      expires = DateTime.tryParse(endRaw.toString());
    }
    return PremiumSnapshot(isPremium: premium, expiresAt: expires);
  }
}
