import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

TextStyle _noUnderline(TextStyle style) => style.copyWith(
      decoration: TextDecoration.none,
      decorationColor: Colors.transparent,
      decorationThickness: 0,
    );

TextStyle _base(double size, {FontWeight weight = FontWeight.w500, double? letterSpacing}) {
  // On web, runtime Google Fonts fetch often fails (CDN / CanvasKit). Use system UI.
  if (kIsWeb || !GoogleFonts.config.allowRuntimeFetching) {
    return _noUnderline(TextStyle(
      fontSize: size,
      fontWeight: weight,
      letterSpacing: letterSpacing,
      fontFamily: 'Roboto',
    ));
  }
  try {
    return _noUnderline(
      GoogleFonts.inter(fontSize: size, fontWeight: weight, letterSpacing: letterSpacing),
    );
  } catch (_) {
    return _noUnderline(TextStyle(fontSize: size, fontWeight: weight, letterSpacing: letterSpacing));
  }
}

TextStyle orbitron(double size, {FontWeight weight = FontWeight.w800}) =>
    _base(size, weight: weight, letterSpacing: -0.5);

TextStyle rajdhani(double size, {FontWeight weight = FontWeight.w500}) =>
    _base(size, weight: weight);

TextStyle inter(double size, {FontWeight weight = FontWeight.w500}) =>
    _base(size, weight: weight);
