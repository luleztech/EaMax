import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import '../theme/ionicons_compat.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';

/// Swahili loading lines — cycle during splash.
const _kLoadingLines = [
  'Inapakia channel…',
  'Inajiandaa matangazo moja kwa moja…',
  'Mpira · Tamthilia · Habari',
  'Karibu EaMax',
];

/// Feature chips shown under tagline.
const _kFeatureChips = [
  (Ionicons.play_circle, 'Moja kwa moja'),
  (Ionicons.tv, 'Chaneli nyingi'),
  (Ionicons.diamond, 'Premium'),
];

class LoaderScreen extends StatefulWidget {
  const LoaderScreen({super.key, required this.onDone});

  final VoidCallback onDone;

  @override
  State<LoaderScreen> createState() => _LoaderScreenState();
}

class _LoaderScreenState extends State<LoaderScreen> with TickerProviderStateMixin {
  late final AnimationController _ambientCtrl;
  late final AnimationController _introCtrl;
  late final AnimationController _exitCtrl;
  late final AnimationController _shimmerCtrl;
  late final AnimationController _tiltCtrl;
  late final AnimationController _progressCtrl;
  late final Animation<double> _introScale;
  late final Animation<double> _introOpacity;
  late final Animation<double> _exitFade;
  late final Animation<double> _progressAnim;

  int _messageIndex = 0;
  bool _navigating = false;

  @override
  void initState() {
    super.initState();
    _ambientCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 10))..repeat();
    _shimmerCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 2800))..repeat();
    _tiltCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 4200))..repeat(reverse: true);

    _introCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));
    _introScale = Tween<double>(begin: 0.72, end: 1.0).animate(
      CurvedAnimation(parent: _introCtrl, curve: Curves.easeOutBack),
    );
    _introOpacity = CurvedAnimation(parent: _introCtrl, curve: const Interval(0.0, 0.7, curve: Curves.easeOut));

    _exitCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 480));
    _exitFade = CurvedAnimation(parent: _exitCtrl, curve: Curves.easeInCubic);

    _progressCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400));
    _progressAnim = CurvedAnimation(parent: _progressCtrl, curve: Curves.easeInOutCubic);

    WidgetsBinding.instance.addPostFrameCallback((_) => _run());
  }

  Future<void> _run() async {
    _progressCtrl.forward();
    await _introCtrl.forward();

    for (var i = 0; i < _kLoadingLines.length; i++) {
      if (!mounted) return;
      await Future<void>.delayed(const Duration(milliseconds: 520));
      if (!mounted) return;
      setState(() => _messageIndex = i);
    }

    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (!mounted || _navigating) return;
    _navigating = true;
    await _exitCtrl.forward();
    if (mounted) widget.onDone();
  }

  @override
  void dispose() {
    _ambientCtrl.dispose();
    _introCtrl.dispose();
    _exitCtrl.dispose();
    _shimmerCtrl.dispose();
    _tiltCtrl.dispose();
    _progressCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final size = MediaQuery.sizeOf(context);

    return AnimatedBuilder(
      animation: _exitFade,
      builder: (context, child) => Opacity(opacity: 1 - _exitFade.value, child: child),
      child: Scaffold(
        backgroundColor: const Color(0xFF030308),
        body: Stack(
          fit: StackFit.expand,
          children: [
            // Cinematic base gradient
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    const Color(0xFF030308),
                    Color.lerp(const Color(0xFF0a0510), t.accent, 0.08)!,
                    const Color(0xFF06060e),
                  ],
                  stops: const [0.0, 0.45, 1.0],
                ),
              ),
            ),

            // Depth grid + ambient orbs
            AnimatedBuilder(
              animation: _ambientCtrl,
              builder: (context, _) {
                final phase = _ambientCtrl.value * 2 * math.pi;
                return CustomPaint(
                  painter: _CinematicBgPainter(
                    phase: phase,
                    accent: t.accent,
                    accent2: t.accent2,
                  ),
                );
              },
            ),

            // Vignette
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: const Alignment(0, -0.15),
                  radius: 1.1,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.55),
                  ],
                  stops: const [0.35, 1.0],
                ),
              ),
            ),

            // Main content
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Column(
                  children: [
                    const Spacer(flex: 2),

                    FadeTransition(
                      opacity: _introOpacity,
                      child: ScaleTransition(
                        scale: _introScale,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _Logo3D(
                              tiltCtrl: _tiltCtrl,
                              shimmerCtrl: _shimmerCtrl,
                              ambientCtrl: _ambientCtrl,
                              accent: t.accent,
                              accent2: t.accent2,
                              glow: t.glow,
                            ),
                            const SizedBox(height: 32),

                            ShaderMask(
                              shaderCallback: (bounds) => LinearGradient(
                                colors: [Colors.white, Colors.white.withValues(alpha: 0.88)],
                              ).createShader(bounds),
                              child: Text(
                                'EAMAX',
                                style: orbitron(34, weight: FontWeight.w900).copyWith(
                                  color: Colors.white,
                                  letterSpacing: 10,
                                  height: 1,
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),

                            Text(
                              'Tazama moja kwa moja',
                              style: rajdhani(16, weight: FontWeight.w600).copyWith(
                                color: t.accent2.withValues(alpha: 0.95),
                                letterSpacing: 0.8,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Mpira · Tamthilia · Chaneli zote',
                              style: rajdhani(12).copyWith(
                                color: t.text2.withValues(alpha: 0.75),
                                letterSpacing: 1.2,
                              ),
                            ),

                            const SizedBox(height: 28),

                            // Feature chips
                            Wrap(
                              alignment: WrapAlignment.center,
                              spacing: 8,
                              runSpacing: 8,
                              children: _kFeatureChips.map((chip) {
                                return _FeatureChip(
                                  icon: chip.$1,
                                  label: chip.$2,
                                  accent: t.accent,
                                  border: t.border,
                                );
                              }).toList(),
                            ),
                          ],
                        ),
                      ),
                    ),

                    const Spacer(flex: 2),

                    // Loading status + progress
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 380),
                      switchInCurve: Curves.easeOutCubic,
                      switchOutCurve: Curves.easeInCubic,
                      transitionBuilder: (child, anim) => FadeTransition(
                        opacity: anim,
                        child: SlideTransition(
                          position: Tween<Offset>(begin: const Offset(0, 0.15), end: Offset.zero).animate(anim),
                          child: child,
                        ),
                      ),
                      child: Text(
                        _kLoadingLines[_messageIndex],
                        key: ValueKey<int>(_messageIndex),
                        textAlign: TextAlign.center,
                        style: rajdhani(14, weight: FontWeight.w500).copyWith(color: t.text2),
                      ),
                    ),
                    const SizedBox(height: 18),

                    AnimatedBuilder(
                      animation: _progressAnim,
                      builder: (context, _) {
                        return _ProgressBar(
                          value: _progressAnim.value,
                          accent: t.accent,
                          accent2: t.accent2,
                          width: size.width - 56,
                        );
                      },
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Inaendelea…',
                      style: rajdhani(11).copyWith(
                        color: t.text2.withValues(alpha: 0.5),
                        letterSpacing: 2,
                      ),
                    ),
                    SizedBox(height: 24 + MediaQuery.paddingOf(context).bottom),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 3D-style logo with perspective tilt, glass face, and light sweep.
class _Logo3D extends StatelessWidget {
  const _Logo3D({
    required this.tiltCtrl,
    required this.shimmerCtrl,
    required this.ambientCtrl,
    required this.accent,
    required this.accent2,
    required this.glow,
  });

  final AnimationController tiltCtrl;
  final AnimationController shimmerCtrl;
  final AnimationController ambientCtrl;
  final Color accent;
  final Color accent2;
  final Color glow;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([tiltCtrl, shimmerCtrl, ambientCtrl]),
      builder: (context, _) {
        final tilt = (tiltCtrl.value - 0.5) * 2;
        final sway = math.sin(ambientCtrl.value * 2 * math.pi) * 0.06;
        final lift = 8 + math.sin(ambientCtrl.value * 2 * math.pi + 1) * 4;

        return Transform(
          alignment: Alignment.center,
          transform: Matrix4.identity()
            ..setEntry(3, 2, 0.0012)
            ..rotateX(0.14 + tilt * 0.1)
            ..rotateY(sway + tilt * 0.08),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Ground shadow (3D depth cue)
              Container(
                width: 100,
                height: 18,
                margin: EdgeInsets.only(top: lift),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(99),
                  boxShadow: [
                    BoxShadow(
                      color: accent.withValues(alpha: 0.35),
                      blurRadius: 32,
                      spreadRadius: 4,
                    ),
                  ],
                ),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(99),
                    gradient: RadialGradient(
                      colors: [
                        accent.withValues(alpha: 0.45),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),

              Transform.translate(
                offset: Offset(0, -lift - 6),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // Back extrusion layer
                    Transform.translate(
                      offset: const Offset(6, 10),
                      child: Container(
                        width: 108,
                        height: 108,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(26),
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              accent.withValues(alpha: 0.25),
                              const Color(0xFF1a0a12),
                            ],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.8),
                              blurRadius: 24,
                              offset: const Offset(0, 16),
                            ),
                          ],
                        ),
                      ),
                    ),

                    // Main glass card
                    ClipRRect(
                      borderRadius: BorderRadius.circular(24),
                      child: BackdropFilter(
                        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                        child: Container(
                          width: 108,
                          height: 108,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(24),
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [
                                Color.lerp(accent, Colors.white, 0.15)!,
                                accent,
                                Color.lerp(accent2, accent, 0.4)!,
                              ],
                              stops: const [0.0, 0.45, 1.0],
                            ),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.35),
                              width: 1.2,
                            ),
                            boxShadow: [
                              BoxShadow(color: glow, blurRadius: 40, spreadRadius: -4),
                              BoxShadow(
                                color: accent.withValues(alpha: 0.5),
                                blurRadius: 28,
                                offset: const Offset(0, 12),
                              ),
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.6),
                                blurRadius: 20,
                                offset: const Offset(0, 20),
                              ),
                            ],
                          ),
                          child: Stack(
                            children: [
                              // Top highlight (3D bevel)
                              Positioned(
                                top: 0,
                                left: 0,
                                right: 0,
                                height: 44,
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                                    gradient: LinearGradient(
                                      begin: Alignment.topCenter,
                                      end: Alignment.bottomCenter,
                                      colors: [
                                        Colors.white.withValues(alpha: 0.28),
                                        Colors.transparent,
                                      ],
                                    ),
                                  ),
                                ),
                              ),

                              // Light sweep
                              Positioned.fill(
                                child: CustomPaint(
                                  painter: _SweepPainter(progress: shimmerCtrl.value),
                                ),
                              ),

                              // Letter
                              Center(
                                child: Text(
                                  'E',
                                  style: orbitron(52, weight: FontWeight.w900).copyWith(
                                    color: Colors.white,
                                    shadows: [
                                      Shadow(
                                        color: Colors.black.withValues(alpha: 0.45),
                                        blurRadius: 12,
                                        offset: const Offset(0, 4),
                                      ),
                                      Shadow(
                                        color: accent2.withValues(alpha: 0.6),
                                        blurRadius: 20,
                                      ),
                                    ],
                                  ),
                                ),
                              ),

                              // Bottom inner shadow
                              Positioned(
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: 36,
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    borderRadius: const BorderRadius.vertical(bottom: Radius.circular(24)),
                                    gradient: LinearGradient(
                                      begin: Alignment.bottomCenter,
                                      end: Alignment.topCenter,
                                      colors: [
                                        Colors.black.withValues(alpha: 0.35),
                                        Colors.transparent,
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _FeatureChip extends StatelessWidget {
  const _FeatureChip({
    required this.icon,
    required this.label,
    required this.accent,
    required this.border,
  });

  final IconData icon;
  final String label;
  final Color accent;
  final Color border;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(99),
            border: Border.all(color: border.withValues(alpha: 0.5)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: accent),
              const SizedBox(width: 6),
              Text(label, style: rajdhani(11, weight: FontWeight.w600).copyWith(color: Colors.white70)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProgressBar extends StatelessWidget {
  const _ProgressBar({
    required this.value,
    required this.accent,
    required this.accent2,
    required this.width,
  });

  final double value;
  final Color accent;
  final Color accent2;
  final double width;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: 4,
      child: Stack(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(99),
              color: Colors.white.withValues(alpha: 0.08),
            ),
          ),
          FractionallySizedBox(
            widthFactor: value.clamp(0.05, 1.0),
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(99),
                gradient: LinearGradient(colors: [accent, accent2]),
                boxShadow: [
                  BoxShadow(color: accent.withValues(alpha: 0.55), blurRadius: 10),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Perspective depth grid + floating orbs for cinematic 3D atmosphere.
class _CinematicBgPainter extends CustomPainter {
  _CinematicBgPainter({
    required this.phase,
    required this.accent,
    required this.accent2,
  });

  final double phase;
  final Color accent;
  final Color accent2;

  @override
  void paint(Canvas canvas, Size size) {
    final horizon = size.height * 0.42;
    final vanish = Offset(size.width * 0.5, horizon);

    // Perspective floor grid
    final gridPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.6;

    const lines = 14;
    for (var i = 0; i <= lines; i++) {
      final t = i / lines;
      final alpha = (0.04 + t * 0.12) * (0.7 + 0.3 * math.sin(phase + t * 3));
      gridPaint.color = accent.withValues(alpha: alpha);

      final y = horizon + (size.height - horizon) * t * t;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);

      final spread = size.width * (0.15 + t * 0.85);
      canvas.drawLine(
        Offset(vanish.dx - spread, y),
        Offset(vanish.dx + spread, y),
        gridPaint,
      );
    }

    for (var i = -6; i <= 6; i++) {
      final t = (i + 6) / 12;
      gridPaint.color = accent2.withValues(alpha: 0.03 + t * 0.06);
      canvas.drawLine(
        vanish,
        Offset(size.width * (0.5 + i * 0.12), size.height + 20),
        gridPaint,
      );
    }

    // Floating orbs (depth layers)
    final orbs = [
      (0.18, 0.22, 0.22, accent),
      (0.82, 0.18, 0.18, accent2),
      (0.12, 0.72, 0.14, accent2),
      (0.88, 0.68, 0.16, accent),
    ];

    for (var i = 0; i < orbs.length; i++) {
      final (ox, oy, r, color) = orbs[i];
      final drift = math.sin(phase + i * 1.4) * 12;
      final cx = size.width * ox + drift;
      final cy = size.height * oy + math.cos(phase + i) * 8;
      final radius = size.width * r;

      final orbPaint = Paint()
        ..shader = RadialGradient(
          colors: [
            color.withValues(alpha: 0.22),
            color.withValues(alpha: 0.06),
            Colors.transparent,
          ],
          stops: const [0.0, 0.45, 1.0],
        ).createShader(Rect.fromCircle(center: Offset(cx, cy), radius: radius));

      canvas.drawCircle(Offset(cx, cy), radius, orbPaint);
    }

    // Central spotlight behind logo
    final spot = Paint()
      ..shader = RadialGradient(
        colors: [
          accent.withValues(alpha: 0.18 + 0.04 * math.sin(phase)),
          accent2.withValues(alpha: 0.06),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(
        center: Offset(size.width * 0.5, size.height * 0.38),
        radius: size.width * 0.55,
      ));
    canvas.drawRect(Offset.zero & size, spot);
  }

  @override
  bool shouldRepaint(covariant _CinematicBgPainter old) => old.phase != phase;
}

/// Specular sweep across logo face.
class _SweepPainter extends CustomPainter {
  _SweepPainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final x = -size.width + (size.width * 2.4) * progress;
    final paint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
        colors: [
          Colors.transparent,
          Colors.white.withValues(alpha: 0.22),
          Colors.transparent,
        ],
        stops: const [0.35, 0.5, 0.65],
      ).createShader(Rect.fromLTWH(x, 0, size.width * 0.5, size.height))
      ..blendMode = BlendMode.plus;

    canvas.drawRect(Rect.fromLTWH(x, 0, size.width * 0.55, size.height), paint);
  }

  @override
  bool shouldRepaint(covariant _SweepPainter old) => old.progress != progress;
}
