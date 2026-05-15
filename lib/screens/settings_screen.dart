import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ionicons/ionicons.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/api.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/app_header.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String? _whatsapp;

  @override
  void initState() {
    super.initState();
    _loadWhatsApp();
  }

  Future<void> _loadWhatsApp() async {
    try {
      final data = await settingsApi.getWhatsAppNumber();
      final n = data['number']?.toString().replaceAll(RegExp(r'\s+'), '');
      if (mounted && n != null && n.isNotEmpty) setState(() => _whatsapp = n);
    } catch (_) {}
  }

  Future<void> _openWhatsapp() async {
    final d = _whatsapp?.replaceAll(RegExp(r'\D'), '') ?? '';
    if (d.length < 8) return;
    final u = Uri.parse('https://wa.me/$d');
    if (await canLaunchUrl(u)) await launchUrl(u, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final tc = context.watch<ThemeController>();
    final t = tc.colors;
    final top = MediaQuery.paddingOf(context).top;

    return Scaffold(
      backgroundColor: t.bg1,
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.fromLTRB(24, top + 10, 24, 0),
              child: Row(
                children: [
                  BackBtn(onPress: () => Navigator.of(context).pop()),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ShaderMask(
                          shaderCallback: (b) => LinearGradient(colors: [t.accent, t.accent2]).createShader(b),
                          child: Text('Settings', style: orbitron(22, weight: FontWeight.w900).copyWith(color: Colors.white)),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Container(
                              width: 14,
                              height: 2,
                              decoration: BoxDecoration(
                                gradient: LinearGradient(colors: [t.accent, t.accent2]),
                                borderRadius: BorderRadius.circular(99),
                              ),
                            ),
                            const SizedBox(width: 7),
                            Text('PREFERENCES', style: rajdhani(11, weight: FontWeight.w600).copyWith(color: t.text2, letterSpacing: 3)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          SliverToBoxAdapter(child: Divider(height: 24, color: t.border.withValues(alpha: 0.4), indent: 24, endIndent: 24)),
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                _sectionTitle(t, Ionicons.color_palette_outline, 'THEME'),
                _themeRow(context, tc),
                const SizedBox(height: 24),
                _sectionTitle(t, Ionicons.information_circle_outline, 'APP INFO'),
                _group(t, [
                  _row(t, Ionicons.phone_portrait_outline, 'App Name', 'EaMax'),
                  _row(t, Ionicons.pricetag_outline, 'Version', '1.3.1'),
                ]),
                const SizedBox(height: 24),
                _sectionTitle(t, Ionicons.flash_outline, 'ACTIONS'),
                _group(t, [
                  _row(t, Ionicons.share_social_outline, 'Share App', 'Invite Friends', onTap: () {
                    Share.share('Tazama TV moja kwa moja na EaMax!', subject: 'EaMax');
                  }),
                  _row(t, Ionicons.heart_outline, 'Kuhusu EaMax', 'Soma', onTap: () => _openAbout(context)),
                ]),
                const SizedBox(height: 24),
                _sectionTitle(t, Ionicons.help_circle_outline, 'HELP'),
                _group(t, [
                  _row(t, Ionicons.logo_whatsapp, 'WhatsApp Support', 'Chat Now', onTap: _openWhatsapp),
                ]),
                const SizedBox(height: 40),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  void _openAbout(BuildContext context) {
    HapticFeedback.lightImpact();
    Navigator.of(context).push<void>(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 380),
        pageBuilder: (_, animation, __) => const _AboutEaMaxScreen(),
        transitionsBuilder: (_, anim, __, child) {
          final curved = CurvedAnimation(parent: anim, curve: Curves.easeOutCubic, reverseCurve: Curves.easeInCubic);
          return FadeTransition(
            opacity: curved,
            child: SlideTransition(
              position: Tween<Offset>(begin: const Offset(0, 0.06), end: Offset.zero).animate(curved),
              child: child,
            ),
          );
        },
      ),
    );
  }

  Widget _sectionTitle(AppThemeColors t, IconData icon, String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Icon(icon, size: 14, color: t.accent),
          const SizedBox(width: 8),
          Text(title, style: orbitron(13).copyWith(color: t.text, letterSpacing: 2)),
        ],
      ),
    );
  }

  Widget _themeRow(BuildContext context, ThemeController tc) {
    final t = tc.colors;
    const dots = [
      _Dot(ThemeKey.dark, [Color(0xFF1a0508), Color(0xFFe8002d)]),
      _Dot(ThemeKey.neon, [Color(0xFFff00ff), Color(0xFF00ffaa)]),
      _Dot(ThemeKey.gold, [Color(0xFFffd700), Color(0xFFff8c00)]),
      _Dot(ThemeKey.crimson, [Color(0xFFe8002d), Color(0xFFff6b6b)]),
    ];
    return Container(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: t.border)),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(color: t.bg1, borderRadius: BorderRadius.circular(8), border: Border.all(color: t.border)),
            child: Icon(Ionicons.color_palette_outline, size: 15, color: t.accent),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text('App Theme', style: rajdhani(14, weight: FontWeight.w600).copyWith(color: t.text))),
          Row(
            children: [
              for (final d in dots)
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: GestureDetector(
                    onTap: () {
                      HapticFeedback.selectionClick();
                      tc.setTheme(d.key);
                    },
                    child: Transform.scale(
                      scale: tc.themeKey == d.key ? 1.15 : 1.0,
                      child: Container(
                        width: 22,
                        height: 22,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(colors: d.colors),
                          border: tc.themeKey == d.key ? Border.all(color: Colors.white, width: 2) : null,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _group(AppThemeColors t, List<Widget> children) {
    return Container(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: t.border)),
      clipBehavior: Clip.antiAlias,
      child: Column(children: _joinDividers(t, children)),
    );
  }

  List<Widget> _joinDividers(AppThemeColors t, List<Widget> children) {
    final out = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      out.add(children[i]);
      if (i < children.length - 1) out.add(Divider(height: 1, color: t.border));
    }
    return out;
  }

  Widget _row(AppThemeColors t, IconData icon, String label, String value, {VoidCallback? onTap}) {
    return Material(
      color: t.card,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(color: t.bg1, borderRadius: BorderRadius.circular(8), border: Border.all(color: t.border)),
                child: Icon(icon, size: 15, color: t.accent),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(label, style: rajdhani(14, weight: FontWeight.w600).copyWith(color: t.text))),
              Flexible(
                child: Text(value, textAlign: TextAlign.end, style: rajdhani(13).copyWith(color: t.text2), overflow: TextOverflow.ellipsis, maxLines: 2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Dot {
  const _Dot(this.key, this.colors);
  final ThemeKey key;
  final List<Color> colors;
}

class _AboutEaMaxScreen extends StatelessWidget {
  const _AboutEaMaxScreen();

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    return Scaffold(
      backgroundColor: t.bg1,
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(colors: [t.bg1, t.bg2, t.bg1.withValues(alpha: 0.95)])),
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              BackBtn(onPress: () => Navigator.pop(context)),
              const SizedBox(height: 24),
              Center(
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [t.accent, t.accent2])),
                  child: Icon(Ionicons.tv, color: Colors.white, size: 28),
                ),
              ),
              const SizedBox(height: 20),
              Text('EaMax', textAlign: TextAlign.center, style: orbitron(24, weight: FontWeight.w900).copyWith(color: t.text)),
              const SizedBox(height: 12),
              Text(
                'Tazama mechi, filamu na channel moja kwa moja. Premium inafungua channel zote.',
                textAlign: TextAlign.center,
                style: rajdhani(14).copyWith(color: t.text2, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
