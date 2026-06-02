import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/app_config.dart';
import '../services/app_config_service.dart';
import '../services/update_state.dart';
import '../theme/app_typography.dart';

/// Full-screen mandatory update wall.
///
/// - Cannot be dismissed (no back button, no skip).
/// - Tapping "Sasisha Sasa" opens the Play Store listing.
/// - Periodically pulses to draw attention.
class ForceUpdateScreen extends StatefulWidget {
  const ForceUpdateScreen({super.key, required this.config});

  final AppConfig config;

  @override
  State<ForceUpdateScreen> createState() => _ForceUpdateScreenState();
}

class _ForceUpdateScreenState extends State<ForceUpdateScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  late final Animation<double> _scale;
  Timer? _refreshTimer;
  bool _launching = false;

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ));
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
    _scale = Tween<double>(begin: 1.0, end: 1.06).animate(
      CurvedAnimation(parent: _pulse, curve: Curves.easeInOut),
    );
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _recheckUpdateStatus();
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _openStore() async {
    if (_launching) return;
    setState(() => _launching = true);
    try {
      final uri = Uri.parse(widget.config.playStoreUrl);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  Future<void> _recheckUpdateStatus() async {
    try {
      final config = await AppConfigService.fetch(forceRefresh: true);
      if (!mounted || config == null) return;
      if (!config.shouldBlockAccess) {
        appUpdateState.clear();
      }
    } catch (_) {
      // Ignore refresh failures; the server update screen remains visible.
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: const Color(0xFF030308),
        body: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF03030A), Color(0xFF0D1117), Color(0xFF050510)],
              stops: [0.0, 0.5, 1.0],
            ),
          ),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
              child: Column(
                children: [
                  const Spacer(flex: 2),
                  // Icon
                  Container(
                    width: 110,
                    height: 110,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: const LinearGradient(
                        colors: [Color(0xFF2563EB), Color(0xFF60A5FA)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF2563EB).withValues(alpha: 0.5),
                          blurRadius: 40,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                    child: const Icon(Icons.system_update_rounded,
                        size: 52, color: Colors.white),
                  ),
                  const SizedBox(height: 32),
                  Text(
                    'Update App Yako',
                    textAlign: TextAlign.center,
                    style: orbitron(26, weight: FontWeight.w900).copyWith(
                      color: Colors.white,
                      letterSpacing: 1.5,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Toleo hili halifanyi kazi kwa sasa. Tafadhali hakikisha umeupdate app yako ya EaMax ili ufurahie vipindi bora.',
                    textAlign: TextAlign.center,
                    style: rajdhani(15, weight: FontWeight.w500)
                        .copyWith(color: Colors.white70, height: 1.6),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      color: Colors.white.withValues(alpha: 0.06),
                      border: Border.all(
                          color: Colors.white.withValues(alpha: 0.12)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.info_outline_rounded,
                            size: 16, color: Color(0xFF60A5FA)),
                        const SizedBox(width: 8),
                        Text(
                          'Toleo la chini: ${widget.config.minimumSupportedVersion}',
                          style: rajdhani(12, weight: FontWeight.w600)
                              .copyWith(color: const Color(0xFF60A5FA)),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(flex: 3),
                  // Update button with pulse animation
                  ScaleTransition(
                    scale: _scale,
                    child: SizedBox(
                      width: double.infinity,
                      height: 56,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          gradient: const LinearGradient(
                            colors: [Color(0xFF2563EB), Color(0xFF60A5FA)],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF2563EB)
                                  .withValues(alpha: 0.55),
                              blurRadius: 24,
                              offset: const Offset(0, 8),
                            ),
                          ],
                        ),
                        child: Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: _launching ? null : _openStore,
                            borderRadius: BorderRadius.circular(16),
                            child: Center(
                              child: _launching
                                  ? const SizedBox(
                                      width: 24,
                                      height: 24,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.5,
                                        color: Colors.white,
                                      ),
                                    )
                                  : Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        const Icon(Icons.download_rounded,
                                            color: Colors.white, size: 20),
                                        const SizedBox(width: 10),
                                        Text(
                                          'UPDATE',
                                          style: orbitron(14,
                                                  weight: FontWeight.w900)
                                              .copyWith(
                                                  color: Colors.white,
                                                  letterSpacing: 1.2),
                                        ),
                                      ],
                                    ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Unahitaji Google Play Store kusasisha.',
                    textAlign: TextAlign.center,
                    style: rajdhani(11).copyWith(
                      color: Colors.white38,
                      letterSpacing: 0.4,
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
