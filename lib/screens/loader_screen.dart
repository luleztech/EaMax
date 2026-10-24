import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';

class LoaderScreen extends StatefulWidget {
  const LoaderScreen({
    super.key,
    required this.onDone,
    this.canProceed = false,
    this.maxWaitForReady = const Duration(seconds: 6),
  });

  final VoidCallback onDone;
  /// Parent signals app bootstrap is far enough to enter the main shell.
  final bool canProceed;
  /// Never hold splash longer than this after the intro animation finishes.
  final Duration maxWaitForReady;

  @override
  State<LoaderScreen> createState() => _LoaderScreenState();
}

class _LoaderScreenState extends State<LoaderScreen> with TickerProviderStateMixin {
  late final AnimationController _intro = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );
  late final AnimationController _bar = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  )..repeat();
  late final AnimationController _exit = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 320),
  );

  late final Animation<double> _markIn =
      CurvedAnimation(parent: _intro, curve: const Interval(0.0, 0.65, curve: Curves.easeOutCubic));
  late final Animation<double> _wordIn =
      CurvedAnimation(parent: _intro, curve: const Interval(0.25, 0.85, curve: Curves.easeOutCubic));
  late final Animation<double> _tagIn =
      CurvedAnimation(parent: _intro, curve: const Interval(0.45, 1.0, curve: Curves.easeOutCubic));
  late final Animation<double> _out = CurvedAnimation(parent: _exit, curve: Curves.easeInCubic);

  bool _leaving = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _run());
  }

  Future<void> _run() async {
    await _intro.forward();
    final deadline = DateTime.now().add(widget.maxWaitForReady);
    while (mounted && !widget.canProceed && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 80));
    }
    if (!mounted || _leaving) return;
    _leaving = true;
    await _exit.forward();
    if (mounted) widget.onDone();
  }

  @override
  void dispose() {
    _intro.dispose();
    _bar.dispose();
    _exit.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      backgroundColor: Tpl.slate950,
      body: AnimatedBuilder(
        animation: _out,
        builder: (context, child) => Opacity(
          opacity: 1 - _out.value,
          child: Transform.scale(scale: 1 + _out.value * 0.04, child: child),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(0, -0.14),
                  radius: 0.8,
                  colors: [Color(0x1FA3E635), Color(0x00A3E635)],
                ),
              ),
            ),
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _Reveal(
                    animation: _markIn,
                    scaleFrom: 0.82,
                    child: const _Mark(),
                  ),
                  const SizedBox(height: 26),
                  _Reveal(
                    animation: _wordIn,
                    slideFrom: 10,
                    child: Text.rich(
                      TextSpan(
                        children: [
                          const TextSpan(text: 'Ea'),
                          TextSpan(text: 'Max', style: TextStyle(color: Tpl.lime400)),
                        ],
                      ),
                      style: manrope(36, weight: FontWeight.w800, color: Colors.white, letterSpacing: -1, height: 1),
                    ),
                  ),
                  const SizedBox(height: 10),
                  _Reveal(
                    animation: _tagIn,
                    slideFrom: 8,
                    child: Text(
                      'Mpira  ·  Tamthilia  ·  Habari',
                      style: manrope(14, weight: FontWeight.w600, color: Tpl.slate400, letterSpacing: 0.2),
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 56 + bottomInset,
              child: _Reveal(
                animation: _tagIn,
                child: Center(child: _LoadingBar(animation: _bar)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Fade in with an optional rise and grow.
class _Reveal extends StatelessWidget {
  const _Reveal({
    required this.animation,
    required this.child,
    this.slideFrom = 0,
    this.scaleFrom = 1,
  });

  final Animation<double> animation;
  final Widget child;
  final double slideFrom;
  final double scaleFrom;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: animation,
      child: child,
      builder: (context, child) {
        final t = animation.value;
        return Opacity(
          opacity: t,
          child: Transform.translate(
            offset: Offset(0, (1 - t) * slideFrom),
            child: Transform.scale(scale: scaleFrom + (1 - scaleFrom) * t, child: child),
          ),
        );
      },
    );
  }
}

class _Mark extends StatelessWidget {
  const _Mark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 92,
      height: 92,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Tpl.lime300, Tpl.lime400],
        ),
        boxShadow: [
          BoxShadow(color: Tpl.lime400.withValues(alpha: 0.32), blurRadius: 48, spreadRadius: -6, offset: const Offset(0, 14)),
        ],
      ),
      child: const Icon(Icons.play_arrow_rounded, size: 58, color: Tpl.slate950),
    );
  }
}

/// Slim indeterminate bar: a lime segment gliding across a faint track.
class _LoadingBar extends StatelessWidget {
  const _LoadingBar({required this.animation});

  final Animation<double> animation;

  static const _width = 112.0;
  static const _segment = 38.0;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: SizedBox(
        width: _width,
        height: 3,
        child: Stack(
          children: [
            Positioned.fill(child: ColoredBox(color: Tpl.hairline(0.08))),
            AnimatedBuilder(
              animation: animation,
              builder: (context, _) {
                final t = Curves.easeInOutCubic.transform(animation.value);
                return Positioned(
                  left: -_segment + (_width + _segment) * t,
                  top: 0,
                  bottom: 0,
                  width: _segment,
                  child: const DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.all(Radius.circular(99)),
                      color: Tpl.lime400,
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
