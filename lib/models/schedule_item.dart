import 'package:flutter/material.dart';

/// TV schedule row — matches `/api/schedule` wire format.
class ScheduleItem {
  final String id;
  final String time;
  final String ampm;
  final String title;
  final String subtitle;
  final IconData icon;
  final bool live;
  final List<Color> gradient;
  final String channel;
  final int? channelId;
  final String imageUrl;
  final String? team1;
  final String? team2;
  /// Calendar date in Tanzania (EAT) wall-clock numbers from the API.
  final DateTime? date;

  const ScheduleItem({
    required this.id,
    required this.time,
    required this.ampm,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.live,
    required this.gradient,
    this.channel = '',
    this.channelId,
    this.imageUrl = '',
    this.team1,
    this.team2,
    this.date,
  });

  bool get isMatch => (team1?.isNotEmpty ?? false) && (team2?.isNotEmpty ?? false);

  /// True when EAT wall-clock has reached (or passed) the event start.
  bool get hasStarted {
    final d = date;
    if (d == null) return live;
    final utc = DateTime.now().toUtc();
    final eat = utc.add(const Duration(hours: 3));
    final nowWall = DateTime(eat.year, eat.month, eat.day, eat.hour, eat.minute);
    final eventWall = DateTime(d.year, d.month, d.day, d.hour, d.minute);
    return !nowWall.isBefore(eventWall);
  }

  bool get isClickableLive => hasStarted || live;

  static String periodLabel(DateTime dt) {
    final h = dt.hour;
    if (h >= 5 && h < 12) return 'asubuhi';
    if (h >= 12 && h < 16) return 'mchana';
    if (h >= 16 && h < 19) return 'jioni';
    return 'usiku';
  }

  static IconData iconFromKey(String? key) {
    switch ((key ?? '').trim()) {
      case 'sports_soccer_rounded':
      case 'sports_soccer':
      case 'soccer':
        return Icons.sports_soccer_rounded;
      case 'movie_rounded':
      case 'movie':
        return Icons.movie_rounded;
      case 'sports_basketball_rounded':
        return Icons.sports_basketball_rounded;
      case 'newspaper_rounded':
      case 'newspaper':
        return Icons.newspaper_rounded;
      case 'music_note_rounded':
        return Icons.music_note_rounded;
      case 'live_tv_rounded':
      case 'live_tv':
      default:
        return Icons.live_tv_rounded;
    }
  }

  static List<Color> gradientFromJson(List<dynamic>? raw, {int index = 0}) {
    const fallbacks = [
      [Color(0xFFE8002D), Color(0xFF7F1D1D)],
      [Color(0xFF16A34A), Color(0xFF14532D)],
      [Color(0xFF2563EB), Color(0xFF1E3A8A)],
      [Color(0xFFF59E0B), Color(0xFF92400E)],
      [Color(0xFF7C3AED), Color(0xFF4C1D95)],
      [Color(0xFF1D4A82), Color(0xFF2C6DB5)],
    ];
    if (raw == null || raw.length < 2) {
      return fallbacks[index % fallbacks.length];
    }
    Color parse(dynamic v, Color fb) {
      final s = v?.toString().trim() ?? '';
      if (s.isEmpty) return fb;
      final hex = s.startsWith('#') ? s.substring(1) : s;
      if (hex.length != 6) return fb;
      try {
        return Color(int.parse(hex, radix: 16) + 0xFF000000);
      } catch (_) {
        return fb;
      }
    }

    final fb = fallbacks[index % fallbacks.length];
    return [parse(raw[0], fb[0]), parse(raw[1], fb[1])];
  }

  factory ScheduleItem.fromJson(Map<String, dynamic> json, {int index = 0}) {
    final rawDt = (json['dateTime'] ?? json['match_time'] ?? json['date'] ?? '').toString();
    DateTime? dt;
    try {
      if (rawDt.isNotEmpty) {
        final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})').firstMatch(rawDt);
        if (m != null) {
          dt = DateTime(
            int.parse(m.group(1)!),
            int.parse(m.group(2)!),
            int.parse(m.group(3)!),
            int.parse(m.group(4)!),
            int.parse(m.group(5)!),
          );
        } else {
          dt = DateTime.parse(rawDt);
        }
      }
    } catch (_) {
      dt = null;
    }

    final team1 = (json['team1'] ?? '').toString().trim();
    final team2 = (json['team2'] ?? '').toString().trim();
    var title = (json['title'] ?? '').toString().trim();
    if (title.isEmpty && team1.isNotEmpty && team2.isNotEmpty) {
      title = '$team1 vs $team2';
    }
    if (title.isEmpty) {
      title = (json['league'] ?? 'Mechi').toString();
    }

    var subtitle = (json['subtitle'] ?? '').toString().trim();
    if (subtitle.isEmpty) {
      subtitle = (json['league'] ?? '').toString().trim();
    }
    final channel = (json['channel'] ?? json['channel_name'] ?? '').toString().trim();
    final displaySubtitle = [
      if (subtitle.isNotEmpty) subtitle,
      if (channel.isNotEmpty) channel,
    ].join(' · ');

    final channelIdRaw = json['channelId'] ?? json['channel_id'];
    final channelId = channelIdRaw == null ? null : int.tryParse(channelIdRaw.toString());
    final imageUrl = (json['imageUrl'] ?? json['image_url'] ?? '').toString().trim();

    return ScheduleItem(
      id: (json['id'] ?? '$title-${dt?.toIso8601String() ?? index}').toString(),
      time: dt != null ? '${dt.hour}' : '—',
      ampm: dt != null ? periodLabel(dt) : '',
      title: title,
      subtitle: displaySubtitle,
      icon: iconFromKey(json['icon']?.toString()),
      live: json['live'] == true || json['is_live'] == true,
      gradient: gradientFromJson(json['gradient'] as List<dynamic>?, index: index),
      channel: channel,
      channelId: channelId,
      imageUrl: imageUrl,
      team1: team1.isEmpty ? null : team1,
      team2: team2.isEmpty ? null : team2,
      date: dt,
    );
  }
}
