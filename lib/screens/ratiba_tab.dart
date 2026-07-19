import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/channel_ui.dart';
import '../models/schedule_item.dart';
import '../services/ratiba_reminders.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/pro_shimmer.dart';
import '../widgets/safe_network_image.dart';

/// TV schedule tab — day picker, event artwork, timed live opens, bell reminders.
class RatibaTab extends StatefulWidget {
  const RatibaTab({
    super.key,
    required this.schedule,
    required this.channels,
    required this.initialLoading,
    required this.refreshing,
    required this.bottomPad,
    required this.onRefresh,
    required this.isPremium,
    required this.channelsPremiumOnly,
    required this.onOpenChannel,
    required this.onRequirePremium,
  });

  final List<ScheduleItem> schedule;
  final List<ChannelUi> channels;
  final bool initialLoading;
  final bool refreshing;
  final double bottomPad;
  final Future<void> Function() onRefresh;
  final bool isPremium;
  final bool channelsPremiumOnly;
  final void Function(ChannelUi channel) onOpenChannel;
  final VoidCallback onRequirePremium;

  @override
  State<RatibaTab> createState() => _RatibaTabState();
}

class _RatibaTabState extends State<RatibaTab> {
  DateTime? _activeDay;
  final _dayScrollCtrl = ScrollController();
  bool _didAutoPick = false;
  bool _remindersReady = false;

  static const _weekdayShort = [
    'Jpili', 'Jtatu', 'Jnn', 'Jtano', 'Alh', 'Iju', 'Jmosi',
  ];

  static const _monthShort = [
    'Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun',
    'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des',
  ];

  DateTime get _eatNow {
    final utc = DateTime.now().toUtc();
    return utc.add(const Duration(hours: 3));
  }

  DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  @override
  void initState() {
    super.initState();
    _bootReminders();
  }

  Future<void> _bootReminders() async {
    await loadRatibaReminderIds();
    await resyncRatibaReminders(widget.schedule);
    if (mounted) setState(() => _remindersReady = true);
  }

  @override
  void didUpdateWidget(covariant RatibaTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.schedule != widget.schedule) {
      resyncRatibaReminders(widget.schedule);
    }
  }

  List<DateTime> _daysWithEvents(List<ScheduleItem> schedule) {
    final today = _dateOnly(_eatNow);
    final dates = <DateTime>{};
    for (final s in schedule) {
      final raw = s.date;
      if (raw == null) continue;
      final d = _dateOnly(raw);
      if (!d.isBefore(today)) dates.add(d);
    }
    final sorted = dates.toList()..sort();
    return sorted;
  }

  List<ScheduleItem> _itemsForDay(List<ScheduleItem> schedule, DateTime day) {
    final items = schedule.where((s) {
      final raw = s.date;
      if (raw == null) return false;
      return _sameDay(raw, day);
    }).toList()
      ..sort((a, b) {
        final da = a.date ?? DateTime(0);
        final db = b.date ?? DateTime(0);
        return da.compareTo(db);
      });
    return items;
  }

  String _dayLabel(DateTime day) {
    final today = _dateOnly(_eatNow);
    if (_sameDay(day, today)) return 'Leo';
    return _weekdayShort[day.weekday % 7];
  }

  String _eventDateLabel(DateTime? dt) {
    if (dt == null) return '';
    return '${dt.day} ${_monthShort[dt.month - 1]}';
  }

  void _pickDefaultDayIfNeeded(List<DateTime> days) {
    if (days.isEmpty) {
      if (_activeDay != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _activeDay = null);
        });
      }
      return;
    }
    if (_activeDay != null && days.any((d) => _sameDay(d, _activeDay!))) return;
    final today = _dateOnly(_eatNow);
    final todayIdx = days.indexWhere((d) => _sameDay(d, today));
    final next = todayIdx >= 0 ? days[todayIdx] : days.first;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() => _activeDay = next);
      _scrollToActiveDay(days);
    });
  }

  void _scrollToActiveDay(List<DateTime> days) {
    if (_didAutoPick || _activeDay == null || !_dayScrollCtrl.hasClients) return;
    final idx = days.indexWhere((d) => _sameDay(d, _activeDay!));
    if (idx <= 0) {
      _didAutoPick = true;
      return;
    }
    _didAutoPick = true;
    final offset = (idx * 71.0).clamp(0.0, _dayScrollCtrl.position.maxScrollExtent);
    _dayScrollCtrl.animateTo(offset, duration: const Duration(milliseconds: 420), curve: Curves.easeOutCubic);
  }

  ChannelUi? _resolveChannel(ScheduleItem item) {
    if (item.channelId != null) {
      for (final c in widget.channels) {
        if (c.id == item.channelId) return c;
      }
    }
    final name = item.channel.trim().toLowerCase();
    if (name.isEmpty) return null;
    for (final c in widget.channels) {
      if (c.name.trim().toLowerCase() == name) return c;
    }
    return null;
  }

  bool _channelLocked(ChannelUi ch) {
    if (widget.isPremium) return false;
    if (channelIsFreeForCatalog(ch, widget.channelsPremiumOnly)) return false;
    if (widget.channelsPremiumOnly) return true;
    return ch.pointsRequired > 0;
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating),
    );
  }

  void _onRowTap(ScheduleItem item) {
    if (!item.isClickableLive) {
      final t = item.date;
      final label = t == null
          ? 'baadaye'
          : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
      _toast('Bado haijaanza · itakuwa LIVE saa $label');
      return;
    }

    final ch = _resolveChannel(item);
    if (ch == null) {
      _toast('Hakuna channel iliyounganishwa na kipindi hiki');
      return;
    }

    // Never open for non‑subscribers — even if they set a bell.
    if (_channelLocked(ch)) {
      widget.onRequirePremium();
      return;
    }

    widget.onOpenChannel(ch);
  }

  Future<void> _onBellTap(ScheduleItem item) async {
    final on = await toggleRatibaReminder(item);
    if (!mounted) return;
    setState(() {});
    _toast(on
        ? 'Utajulishwa wakati kipindi kitakapoanza'
        : 'Arifa ya kipindi imezimwa');
  }

  @override
  void dispose() {
    _dayScrollCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    final schedule = widget.schedule;
    final days = _daysWithEvents(schedule);
    _pickDefaultDayIfNeeded(days);

    final active = _activeDay ?? (days.isEmpty ? null : days.first);
    final dayItems = active == null ? <ScheduleItem>[] : _itemsForDay(schedule, active);
    final loading = (widget.initialLoading || widget.refreshing) && schedule.isEmpty;

    return ColoredBox(
      color: t.bg1,
      child: RefreshIndicator(
        color: t.accent,
        onRefresh: widget.onRefresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.only(bottom: widget.bottomPad),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Ratiba', style: orbitron(22, weight: FontWeight.w800).copyWith(color: t.text)),
                  const SizedBox(height: 4),
                  Text(
                    'Mipango ya vipindi na mechi',
                    style: rajdhani(13, weight: FontWeight.w600).copyWith(color: t.text2),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (loading)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  children: List.generate(
                    5,
                    (_) => const Padding(
                      padding: EdgeInsets.only(bottom: 10),
                      child: ShimmerBox(height: 96, radius: 18),
                    ),
                  ),
                ),
              )
            else if (days.isEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 48, 18, 0),
                child: Center(
                  child: Text(
                    'Hakuna ratiba kwa sasa',
                    style: rajdhani(14, weight: FontWeight.w600).copyWith(color: t.text2),
                  ),
                ),
              )
            else ...[
              SizedBox(
                height: 72,
                child: ListView.separated(
                  controller: _dayScrollCtrl,
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: days.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 9),
                  itemBuilder: (_, i) => _dayChip(days[i], t),
                ),
              ),
              const SizedBox(height: 16),
              if (dayItems.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 24),
                  child: Text(
                    'Hakuna vipindi siku hii',
                    style: rajdhani(13, weight: FontWeight.w600).copyWith(color: t.text2),
                  ),
                )
              else
                ...List.generate(dayItems.length, (i) => _scheduleRow(dayItems[i], i, t)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _dayChip(DateTime day, AppThemeColors t) {
    final active = _activeDay != null && _sameDay(day, _activeDay!);
    return GestureDetector(
      onTap: () => setState(() => _activeDay = day),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        width: 62,
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: active
              ? LinearGradient(colors: [t.accent, Color.lerp(t.accent, Colors.black, 0.35)!])
              : null,
          color: active ? null : t.card,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: active ? t.accent.withValues(alpha: 0.5) : t.border.withValues(alpha: 0.65)),
          boxShadow: active
              ? [
                  BoxShadow(
                    color: t.accent.withValues(alpha: 0.28),
                    blurRadius: 16,
                    offset: const Offset(0, 8),
                  ),
                ]
              : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _dayLabel(day),
              style: rajdhani(11, weight: FontWeight.w700).copyWith(
                color: active ? Colors.white.withValues(alpha: 0.8) : t.text2,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '${day.day}'.padLeft(2, '0'),
              style: orbitron(18, weight: FontWeight.w800).copyWith(
                color: active ? Colors.white : t.text,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _scheduleRow(ScheduleItem item, int index, AppThemeColors t) {
    final reminded = _remindersReady && isRatibaReminded(item.id);
    final dateLabel = _eventDateLabel(item.date);
    final live = item.isClickableLive;
    final lockedPreview = () {
      final ch = _resolveChannel(item);
      return ch != null && _channelLocked(ch);
    }();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 54,
            child: Column(
              children: [
                Text(
                  item.time,
                  style: orbitron(14, weight: FontWeight.w800).copyWith(
                    color: live ? t.accent : t.text,
                  ),
                ),
                Text(
                  item.ampm,
                  style: rajdhani(10, weight: FontWeight.w700).copyWith(color: t.text2),
                ),
                if (dateLabel.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(dateLabel, style: rajdhani(9, weight: FontWeight.w700).copyWith(color: t.text2)),
                ],
                Container(
                  width: 2,
                  height: 84,
                  margin: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: live ? t.accent.withValues(alpha: 0.45) : t.border.withValues(alpha: 0.55),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Opacity(
                opacity: live ? 1 : 0.72,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => _onRowTap(item),
                    borderRadius: BorderRadius.circular(18),
                    child: Ink(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: live
                              ? t.accent.withValues(alpha: 0.45)
                              : t.border.withValues(alpha: 0.65),
                        ),
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            t.card,
                            t.card.withValues(alpha: 0.94),
                            t.bg2.withValues(alpha: 0.4),
                          ],
                        ),
                      ),
                      child: Row(
                        children: [
                          _thumb(item, t),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        item.title,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: rajdhani(14, weight: FontWeight.w700).copyWith(color: t.text),
                                      ),
                                    ),
                                    if (live) ...[
                                      const SizedBox(width: 7),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: t.free,
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          'LIVE',
                                          style: orbitron(8, weight: FontWeight.w900).copyWith(color: Colors.white),
                                        ),
                                      ),
                                    ] else ...[
                                      const SizedBox(width: 7),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: t.bg1,
                                          borderRadius: BorderRadius.circular(6),
                                          border: Border.all(color: t.border),
                                        ),
                                        child: Text(
                                          'IJAYO',
                                          style: orbitron(8, weight: FontWeight.w800).copyWith(color: t.text2),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  [
                                    if (dateLabel.isNotEmpty) dateLabel,
                                    if (item.subtitle.isNotEmpty) item.subtitle,
                                    if (lockedPreview) 'PREMIUM',
                                  ].join(' · '),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: rajdhani(11.5, weight: FontWeight.w600).copyWith(color: t.text2),
                                ),
                                if (!live)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Text(
                                      'Gusa baada ya muda kuanzia',
                                      style: rajdhani(10, weight: FontWeight.w600).copyWith(
                                        color: t.text2.withValues(alpha: 0.85),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          GestureDetector(
                            onTap: () => _onBellTap(item),
                            child: Container(
                              width: 42,
                              height: 42,
                              decoration: BoxDecoration(
                                color: reminded ? t.free : t.bg1,
                                borderRadius: BorderRadius.circular(13),
                                border: Border.all(color: reminded ? t.free : t.border),
                                boxShadow: reminded
                                    ? [
                                        BoxShadow(
                                          color: t.free.withValues(alpha: 0.28),
                                          blurRadius: 12,
                                          offset: const Offset(0, 4),
                                        ),
                                      ]
                                    : null,
                              ),
                              child: Icon(
                                reminded ? Icons.notifications_active_rounded : Icons.notifications_none_rounded,
                                color: reminded ? Colors.white : t.text2,
                                size: 18,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _thumb(ScheduleItem item, AppThemeColors t) {
    final poster = SafeNetworkImage.sanitize(item.imageUrl);
    final channelLogo = SafeNetworkImage.sanitize(_resolveChannel(item)?.thumbnailUrl ?? '');
    final url = poster.isNotEmpty ? poster : channelLogo;

    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(
        width: 64,
        height: 64,
        child: url.isEmpty
            ? _iconThumb(item)
            : SafeNetworkImage(
                imageUrl: url,
                width: 64,
                height: 64,
                fit: BoxFit.cover,
                placeholderColor: item.gradient.first,
                placeholder: (_, _) => Container(
                  decoration: BoxDecoration(gradient: LinearGradient(colors: item.gradient)),
                ),
                errorWidget: (_, _, _) {
                  // Poster failed (huge CDN file / timeout) → try channel logo, then icon.
                  if (poster.isNotEmpty &&
                      channelLogo.isNotEmpty &&
                      channelLogo != poster) {
                    return SafeNetworkImage(
                      imageUrl: channelLogo,
                      width: 64,
                      height: 64,
                      fit: BoxFit.cover,
                      placeholderColor: item.gradient.first,
                      errorWidget: (_, _, _) => _iconThumb(item),
                      placeholder: (_, _) => Container(
                        decoration: BoxDecoration(gradient: LinearGradient(colors: item.gradient)),
                      ),
                    );
                  }
                  return _iconThumb(item);
                },
              ),
      ),
    );
  }

  Widget _iconThumb(ScheduleItem item) {
    return Container(
      decoration: BoxDecoration(gradient: LinearGradient(colors: item.gradient)),
      child: Icon(item.icon, color: Colors.white, size: 22),
    );
  }
}
