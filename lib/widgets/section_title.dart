import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';

class SectionTitle extends StatelessWidget {
  const SectionTitle({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 18,
            decoration: BoxDecoration(
              color: t.accent,
              borderRadius: BorderRadius.circular(99),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            label.toUpperCase(),
            style: orbitron(13, weight: FontWeight.w800).copyWith(
              color: t.text,
              fontStyle: FontStyle.italic,
              letterSpacing: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}
