import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/api.dart';
import '../services/remote_config_service.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../theme/ionicons_compat.dart';

/// Always-visible WhatsApp support row (Mtumiaji tab).
class WhatsappSupportTile extends StatefulWidget {
  const WhatsappSupportTile({super.key});

  @override
  State<WhatsappSupportTile> createState() => _WhatsappSupportTileState();
}

class _WhatsappSupportTileState extends State<WhatsappSupportTile> {
  String? _whatsapp;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await settingsApi.getWhatsAppNumber();
      final n = data['number']?.toString().replaceAll(RegExp(r'\s+'), '');
      if (mounted && n != null && n.isNotEmpty) {
        setState(() => _whatsapp = n);
        return;
      }
    } catch (_) {}
    final fallback = RemoteConfigService.cached?.paymentConfig.whatsappNumber?.trim();
    if (mounted && fallback != null && fallback.isNotEmpty) {
      setState(() => _whatsapp = fallback);
    }
  }

  Future<void> _open() async {
    final d = _whatsapp?.replaceAll(RegExp(r'\D'), '') ?? '';
    if (d.length < 8) return;
    final u = Uri.parse('https://wa.me/$d');
    if (await canLaunchUrl(u)) {
      await launchUrl(u, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.watch<ThemeController>().colors;
    const waGreen = Color(0xFF25D366);

    return Material(
      color: t.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: waGreen.withValues(alpha: 0.35)),
      ),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        onTap: _open,
        leading: Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            gradient: LinearGradient(
              colors: [waGreen, waGreen.withValues(alpha: 0.75)],
            ),
            boxShadow: [BoxShadow(color: waGreen.withValues(alpha: 0.25), blurRadius: 8)],
          ),
          alignment: Alignment.center,
          child: const Icon(Ionicons.logo_whatsapp, size: 22, color: Colors.white),
        ),
        title: Text(
          'Msaada masaa 24',
          style: rajdhani(15, weight: FontWeight.w700).copyWith(color: t.text),
        ),
        subtitle: Text(
          'Chat na timu yetu kupitia WhatsApp',
          style: rajdhani(12).copyWith(color: t.text2),
        ),
        trailing: Icon(Icons.arrow_forward_ios_rounded, size: 14, color: waGreen.withValues(alpha: 0.9)),
      ),
    );
  }
}
