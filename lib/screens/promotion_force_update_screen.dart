import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/app_config.dart';
import '../models/promotion.dart';

/// Full-screen update gate driven by a promotion (no close button).
class PromotionForceUpdateScreen extends StatelessWidget {
  const PromotionForceUpdateScreen({
    super.key,
    required this.promotion,
    this.fallbackConfig,
  });

  final Promotion promotion;
  final AppConfig? fallbackConfig;

  Future<void> _openStore() async {
    final url = promotion.buttonUrl?.trim().isNotEmpty == true
        ? promotion.buttonUrl!.trim()
        : fallbackConfig?.playStoreUrl ??
            'https://play.google.com/store/apps/details?id=com.eamax';
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF02040A),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.system_update_alt, size: 72, color: Color(0xFFA78BFA)),
              const SizedBox(height: 24),
              Text(
                promotion.title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                promotion.description.isNotEmpty
                    ? promotion.description
                    : 'Update your app to continue using EaMax TV.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 16,
                  height: 1.5,
                  color: Colors.white.withValues(alpha: 0.85),
                ),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _openStore,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF8B5CF6),
                    padding: const EdgeInsets.symmetric(vertical: 18),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(
                    promotion.buttonText.isNotEmpty ? promotion.buttonText : 'Update Now',
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
