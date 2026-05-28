import 'package:flutter/material.dart';
import '../theme/ionicons_compat.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/app_typography.dart';

class HomeSearchBar extends StatelessWidget {
  const HomeSearchBar({
    super.key,
    required this.open,
    required this.query,
    required this.focusNode,
    required this.onChanged,
    required this.onClear,
  });

  final bool open;
  final String query;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;

    return AnimatedCrossFade(
      firstChild: const SizedBox.shrink(),
      secondChild: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: const Color(0xCC18181b),
            borderRadius: BorderRadius.circular(99),
            border: Border.all(color: open ? t.accent : t.border),
          ),
          child: Row(
            children: [
              const Icon(Ionicons.search_outline, size: 16, color: Color(0xFFa1a1aa)),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  focusNode: focusNode,
                  onChanged: onChanged,
                  style: rajdhani(14, weight: FontWeight.w600).copyWith(color: t.text),
                  decoration: InputDecoration(
                    isDense: true,
                    border: InputBorder.none,
                    hintText: 'Tafuta channel…',
                    hintStyle: TextStyle(color: t.text2.withValues(alpha: 0.53)),
                  ),
                ),
              ),
              if (query.isNotEmpty)
                IconButton(
                  onPressed: onClear,
                  icon: Icon(Ionicons.close_circle, size: 18, color: t.text2),
                ),
            ],
          ),
        ),
      ),
      crossFadeState: open ? CrossFadeState.showSecond : CrossFadeState.showFirst,
      duration: const Duration(milliseconds: 220),
    );
  }
}
