import 'package:flutter/material.dart';

/// Bundled in `assets/fonts/` so it renders offline and on web.
const String kAppFontFamily = 'Manrope';

TextStyle _base(double size, {FontWeight weight = FontWeight.w500, double? letterSpacing}) => TextStyle(
      fontFamily: kAppFontFamily,
      fontSize: size,
      fontWeight: weight,
      letterSpacing: letterSpacing,
      decoration: TextDecoration.none,
      decorationColor: Colors.transparent,
      decorationThickness: 0,
    );

TextStyle orbitron(double size, {FontWeight weight = FontWeight.w800}) =>
    _base(size, weight: weight, letterSpacing: -0.5);

TextStyle rajdhani(double size, {FontWeight weight = FontWeight.w500}) =>
    _base(size, weight: weight);

TextStyle inter(double size, {FontWeight weight = FontWeight.w500}) =>
    _base(size, weight: weight);

/// Template type scale (Tailwind sizes from the Figma design).
TextStyle manrope(double size, {FontWeight weight = FontWeight.w500, Color? color, double? height, double? letterSpacing}) =>
    _base(size, weight: weight, letterSpacing: letterSpacing).copyWith(color: color, height: height);
