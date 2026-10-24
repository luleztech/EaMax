import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/api.dart';
import '../services/remote_config_service.dart';
import '../theme/app_theme.dart';
import '../theme/ionicons_compat.dart';
import 'template_ui.dart';

/// Always-visible WhatsApp support row (Mtumiaji tab).
class WhatsappSupportTile extends StatefulWidget {
  const WhatsappSupportTile({super.key, this.last = false});

  final bool last;

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
    return TplSettingRow(
      icon: TplIconName.chat,
      iconWidget: const Icon(Ionicons.logo_whatsapp, size: 20, color: Tpl.lime400),
      label: 'Msaada masaa 24',
      value: 'WhatsApp',
      last: widget.last,
      onTap: _open,
    );
  }
}
