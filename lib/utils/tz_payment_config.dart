/// Tanzania mobile-money checkout rules (local phone format).
class TzPaymentConfig {
  TzPaymentConfig._();

  static final RegExp tzLocalPhone = RegExp(r'^0[67]\d{8}$');

  static const halotelPrefixes = <String>['061', '062', '063'];

  static String? normalizeTzLocalPhone(String raw) {
    var digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return null;

    if (digits.startsWith('255') && digits.length >= 12) {
      digits = digits.substring(3, 12);
    }

    if (digits.startsWith('0') && digits.length >= 10) {
      digits = digits.substring(0, 10);
    } else if (digits.length == 9 && RegExp(r'^[67]').hasMatch(digits)) {
      digits = '0$digits';
    }

    if (!tzLocalPhone.hasMatch(digits)) return null;
    return digits;
  }

  static bool isValidTzLocalPhone(String raw) => normalizeTzLocalPhone(raw) != null;

  static bool isValidFullName(String raw) {
    final t = raw.trim();
    if (t.length < 4) return false;
    return RegExp(r'\s+').hasMatch(t);
  }

  static const paymentPromptSw =
      'Angalia simu yako — thibitisha PIN (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa).';

  static TzMobileNetwork detectNetwork(String raw) {
    final phone = normalizeTzLocalPhone(raw);
    if (phone == null || phone.length < 3) return TzMobileNetwork.unknown;
    final prefix = phone.substring(0, 3);
    if (halotelPrefixes.contains(prefix)) return TzMobileNetwork.halotel;
    if (const {'065', '067', '071', '077'}.contains(prefix)) return TzMobileNetwork.tigo;
    if (const {'068', '069', '078'}.contains(prefix)) return TzMobileNetwork.airtel;
    if (const {'074', '075', '076', '079'}.contains(prefix)) return TzMobileNetwork.mpesa;
    if (phone.startsWith('06')) return TzMobileNetwork.halotel;
    if (phone.startsWith('07')) return TzMobileNetwork.mpesa;
    return TzMobileNetwork.unknown;
  }

  static String networkLabel(TzMobileNetwork network) {
    switch (network) {
      case TzMobileNetwork.mpesa:
        return 'M-Pesa';
      case TzMobileNetwork.airtel:
        return 'Airtel Money';
      case TzMobileNetwork.tigo:
        return 'Mixx by Yas';
      case TzMobileNetwork.halotel:
        return 'HaloPesa';
      case TzMobileNetwork.unknown:
        return 'Mobile Money';
    }
  }

  static String paymentPromptFor(String raw) {
    final net = detectNetwork(raw);
    if (net == TzMobileNetwork.unknown) return paymentPromptSw;
    return 'Angalia simu yako — thibitisha PIN ya ${networkLabel(net)}.';
  }
}

enum TzMobileNetwork { mpesa, airtel, tigo, halotel, unknown }
