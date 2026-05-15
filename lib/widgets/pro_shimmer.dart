import 'package:flutter/material.dart';

class ProShimmer extends StatefulWidget {
  const ProShimmer({
    super.key,
    required this.child,
    this.duration = const Duration(milliseconds: 1400),
  });

  final Widget child;
  final Duration duration;

  @override
  State<ProShimmer> createState() => _ProShimmerState();
}

class _ProShimmerState extends State<ProShimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: widget.duration,
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (rect) {
            return LinearGradient(
              begin: Alignment(-1.2 + t * 2.4, -0.15),
              end: Alignment(-0.2 + t * 2.4, 0.15),
              colors: const [Color(0xFF1f2937), Color(0xFF374151), Color(0xFF1f2937)],
              stops: const [0.25, 0.5, 0.75],
            ).createShader(rect);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

class ShimmerBox extends StatelessWidget {
  const ShimmerBox({super.key, this.width, this.height, this.radius = 12, this.baseColor = const Color(0xFF23252c)});

  final double? width;
  final double? height;
  final double radius;
  final Color baseColor;

  @override
  Widget build(BuildContext context) {
    return ProShimmer(
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(color: baseColor, borderRadius: BorderRadius.circular(radius)),
      ),
    );
  }
}
