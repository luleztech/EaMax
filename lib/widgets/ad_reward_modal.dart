import 'dart:ui';

import 'package:flutter/material.dart';

import '../config/ads.dart';
import '../theme/app_theme.dart';

/// Mirrors React Native `AdModal.js` phases: prompt → loading → (fullscreen ad) → success | error.
enum AdRewardPhase {
  prompt,
  loading,
  error,
  success,
}

/// Full-screen overlay: ask user to watch a rewarded ad for points.
class AdRewardModal extends StatelessWidget {
  const AdRewardModal({
    super.key,
    required this.phase,
    required this.pointsEarned,
    required this.onWatch,
    required this.onClose,
    required this.onRetry,
    required this.onWatchAgain,
    required this.isWeb,
  });

  final AdRewardPhase phase;
  final int pointsEarned;
  final VoidCallback onWatch;
  final VoidCallback onClose;
  final VoidCallback onRetry;
  final VoidCallback onWatchAgain;
  final bool isWeb;

  static const _green = Color(0xFF22C55E);
  static const _greenDark = Color(0xFF16A34A);
  static const _slateBorder = Color(0xFF334155);
  static const _slateCard = Color(0xFF111827);

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: Container(color: Colors.black.withValues(alpha: 0.82)),
            ),
          ),
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 400),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 280),
                  switchInCurve: Curves.easeOutCubic,
                  switchOutCurve: Curves.easeInCubic,
                  child: _buildCard(context),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(BuildContext context) {
    switch (phase) {
      case AdRewardPhase.loading:
        return _cardShell(
          key: const ValueKey('loading'),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 52,
                  height: 52,
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    color: _green,
                    backgroundColor: _slateBorder.withValues(alpha: 0.5),
                  ),
                ),
                const SizedBox(height: 22),
                const Text(
                  'Inapakia tangazo…',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Subiri kidogo',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade400, height: 1.4),
                ),
              ],
            ),
          ),
        );
      case AdRewardPhase.error:
        return _cardShell(
          key: const ValueKey('error'),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: const Color(0x33EF4444),
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0x55EF4444)),
                  ),
                  child: const Icon(Icons.wifi_off_rounded, size: 36, color: Color(0xFFF87171)),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Tangazo halipatikani',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 10),
                Text(
                  'Imeshindikana kupakia tangazo. Jaribu tena au ujaribu baadaye.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade400, height: 1.45),
                ),
                const SizedBox(height: 24),
                _primaryButton(
                  label: 'Jaribu tena',
                  icon: Icons.refresh_rounded,
                  gradient: const [Color(0xFF3B82F6), Color(0xFF2563EB)],
                  onPressed: onRetry,
                ),
                const SizedBox(height: 10),
                _secondaryButton(label: 'Funga', onPressed: onClose),
              ],
            ),
          ),
        );
      case AdRewardPhase.success:
        return _cardShell(
          key: ValueKey('success_$pointsEarned'),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 76,
                  height: 76,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [_green, _greenDark],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: _green.withValues(alpha: 0.45),
                        blurRadius: 20,
                        spreadRadius: 0,
                      ),
                    ],
                  ),
                  child: const Icon(Icons.check_rounded, size: 42, color: Colors.white),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Umepata pointi!',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 6),
                Text(
                  '+$pointsEarned',
                  style: const TextStyle(
                    fontSize: 40,
                    fontWeight: FontWeight.w900,
                    color: AppColors.gold,
                    height: 1.1,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Sasa unaweza kutumia pointi kufungua mechi. Angalia tena upate zaidi.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade300, height: 1.5),
                ),
                const SizedBox(height: 22),
                _primaryButton(
                  label: 'Angalia tena (pointi zaidi)',
                  icon: Icons.play_circle_filled_rounded,
                  gradient: const [_green, _greenDark],
                  onPressed: isWeb ? onClose : onWatchAgain,
                ),
                const SizedBox(height: 10),
                _secondaryButton(label: 'Maliza', onPressed: onClose),
              ],
            ),
          ),
        );
      case AdRewardPhase.prompt:
        return _cardShell(
          key: const ValueKey('prompt'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      gradient: LinearGradient(
                        colors: [
                          AppColors.gold.withValues(alpha: 0.35),
                          _green.withValues(alpha: 0.25),
                        ],
                      ),
                      border: Border.all(color: _slateBorder),
                    ),
                    child: const Icon(Icons.ondemand_video_rounded, color: AppColors.gold, size: 28),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Pointi za bure',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                            letterSpacing: -0.4,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Msaada wa EaMax',
                          style: TextStyle(fontSize: 13, color: Colors.grey.shade500, fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: _slateBorder),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.stars_rounded, size: 20, color: AppColors.gold.withValues(alpha: 0.95)),
                    const SizedBox(width: 8),
                    Text(
                      '+$pointsPerReward pointi kwa tangazo',
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.gold,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text(
                isWeb
                    ? 'Matangazo ya pointi yanapatikana kwenye app ya simu (Android / iOS).'
                    : 'Tazama tangazo fupi kabla ya kufunga. Ukikamilisha, pointi zitaongezwa kwenye akaunti yako.',
                style: TextStyle(fontSize: 14, color: Colors.grey.shade400, height: 1.5),
              ),
              const SizedBox(height: 24),
              _primaryButton(
                label: isWeb ? 'Sawa' : 'Tazama tangazo',
                icon: isWeb ? Icons.phone_android_rounded : Icons.play_arrow_rounded,
                gradient: const [_green, _greenDark],
                onPressed: isWeb ? onClose : onWatch,
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: onClose,
                style: TextButton.styleFrom(
                  foregroundColor: Colors.grey.shade400,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                child: const Text('Si sasa', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
              ),
            ],
          ),
        );
    }
  }

  Widget _cardShell({required Key key, required Widget child}) {
    return Container(
      key: key,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1E293B), _slateCard],
        ),
        border: Border.all(color: _slateBorder.withValues(alpha: 0.9)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.55),
            blurRadius: 40,
            offset: const Offset(0, 18),
          ),
          BoxShadow(
            color: _green.withValues(alpha: 0.08),
            blurRadius: 32,
            spreadRadius: -4,
          ),
        ],
      ),
      padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
      child: child,
    );
  }

  Widget _primaryButton({
    required String label,
    required IconData icon,
    required List<Color> gradient,
    required VoidCallback onPressed,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(colors: gradient),
            boxShadow: [
              BoxShadow(
                color: gradient.last.withValues(alpha: 0.45),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, color: Colors.white, size: 24),
                const SizedBox(width: 10),
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                      letterSpacing: -0.2,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _secondaryButton({required String label, required VoidCallback onPressed}) {
    return SizedBox(
      width: double.infinity,
      child: TextButton(
        onPressed: onPressed,
        style: TextButton.styleFrom(
          foregroundColor: Colors.grey.shade300,
          backgroundColor: const Color(0xFF374151),
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
      ),
    );
  }
}
