import 'package:flutter/material.dart';

/// Visual tokens aligned with React Native `CombinedApp` / `StreamingApp`.
class AppColors {
  AppColors._();

  static const Color scaffold = Color(0xFF030712);
  static const Color headerBg = Color(0x99000000);
  static const Color accentBlue = Color(0xFF60A5FA);
  static const Color gold = Color(0xFFFBBF24);
  static const Color premiumBtn = Color(0xFFEAB308);
  static const Color navBg = Color(0xF0000000);
  static const Color muted = Color(0xFF9CA3AF);
  static const Color liveRed = Color(0xFFDC2626);

  static const List<Color> backgroundGradient = [
    Color(0xFF0C0F1A),
    Color(0xFF111827),
    Color(0xFF000000),
  ];

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

TextStyle? _noUnderline(TextStyle? s) => s?.copyWith(decoration: TextDecoration.none);

TextTheme _stripUnderlines(TextTheme t) {
  return t.copyWith(
    displayLarge: _noUnderline(t.displayLarge),
    displayMedium: _noUnderline(t.displayMedium),
    displaySmall: _noUnderline(t.displaySmall),
    headlineLarge: _noUnderline(t.headlineLarge),
    headlineMedium: _noUnderline(t.headlineMedium),
    headlineSmall: _noUnderline(t.headlineSmall),
    titleLarge: _noUnderline(t.titleLarge),
    titleMedium: _noUnderline(t.titleMedium),
    titleSmall: _noUnderline(t.titleSmall),
    bodyLarge: _noUnderline(t.bodyLarge),
    bodyMedium: _noUnderline(t.bodyMedium),
    bodySmall: _noUnderline(t.bodySmall),
    labelLarge: _noUnderline(t.labelLarge),
    labelMedium: _noUnderline(t.labelMedium),
    labelSmall: _noUnderline(t.labelSmall),
  );
}

ThemeData buildAppTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: AppColors.scaffold,
    colorScheme: ColorScheme.dark(
      primary: AppColors.accentBlue,
      surface: AppColors.scaffold,
    ),
    textTheme: _stripUnderlines(base.textTheme),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      foregroundColor: Colors.white,
    ),
    // On web, some browsers underline button text by default. Force "no underline"
    // for all Material text buttons/links in-app.
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        textStyle: const TextStyle(decoration: TextDecoration.none),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        textStyle: const TextStyle(decoration: TextDecoration.none),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        textStyle: const TextStyle(decoration: TextDecoration.none),
      ),
    ),
  );
}
