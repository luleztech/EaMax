import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum ThemeKey { dark, neon, gold, crimson }

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

  static const _prefsKey = 'eamax_app_theme_v1';

  static Future<ThemeController> load() async {
    final p = await SharedPreferences.getInstance();
    var raw = p.getString(_prefsKey) ?? ThemeKey.crimson.name;
    var key = ThemeKey.crimson;
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
  int _tab = 0;
  int get currentTab => _tab;

  bool setTab(int index) {
    if (_tab == index) return false;
    _tab = index;
    notifyListeners();
    return true;
  }
}

/// Legacy aliases used across existing EaMax widgets.
class AppColors {
  AppColors._();

  static AppThemeColors of(BuildContext context) {
    final tc = Theme.of(context).extension<_EaMaxThemeExt>();
    return tc?.colors ?? kAppThemes[ThemeKey.crimson]!;
  }

  static const Color scaffold = Color(0xFF000000);
  static const Color accentBlue = Color(0xFFe8002d);
  static const Color gold = Color(0xFFeab308);
  static const Color premiumBtn = Color(0xFFeab308);
  static const Color navBg = Color(0xF5000000);
  static const Color muted = Color(0xFFa1a1aa);
  static const Color liveRed = Color(0xFFdc2626);

  static List<Color> get backgroundGradient => [
        ofGlobal.bg2,
        ofGlobal.bg1,
      ];

  static final AppThemeColors ofGlobal = kAppThemes[ThemeKey.crimson]!;

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
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: colors.bg1,
    colorScheme: ColorScheme.dark(primary: colors.accent, surface: colors.bg1),
    extensions: [_EaMaxThemeExt(colors)],
    textTheme: base.textTheme.apply(decoration: TextDecoration.none),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      foregroundColor: Colors.white,
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
