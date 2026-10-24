import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../utils/system_ui.dart';
import 'app_typography.dart';

enum ThemeKey { lime, dark, neon, gold, crimson }

/// Tailwind tokens from the Figma template (slate surfaces + lime accent).
class Tpl {
  Tpl._();

  static const Color slate950 = Color(0xFF020617);
  static const Color slate900 = Color(0xFF0F172A);
  static const Color slate800 = Color(0xFF1E293B);
  static const Color slate700 = Color(0xFF334155);
  static const Color slate600 = Color(0xFF475569);
  static const Color slate500 = Color(0xFF64748B);
  static const Color slate400 = Color(0xFF94A3B8);
  static const Color slate300 = Color(0xFFCBD5E1);
  static const Color lime400 = Color(0xFFA3E635);
  static const Color lime300 = Color(0xFFBEF264);
  static const Color red400 = Color(0xFFF87171);

  static Color hairline([double alpha = 0.06]) => Colors.white.withValues(alpha: alpha);
}

class AppThemeColors {
  const AppThemeColors({
    required this.bg1,
    required this.bg2,
    required this.card,
    required this.border,
    required this.accent,
    required this.accent2,
    required this.glow,
    required this.glow2,
    required this.gold,
    required this.text,
    required this.text2,
    required this.navBg,
    required this.premium,
    required this.free,
    required this.red,
  });

  final Color bg1;
  final Color bg2;
  final Color card;
  final Color border;
  final Color accent;
  final Color accent2;
  final Color glow;
  final Color glow2;
  final Color gold;
  final Color text;
  final Color text2;
  final Color navBg;
  final Color premium;
  final Color free;
  final Color red;
}

const Map<ThemeKey, AppThemeColors> kAppThemes = {
  ThemeKey.lime: AppThemeColors(
    bg1: Tpl.slate950,
    bg2: Tpl.slate950,
    card: Tpl.slate900,
    border: Tpl.slate800,
    accent: Tpl.lime400,
    accent2: Tpl.lime300,
    glow: Color.fromRGBO(163, 230, 53, 0.25),
    glow2: Color.fromRGBO(190, 242, 100, 0.2),
    gold: Color(0xFFeab308),
    text: Colors.white,
    text2: Tpl.slate400,
    navBg: Color(0xF2020617),
    premium: Color(0xFFeab308),
    free: Color(0xFF22c55e),
    red: Color(0xFFdc2626),
  ),
  ThemeKey.dark: AppThemeColors(
    bg1: Color(0xFF000000),
    bg2: Color(0xFF050508),
    card: Color(0xFF121215),
    border: Color(0xFF27272a),
    accent: Color(0xFFe8002d),
    accent2: Color(0xFFfb7185),
    glow: Color.fromRGBO(232, 0, 45, 0.35),
    glow2: Color.fromRGBO(251, 113, 133, 0.3),
    gold: Color(0xFFeab308),
    text: Color(0xFFfafafa),
    text2: Color(0xFFa1a1aa),
    navBg: Color(0xF5000000),
    premium: Color(0xFFeab308),
    free: Color(0xFF22c55e),
    red: Color(0xFFdc2626),
  ),
  ThemeKey.neon: AppThemeColors(
    bg1: Color(0xFF0a0a0a),
    bg2: Color(0xFF111111),
    card: Color(0xFF18181b),
    border: Color(0xFF27272a),
    accent: Color(0xFFa855f7),
    accent2: Color(0xFFec4899),
    glow: Color.fromRGBO(168, 85, 247, 0.35),
    glow2: Color.fromRGBO(236, 72, 153, 0.3),
    gold: Color(0xFFeab308),
    text: Color(0xFFfafafa),
    text2: Color(0xFFa1a1aa),
    navBg: Color(0xF5000000),
    premium: Color(0xFFeab308),
    free: Color(0xFF22c55e),
    red: Color(0xFFdc2626),
  ),
  ThemeKey.gold: AppThemeColors(
    bg1: Color(0xFF0a0a0a),
    bg2: Color(0xFF111111),
    card: Color(0xFF18181b),
    border: Color(0xFF27272a),
    accent: Color(0xFFf59e0b),
    accent2: Color(0xFFfbbf24),
    glow: Color.fromRGBO(245, 158, 11, 0.35),
    glow2: Color.fromRGBO(251, 191, 36, 0.3),
    gold: Color(0xFFeab308),
    text: Color(0xFFfafafa),
    text2: Color(0xFFa1a1aa),
    navBg: Color(0xF5000000),
    premium: Color(0xFFeab308),
    free: Color(0xFF22c55e),
    red: Color(0xFFdc2626),
  ),
  ThemeKey.crimson: AppThemeColors(
    bg1: Color(0xFF0a0a0a),
    bg2: Color(0xFF111111),
    card: Color(0xFF18181b),
    border: Color(0xFF27272a),
    accent: Color(0xFFe8002d),
    accent2: Color(0xFFfb7185),
    glow: Color.fromRGBO(232, 0, 45, 0.35),
    glow2: Color.fromRGBO(251, 113, 133, 0.3),
    gold: Color(0xFFeab308),
    text: Color(0xFFfafafa),
    text2: Color(0xFFa1a1aa),
    navBg: Color(0xF5000000),
    premium: Color(0xFFeab308),
    free: Color(0xFF22c55e),
    red: Color(0xFFdc2626),
  ),
};

class ThemeController extends ChangeNotifier {
  ThemeController._(this._key);

  /// Bumped with the template redesign so every install starts on [ThemeKey.lime].
  static const _prefsKey = 'eamax_app_theme_v2';

  static Future<ThemeController> load() async {
    final p = await SharedPreferences.getInstance();
    var raw = p.getString(_prefsKey) ?? ThemeKey.lime.name;
    var key = ThemeKey.lime;
    for (final v in ThemeKey.values) {
      if (v.name == raw) {
        key = v;
        break;
      }
    }
    return ThemeController._(key);
  }

  ThemeKey _key;
  ThemeKey get themeKey => _key;
  AppThemeColors get colors => kAppThemes[_key]!;

  Future<void> _persist() async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_prefsKey, _key.name);
  }

  void setTheme(ThemeKey key) {
    if (_key == key) return;
    _key = key;
    notifyListeners();
    _persist();
  }
}

class AppNav extends ChangeNotifier {
  /// Indices are persisted in notification payloads — append, never renumber.
  static const int home = 0;
  static const int ratiba = 1;
  static const int profile = 2;
  static const int channels = 3;
  static const int plans = 4;

  int _tab = home;
  int get currentTab => _tab;

  static int normalizeTab(int index) {
    if (index < home || index > plans) return home;
    return index;
  }

  bool setTab(int index) {
    final next = normalizeTab(index);
    if (_tab == next) return false;
    _tab = next;
    notifyListeners();
    return true;
  }
}

/// Legacy aliases used across existing EaMax widgets.
class AppColors {
  AppColors._();

  static AppThemeColors of(BuildContext context) {
    final tc = Theme.of(context).extension<_EaMaxThemeExt>();
    return tc?.colors ?? kAppThemes[ThemeKey.lime]!;
  }

  static const Color scaffold = Tpl.slate950;
  static const Color accentBlue = Tpl.lime400;
  static const Color gold = Color(0xFFeab308);
  static const Color premiumBtn = Color(0xFFeab308);
  static const Color navBg = Color(0xF5000000);
  static const Color muted = Color(0xFFa1a1aa);
  static const Color liveRed = Color(0xFFdc2626);

  static List<Color> get backgroundGradient => [
        ofGlobal.bg2,
        ofGlobal.bg1,
      ];

  static final AppThemeColors ofGlobal = kAppThemes[ThemeKey.lime]!;

  static const List<Color> glowColors = [
    Color(0xFFA855F7),
    Color(0xFF7C3AED),
    Color(0xFF6366F1),
    Color(0xFF3B82F6),
    Color(0xFF0EA5E9),
    Color(0xFF06B6D4),
    Color(0xFF10B981),
    Color(0xFF22C55E),
    Color(0xFF84CC16),
    Color(0xFFEAB308),
    Color(0xFFF97316),
    Color(0xFFEF4444),
    Color(0xFFEC4899),
    Color(0xFFF43F5E),
    Color(0xFFA855F7),
  ];
}

class _EaMaxThemeExt extends ThemeExtension<_EaMaxThemeExt> {
  const _EaMaxThemeExt(this.colors);
  final AppThemeColors colors;

  @override
  _EaMaxThemeExt copyWith({AppThemeColors? colors}) =>
      _EaMaxThemeExt(colors ?? this.colors);

  @override
  _EaMaxThemeExt lerp(ThemeExtension<_EaMaxThemeExt>? other, double t) {
    if (other is! _EaMaxThemeExt) return this;
    return other;
  }
}

ThemeData buildAppTheme(AppThemeColors colors) {
  final base = ThemeData.dark(useMaterial3: true);
  final onAccent = colors.accent.computeLuminance() > 0.5 ? Tpl.slate950 : Colors.white;
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    fontFamily: kAppFontFamily,
    scaffoldBackgroundColor: colors.bg1,
    colorScheme: ColorScheme.dark(
      primary: colors.accent,
      onPrimary: onAccent,
      secondary: colors.accent2,
      surface: colors.bg1,
      error: Tpl.red400,
    ),
    extensions: [_EaMaxThemeExt(colors)],
    textTheme: base.textTheme.apply(decoration: TextDecoration.none, fontFamily: kAppFontFamily),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: colors.card,
      contentTextStyle: const TextStyle(fontFamily: kAppFontFamily, color: Colors.white, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: colors.accent),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: colors.accent,
      selectionColor: colors.accent.withValues(alpha: 0.3),
      selectionHandleColor: colors.accent,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      foregroundColor: Colors.white,
      systemOverlayStyle: AppSystemUi.overlayStyle,
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(textStyle: const TextStyle(decoration: TextDecoration.none)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(textStyle: const TextStyle(decoration: TextDecoration.none)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(textStyle: const TextStyle(decoration: TextDecoration.none)),
    ),
  );
}
