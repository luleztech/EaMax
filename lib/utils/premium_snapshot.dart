/// Parses premium fields from `/api/payments/status` or `/api/users/:id` payloads.
class PremiumSnapshot {
  const PremiumSnapshot({required this.isPremium, this.expiresAt});

  final bool isPremium;
  final DateTime? expiresAt;

  /// Prefer the server premium flag; only use expiry to extend or revoke with skew tolerance.
  ///
  /// Previously expiry alone overrode `apiPremium`, so a slightly skewed device clock
  /// could leave paid users locked right after a successful grant.
  static bool resolveActive({
    required bool blocked,
    required bool apiPremium,
    DateTime? expiresAt,
    DateTime? now,
  }) {
    if (blocked) return false;
    final clock = now ?? DateTime.now();
    // Allow small clock skew so a just-granted expiry is not treated as already expired.
    const skew = Duration(minutes: 15);

    if (expiresAt != null) {
      if (expiresAt.isAfter(clock.subtract(skew))) {
        // Expiry still in the future (or within skew) → active.
        // Also trust apiPremium if both agree / server says premium.
        return true;
      }
      // Expiry clearly in the past — only active if API still insists premium
      // (rare repair window) within a short grace after parse issues.
      return apiPremium && expiresAt.isAfter(clock.subtract(const Duration(hours: 1)));
    }

    return apiPremium;
  }

  static PremiumSnapshot? fromDynamic(Object? data) {
    if (data is! Map) return null;
    final map = Map<String, dynamic>.from(data);
    final blocked = map['blocked'] == true;
    final apiPremium = map['isPremium'] == true ||
        map['is_premium'] == true ||
        map['isPremium'] == 1 ||
        map['is_premium'] == 1 ||
        map['isPremium']?.toString().toLowerCase() == 'true' ||
        map['is_premium']?.toString().toLowerCase() == 'true';
    final endRaw = map['subscriptionEndDate'] ??
        map['premiumExpiresAt'] ??
        map['premium_expires_at'];
    DateTime? expires;
    if (endRaw != null && endRaw.toString().isNotEmpty) {
      expires = DateTime.tryParse(endRaw.toString())?.toLocal();
    }
    final premium = resolveActive(
      blocked: blocked,
      apiPremium: apiPremium,
      expiresAt: expires,
    );
    return PremiumSnapshot(isPremium: premium, expiresAt: expires);
  }
}
