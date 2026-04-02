import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/ads.dart';
import '../config/api.dart';
import '../services/fcm_notifications.dart';
import '../services/user_id.dart';
import '../theme/app_theme.dart';
import 'combined_home.dart';

class StreamingApp extends StatefulWidget {
  const StreamingApp({super.key});

  @override
  State<StreamingApp> createState() => _StreamingAppState();
}

class _StreamingAppState extends State<StreamingApp> {
  bool _premium = false;
  bool _channelsPremiumOnly = false;
  int _points = 0;
  bool _adOpen = false;
  bool _congratsOpen = false;

  static const _congratsKey = 'premiumCongratsShown';

  Future<void> _refreshUser() async {
    try {
      final uid = await getStoredUserId();
      if (uid == null) return;
      final userData = await userApi.getUser(uid);
      if (!mounted) return;
      final premium = userData['isPremium'] == true;
      final pts = (userData['points'] as num?)?.toInt() ?? 0;
      setState(() {
        _points = pts;
        _premium = premium;
      });
      if (premium) {
        final prefs = await SharedPreferences.getInstance();
        final shown = prefs.getString('${_congratsKey}_$uid');
        if (shown != '1') {
          setState(() => _congratsOpen = true);
          await prefs.setString('${_congratsKey}_$uid', '1');
        }
      }
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await getOrCreateUserId();
    try {
      final s = await settingsApi.getChannelsPremiumOnly();
      if (mounted) setState(() => _channelsPremiumOnly = s);
    } catch (_) {}
    await _refreshUser();
    await setupFcmLocalNotifications();
    await _syncFcm();
    await _checkPendingPayment();
  }

  Future<void> _syncFcm() async {
    if (kIsWeb) return;
    final uid = await getStoredUserId();
    if (uid == null) return;
    try {
      final tok = await FirebaseMessaging.instance.getToken();
      if (tok != null && tok.isNotEmpty) {
        await userApi.registerFcmToken(uid, tok);
      }
    } catch (_) {}
  }

  Future<void> _checkPendingPayment() async {
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getString('pendingPaymentOrderId')?.trim();
    if (pending == null || pending.isEmpty) return;
    try {
      final res = await paymentsApi.checkZenoStatus(pending);
      final st = res['status'] ?? res['raw']?['data']?[0]?['payment_status'];
      if (st.toString().toUpperCase() == 'COMPLETED') {
        await prefs.remove('pendingPaymentOrderId');
        await _refreshUser();
      }
    } catch (_) {}
  }

  void _openAd() {
    if (_premium) return;
    setState(() => _adOpen = true);
  }

  Future<void> _showRewardedAndCredit() async {
    setState(() => _adOpen = false);
    if (kIsWeb) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Matangazo hayapatikani kwenye web. Tumia app ya simu.')),
        );
      }
      return;
    }
    await RewardedAd.load(
      adUnitId: rewardedAdUnitIdAndroid,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (ad) => ad.dispose(),
          );
          ad.show(
            onUserEarnedReward: (ad, reward) async {
              final uid = await getOrCreateUserId();
              if (uid != null) {
                try {
                  await userApi.recordAdWatched(uid, points: pointsPerReward);
                } catch (_) {}
              }
              await _refreshUser();
            },
          );
        },
        onAdFailedToLoad: (e) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Ad failed: ${e.message}')));
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        CombinedHome(
          isPremium: _premium,
          channelsPremiumOnly: _channelsPremiumOnly,
          userPoints: _points,
          onWatchAd: _openAd,
          onPointsRefresh: _refreshUser,
          onPaymentsActiveChange: (_) {},
        ),
        if (_adOpen)
          Positioned.fill(
            child: Material(
              color: Colors.black87,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Tazama tangazo la points', style: TextStyle(color: Colors.white, fontSize: 18)),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _showRewardedAndCredit,
                    child: const Text('Anza'),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _adOpen = false),
                    child: const Text('Funga'),
                  ),
                ],
              ),
            ),
          ),
        if (_congratsOpen)
          Positioned.fill(
            child: GestureDetector(
              onTap: () => setState(() => _congratsOpen = false),
              child: Container(
                color: Colors.black87,
                alignment: Alignment.center,
                padding: const EdgeInsets.all(24),
                child: GestureDetector(
                  onTap: () {},
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 360),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      gradient: const LinearGradient(colors: [Color(0xFFEAB308), Color(0xFFCA8A04), Color(0xFFA16207)]),
                      border: Border.all(color: const Color(0x80EAB308)),
                    ),
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.star, size: 48, color: Colors.white),
                        const SizedBox(height: 16),
                        const Text('Hongera! Umefanikiwa', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
                        const SizedBox(height: 12),
                        Text(
                          'Umajiunga nasi kama mwanachama wa Premium. Channels zote sasa ni bure kwako – hakuna matangazo, hakuna vikwazo hadi muda wako utakapokwisha.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 15, color: Colors.white.withValues(alpha: 0.95), height: 1.45),
                        ),
                        const SizedBox(height: 24),
                        FilledButton(
                          style: FilledButton.styleFrom(backgroundColor: Colors.white),
                          onPressed: () => setState(() => _congratsOpen = false),
                          child: const Text('Sawa', style: TextStyle(color: Color(0xFFA16207), fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
