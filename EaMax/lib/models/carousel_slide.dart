import 'package:flutter/material.dart';

class CarouselSlide {
  CarouselSlide({
    required this.title,
    this.subtitle,
    this.badge,
    this.imageUrl,
    this.videoUrl,
    this.id,
    required this.gradient,
    this.info = const [],
  });

  final String? title;
  final String? subtitle;
  final String? badge;
  final String? imageUrl;
  final String? videoUrl;
  final int? id;
  final List<Color> gradient;
  final List<CarouselInfoLine> info;
}

class CarouselInfoLine {
  CarouselInfoLine({this.iconName, required this.text});
  final String? iconName;
  final String text;
}
