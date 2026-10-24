import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Tanzania mobile-money checkout rules (local phone format).
class TzPaymentConfig {
  TzPaymentConfig._();

  static final RegExp tzLocalPhone = RegExp(r'^0[67]\d{8}$');

  static const halotelPrefixes = <String>['061', '062', '063'];

  static const _learnedPrefsKey = 'eamax_learned_prefixes_v1';

  /// Prefixes outside the built-in table: from the server bundle and from this
  /// device's own checkouts (the payer told us the network).
  static final Map<String, TzMobileNetwork> _learned = {};

  /// Bumps when [_learned] changes so open forms can re-detect.
  static final ValueNotifier<int> learnedVersion = ValueNotifier(0);

  static Future<void> loadLearned() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getStringList(_learnedPrefsKey) ?? const [];
      var changed = false;
      for (final entry in raw) {
        final parts = entry.split(':');
        if (parts.length != 2) continue;
        final net = networkFromKey(parts[1]);
        if (net == TzMobileNetwork.unknown || _builtIn(parts[0]) != TzMobileNetwork.unknown) continue;
        if (_learned.containsKey(parts[0])) continue;
        _learned[parts[0]] = net;
        changed = true;
      }
      if (changed) learnedVersion.value++;
    } catch (_) {}
  }

  /// Server-published `{ "064": "halopesa" }`. Local choices are kept for prefixes the server lacks.
  static void registerLearnedPrefixes(Map<String, String> remote) {
    var changed = false;
    remote.forEach((prefix, key) {
      final net = networkFromKey(key);
      if (!RegExp(r'^0[67]\d$').hasMatch(prefix) || net == TzMobileNetwork.unknown) return;
      if (_builtIn(prefix) != TzMobileNetwork.unknown || _learned[prefix] == net) return;
      _learned[prefix] = net;
      changed = true;
    });
    if (changed) learnedVersion.value++;
  }

  static Future<void> learnPrefix(String prefix, TzMobileNetwork net) async {
    if (net == TzMobileNetwork.unknown || !RegExp(r'^0[67]\d$').hasMatch(prefix)) return;
    if (_builtIn(prefix) != TzMobileNetwork.unknown) return;
    _learned[prefix] = net;
    learnedVersion.value++;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(
        _learnedPrefsKey,
        [for (final e in _learned.entries) '${e.key}:${networkKey(e.value)}'],
      );
    } catch (_) {}
  }

  /// First three digits of a local number, or null while fewer are typed.
  static String? prefixOf(String raw) {
    final digits = liveDigits(raw);
    return digits.length >= 3 ? digits.substring(0, 3) : null;
  }

  static String networkKey(TzMobileNetwork network) {
    switch (network) {
      case TzMobileNetwork.mpesa:
        return 'mpesa';
      case TzMobileNetwork.airtel:
        return 'airtel';
      case TzMobileNetwork.tigo:
        return 'tigo';
      case TzMobileNetwork.halotel:
        return 'halopesa';
      case TzMobileNetwork.unknown:
        return '';
    }
  }

  static TzMobileNetwork networkFromKey(String? key) {
    switch ((key ?? '').trim().toLowerCase()) {
      case 'mpesa':
      case 'vodacom':
        return TzMobileNetwork.mpesa;
      case 'airtel':
        return TzMobileNetwork.airtel;
      case 'tigo':
      case 'mixx':
      case 'yas':
        return TzMobileNetwork.tigo;
      case 'halopesa':
      case 'halotel':
        return TzMobileNetwork.halotel;
      default:
        return TzMobileNetwork.unknown;
    }
  }

  /// Network key sent with `/api/payments/start` so the server can route unknown prefixes.
  static String? networkKeyForPhone(String raw) {
    final net = detectNetwork(raw);
    return net == TzMobileNetwork.unknown ? null : networkKey(net);
  }

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

  /// Digits typed so far, as a local `0…` number. Works before the number is complete.
  static String liveDigits(String raw) {
    var digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('255')) {
      digits = digits.length > 3 ? '0${digits.substring(3)}' : '';
    } else if (digits.startsWith('00255')) {
      digits = digits.length > 5 ? '0${digits.substring(5)}' : '';
    }
    if (digits.length == 9 && RegExp(r'^[67]').hasMatch(digits)) {
      digits = '0$digits';
    } else if (digits.isNotEmpty && !digits.startsWith('0')) {
      digits = '0$digits';
    }
    if (digits.length > 10) digits = digits.substring(0, 10);
    return digits;
  }

  static TzMobileNetwork _fromPrefix(String prefix) {
    final known = _builtIn(prefix);
    if (known != TzMobileNetwork.unknown) return known;
    return _learned[prefix] ?? TzMobileNetwork.unknown;
  }

  static TzMobileNetwork _builtIn(String prefix) {
    if (halotelPrefixes.contains(prefix)) return TzMobileNetwork.halotel;
    if (const {'065', '067', '070', '071', '077'}.contains(prefix)) return TzMobileNetwork.tigo;
    if (const {'068', '069', '078'}.contains(prefix)) return TzMobileNetwork.airtel;
    if (const {'066', '074', '075', '076', '079'}.contains(prefix)) return TzMobileNetwork.mpesa;
    return TzMobileNetwork.unknown;
  }

  /// Known as soon as the first three digits are typed (074 → Vodacom M-Pesa).
  static TzMobileNetwork detectNetworkLive(String raw) {
    final digits = liveDigits(raw);
    if (digits.length < 3) return TzMobileNetwork.unknown;
    return _fromPrefix(digits.substring(0, 3));
  }

  static TzMobileNetwork detectNetwork(String raw) {
    final phone = normalizeTzLocalPhone(raw);
    if (phone == null || phone.length < 3) return detectNetworkLive(raw);
    return _fromPrefix(phone.substring(0, 3));
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

  /// Company name shown next to the wallet, e.g. Vodacom M-Pesa.
  static String networkOperator(TzMobileNetwork network) {
    switch (network) {
      case TzMobileNetwork.mpesa:
        return 'Vodacom';
      case TzMobileNetwork.airtel:
        return 'Airtel';
      case TzMobileNetwork.tigo:
        return 'Yas';
      case TzMobileNetwork.halotel:
        return 'Halotel';
      case TzMobileNetwork.unknown:
        return '';
    }
  }

  static String networkFullName(TzMobileNetwork network) {
    final operator = networkOperator(network);
    final wallet = networkLabel(network);
    if (operator.isEmpty) return wallet;
    return '$operator $wallet';
  }

  static String paymentPromptFor(String raw) {
    final net = detectNetwork(raw);
    if (net == TzMobileNetwork.unknown) return paymentPromptSw;
    return 'Angalia simu yako — thibitisha PIN ya ${networkLabel(net)}.';
  }
}

enum TzMobileNetwork { mpesa, airtel, tigo, halotel, unknown }
