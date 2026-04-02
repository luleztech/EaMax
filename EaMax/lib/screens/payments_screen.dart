import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/api.dart';
import '../theme/app_theme.dart';

const _accentCta = Color(0xFF22C55E);
const _accentCtaDark = Color(0xFF16A34A);

const _tzPrefixes = [
  '061', '062', '063', '065', '067', '068', '069',
  '071', '074', '075', '076', '077', '078', '079',
];

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({
    super.key,
    this.accentColor = AppColors.accentBlue,
    this.bottomPadding = 0,
    this.onPaymentSuccess,
  });

  final Color accentColor;
  final double bottomPadding;
  final Future<void> Function()? onPaymentSuccess;

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  String? _selectedBundle;
  final _phoneCtrl = TextEditingController();
  String? _whatsapp;
  String? _userId;
  bool _submitting = false;
  bool _statusOpen = false;
  String _statusTitle = '';
  String _statusMsg = '';
  bool _statusOk = true;
  String? _pollingOrderId;
  Timer? _pollTimer;
  int _notFoundStreak = 0;
  bool _simulating = false;

  final _bundles = const [
    _Bundle(id: 'week', name: 'Kwa Wiki', price: '2,000', duration: '7 siku', value: 2000, popular: false),
    _Bundle(id: 'month', name: 'Mwezi', price: '5,000', duration: '30 siku', value: 5000, popular: true),
    _Bundle(id: 'year', name: 'Miezi 3', price: '12,000', duration: 'miezi 3', value: 12000, popular: false),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final w = await settingsApi.getWhatsAppNumber();
      final n = w['number']?.toString();
      if (n != null && n.isNotEmpty) {
        setState(() => _whatsapp = n.replaceAll(RegExp(r'\s+'), ''));
      }
    } catch (_) {}

    final prefs = await SharedPreferences.getInstance();
    var uid = prefs.getString('userId');
    uid ??= prefs.getString('@eamax:userId');
    if (uid != null && uid.isNotEmpty) {
      await prefs.setString('userId', uid);
      setState(() => _userId = uid);
    }

    final pending = prefs.getString('pendingPaymentOrderId')?.trim();
    if (pending != null && pending.isNotEmpty) {
      try {
        final res = await paymentsApi.checkZenoStatus(pending);
        final st = res['status'] ?? res['raw']?['data']?[0]?['payment_status'];
        if (st.toString().toUpperCase() == 'COMPLETED') {
          await prefs.remove('pendingPaymentOrderId');
          await widget.onPaymentSuccess?.call();
        } else {
          setState(() => _pollingOrderId = pending);
          WidgetsBinding.instance.addPostFrameCallback((_) => _startPolling());
        }
      } catch (_) {}
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _phoneCtrl.dispose();
    super.dispose();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    final orderId = _pollingOrderId;
    if (orderId == null || orderId.isEmpty) return;

    var polls = 0;
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
      polls++;
      if (!mounted) return;
      try {
        final response = await paymentsApi.checkZenoStatus(orderId);
        final paymentStatus = response['status'] ?? response['raw']?['data']?[0]?['payment_status'];
        if (paymentStatus.toString() == 'COMPLETED') {
          _pollTimer?.cancel();
          _pollTimer = null;
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove('pendingPaymentOrderId');
          if (!mounted) return;
          setState(() {
            _pollingOrderId = null;
            _notFoundStreak = 0;
          });
          _showStatus(
            'Habari Njema!',
            'Malipo yako yamefaulu! Umebadilisha kuwa Premium. Sasa una access kwenye chaneli zote. Ikiwa chaneli bado hazifunguki, tafadhali subiri dakika chache au fungua tena programu.',
            true,
          );
          await Future<void>.delayed(const Duration(seconds: 1));
          await widget.onPaymentSuccess?.call();
        }
      } catch (e) {
        final msg = e.toString().toLowerCase();
        if (msg.contains('no order') || msg.contains('not found')) {
          _notFoundStreak++;
          if (_notFoundStreak >= 20) {
            _pollTimer?.cancel();
            _pollTimer = null;
            if (mounted) {
              setState(() {
                _pollingOrderId = null;
                _notFoundStreak = 0;
              });
              _showStatus(
                'Malipo Inasubiri uthibitisho',
                'Malipo yako yamepokelewa. Ikiwa haitafanyiwa kazi mara moja, tafadhali subiri dakika chache kisha ufungue tena programu.',
                true,
              );
            }
          }
        }
      }
      if (polls >= 100) {
        _pollTimer?.cancel();
        _pollTimer = null;
      }
    });
  }

  void _showStatus(String title, String msg, bool ok) {
    setState(() {
      _statusOpen = true;
      _statusTitle = title;
      _statusMsg = msg;
      _statusOk = ok;
    });
  }

  Future<void> _openWhatsApp() async {
    if (_whatsapp == null || _whatsapp!.isEmpty) {
      _showStatus(
        'Hakuna namba ya WhatsApp',
        'Tafadhali wasiliana na admin kuongeza namba ya WhatsApp kwenye sehemu ya Settings.',
        false,
      );
      return;
    }
    final phone = _whatsapp!.startsWith('+') ? _whatsapp!.substring(1) : _whatsapp!;
    final uri = Uri.parse('https://wa.me/$phone');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      _showStatus('Tatizo', 'Imeshindwa kufungua WhatsApp kwenye kifaa chako.', false);
    }
  }

  Future<void> _send() async {
    if (_selectedBundle == null) {
      _showStatus('Chagua bundle', 'Tafadhali chagua bundle unayotaka kulipa.', false);
      return;
    }
    final clean = _phoneCtrl.text.replaceAll(RegExp(r'\s+'), '');
    final validFormat = RegExp(r'^0\d{8,9}$').hasMatch(clean);
    final okPrefix = _tzPrefixes.any((p) => clean.startsWith(p));
    if (!validFormat || !okPrefix) {
      _showStatus(
        'Nambari ya simu',
        'Tafadhali ingiza nambari ya simu sahihi ya Tanzania (mfano: 0612345678, 0632345678, 0712345678, 0742345678, 0782345678).',
        false,
      );
      return;
    }
    if (_userId == null) {
      _showStatus(
        'Tatizo la akaunti',
        'Hatukuweza kutambua akaunti yako. Fungua tena sehemu ya wasifu (Profile) kisha ujaribu tena.',
        false,
      );
      return;
    }

    final bundle = _bundles.firstWhere((b) => b.id == _selectedBundle);
    setState(() => _submitting = true);
    try {
      final result = await paymentsApi.startZenoPayment(
        externalId: _userId!,
        bundle: bundle.id,
        amount: bundle.value,
        phone: clean,
        email: '$_userId@eamax.app',
        name: _userId!,
      );
      final orderId = result['orderId']?.toString();
      if (orderId != null && orderId.isNotEmpty) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('pendingPaymentOrderId', orderId);
        setState(() {
          _pollingOrderId = orderId;
          _notFoundStreak = 0;
        });
        WidgetsBinding.instance.addPostFrameCallback((_) => _startPolling());
      }
      _showStatus(
        'Ombi limetumwa',
        result['message']?.toString() ??
            'Ombi lako la malipo la Tsh.${bundle.price} kwa ${bundle.name} limetumwa kwa nambari $clean. Tafadhali fuata maelekezo utakayopokea kwenye simu yako.',
        true,
      );
      setState(() {
        _selectedBundle = null;
        _phoneCtrl.clear();
      });
    } catch (e) {
      _showStatus('Malipo yameshindikana', e.toString(), false);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _simulatePaid() async {
    final id = _pollingOrderId;
    if (id == null || _simulating) return;
    setState(() => _simulating = true);
    try {
      await paymentsApi.completePaymentForTesting(id);
      _pollTimer?.cancel();
      _pollTimer = null;
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('pendingPaymentOrderId');
      if (!mounted) return;
      setState(() => _pollingOrderId = null);
      _showStatus(
        'Habari Njema!',
        'Malipo yamefanikiwa (jaribio). Umebadilisha kuwa Premium. Chaneli zote sasa zimefunguliwa.',
        true,
      );
      await widget.onPaymentSuccess?.call();
    } catch (e) {
      _showStatus('Tatizo', e.toString(), false);
    } finally {
      if (mounted) setState(() => _simulating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = 48.0 + widget.bottomPadding;
    final ac = widget.accentColor;

    // Material is required for TextField / TextButton (enforced on web).
    return Material(
      color: AppColors.scaffold,
      child: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0xFF030712), Color(0xFF0F172A), Color(0xFF020617)],
                ),
              ),
            ),
          ),
          SafeArea(
            top: true,
            bottom: false,
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(20, 16, 20, bottom),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                Column(
                  children: [
                    Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        gradient: LinearGradient(
                          colors: [ac.withValues(alpha: 0.25), ac.withValues(alpha: 0.08)],
                        ),
                      ),
                      child: Icon(Icons.credit_card, color: ac, size: 36),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'Fanya Malipo',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Chagua muda, ingiza nambari ya simu. Utapokea ombi kwenye simu yako.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 15, color: Colors.blueGrey.shade300, height: 1.45),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                  decoration: BoxDecoration(
                    color: const Color(0x1410B981),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0x3310B981)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        mainAxisSize: MainAxisSize.min,
                        children: const [
                          Icon(Icons.verified_user, color: Color(0xFF10B981), size: 18),
                          SizedBox(width: 8),
                          Text('Salama', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF10B981))),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: const [
                          Padding(
                            padding: EdgeInsets.only(top: 1),
                            child: Icon(Icons.phone_android, color: Color(0xFF10B981), size: 18),
                          ),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'M-Pesa, Airtel, Tigo, Halopesa',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF10B981), height: 1.25),
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              softWrap: true,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  'CHAGUA MUDA',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Colors.blueGrey.shade300,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: _bundles.map((b) {
                    final sel = _selectedBundle == b.id;
                    return Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 5),
                        child: GestureDetector(
                          onTap: () => setState(() => _selectedBundle = b.id),
                          child: Container(
                            padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
                            decoration: BoxDecoration(
                              color: sel ? const Color(0x1F22C55E) : const Color(0x991E293B),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: sel ? _accentCta : const Color(0x66475569), width: 2),
                            ),
                            child: Stack(
                              clipBehavior: Clip.hardEdge,
                              children: [
                                if (sel)
                                  const Positioned(
                                    top: 4,
                                    right: 4,
                                    child: CircleAvatar(
                                      radius: 10,
                                      backgroundColor: _accentCta,
                                      child: Icon(Icons.check_rounded, size: 13, color: Colors.white),
                                    ),
                                  ),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    if (b.popular) ...[
                                      Center(
                                        child: FittedBox(
                                          fit: BoxFit.scaleDown,
                                          alignment: Alignment.center,
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                            decoration: BoxDecoration(
                                              gradient: const LinearGradient(
                                                begin: Alignment.topLeft,
                                                end: Alignment.bottomRight,
                                                colors: [Color(0xFF15803D), Color(0xFF22C55E)],
                                              ),
                                              borderRadius: BorderRadius.circular(999),
                                              border: Border.all(color: const Color(0x66FFFFFF), width: 1),
                                              boxShadow: const [
                                                BoxShadow(
                                                  color: Color(0x3322C55E),
                                                  blurRadius: 6,
                                                  offset: Offset(0, 2),
                                                ),
                                              ],
                                            ),
                                            child: const Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(Icons.auto_awesome_rounded, size: 12, color: Colors.white),
                                                SizedBox(width: 5),
                                                Text(
                                                  'Inayopendwa',
                                                  style: TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.w800,
                                                    color: Colors.white,
                                                    letterSpacing: 0.6,
                                                    height: 1,
                                                    decoration: TextDecoration.none,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                    ],
                                    Text(
                                      b.name,
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w700,
                                        color: sel ? Colors.white : const Color(0xFFE2E8F0),
                                        decoration: TextDecoration.none,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Text('Tsh. ${b.price}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _accentCta)),
                                    const SizedBox(height: 2),
                                    Text(
                                      b.duration,
                                      style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), decoration: TextDecoration.none),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 24),
                Text(
                  'NAMBA YAKO YA SIMU (TANZANIA)',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Colors.blueGrey.shade300,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  decoration: BoxDecoration(
                    color: const Color(0x991E293B),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0x66475569), width: 2),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
                        color: const Color(0x80334155),
                        child: Text('+255', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.blueGrey.shade300)),
                      ),
                      Expanded(
                        child: TextField(
                          controller: _phoneCtrl,
                          keyboardType: TextInputType.phone,
                          maxLength: 15,
                          style: const TextStyle(color: Colors.white, fontSize: 16),
                          decoration: const InputDecoration(
                            border: InputBorder.none,
                            hintText: 'Weka namba yako ya simu',
                            hintStyle: TextStyle(color: Color(0xFF64748B)),
                            counterText: '',
                            contentPadding: EdgeInsets.symmetric(horizontal: 14),
                          ),
                          onChanged: (_) => setState(() {}),
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 8, left: 4, right: 4),
                  child: Text(
                    'Weka namba yako iliyo na salio, ukianza na 0.',
                    style: TextStyle(fontSize: 12, color: Colors.blueGrey.shade400),
                  ),
                ),
                const SizedBox(height: 8),
                Opacity(
                  opacity: (_selectedBundle != null && _phoneCtrl.text.isNotEmpty && !_submitting) ? 1 : 0.7,
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: (_selectedBundle != null && _phoneCtrl.text.isNotEmpty && !_submitting) ? _send : null,
                      borderRadius: BorderRadius.circular(14),
                      child: Ink(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(14),
                          gradient: LinearGradient(
                            colors: (_selectedBundle != null && _phoneCtrl.text.isNotEmpty && !_submitting)
                                ? const [_accentCta, _accentCtaDark]
                                : const [Color(0xFF475569), Color(0xFF334155)],
                          ),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
                          child: _submitting
                              ? const Center(
                                  child: SizedBox(
                                    width: 22,
                                    height: 22,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                  ),
                                )
                              : Center(
                                  child: LayoutBuilder(
                                    builder: (context, c) {
                                      final w = c.maxWidth.isFinite ? c.maxWidth : MediaQuery.sizeOf(context).width;
                                      final labelMax = (w - 32 - 10 - 8).clamp(96.0, 280.0);
                                      return Row(
                                        mainAxisSize: MainAxisSize.min,
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          const Icon(Icons.send_rounded, color: Colors.white, size: 22),
                                          const SizedBox(width: 10),
                                          ConstrainedBox(
                                            constraints: BoxConstraints(maxWidth: labelMax),
                                            child: const Text(
                                              'Tuma ombi la malipo',
                                              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Colors.white),
                                              textAlign: TextAlign.center,
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                        ],
                                      );
                                    },
                                  ),
                                ),
                        ),
                      ),
                    ),
                  ),
                ),
                if (kDebugMode && _pollingOrderId != null) ...[
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: _simulating ? null : _simulatePaid,
                    child: Text(_simulating ? '...' : 'Test: Mark as paid (unlock Premium now)'),
                  ),
                ],
                const SizedBox(height: 32),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline, size: 18, color: Colors.blueGrey.shade400),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Utapokea ombi kwenye simu. Fuata maelekezo ili kukamilisha.',
                        style: TextStyle(fontSize: 13, color: Colors.blueGrey.shade400, height: 1.5),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Material(
                  color: const Color(0x1A22C55E),
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    onTap: _openWhatsApp,
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0x4022C55E)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(color: _accentCta, borderRadius: BorderRadius.circular(12)),
                            child: const Icon(Icons.chat, color: Colors.white, size: 22),
                          ),
                          const SizedBox(width: 12),
                          const Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Msaada zaidi?', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
                                SizedBox(height: 2),
                                Text('Tuandikie kwenye WhatsApp', style: TextStyle(fontSize: 13, color: _accentCta)),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right, color: _accentCta, size: 20),
                        ],
                      ),
                    ),
                  ),
                ),
                ],
              ),
            ),
          ),
          if (_statusOpen) ...[
            Positioned.fill(
              child: GestureDetector(
                onTap: () => setState(() => _statusOpen = false),
                child: Container(color: Colors.black54),
              ),
            ),
            Center(
              child: GestureDetector(
                onTap: () {},
                child: Material(
                  color: const Color(0xFF0F172A),
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 340),
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0x80475569)),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            color: _statusOk ? const Color(0x3322C55E) : const Color(0x33F59E0B),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _statusOk ? Icons.check_circle : Icons.warning_amber_rounded,
                            size: 44,
                            color: _statusOk ? _accentCta : const Color(0xFFF59E0B),
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(_statusTitle, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white)),
                        const SizedBox(height: 8),
                        Text(_statusMsg, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: Colors.blueGrey.shade300, height: 1.55)),
                        const SizedBox(height: 20),
                        FilledButton(
                          style: FilledButton.styleFrom(backgroundColor: _statusOk ? _accentCta : const Color(0xFF334155)),
                          onPressed: () => setState(() => _statusOpen = false),
                          child: const Text('Sawa'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Bundle {
  const _Bundle({
    required this.id,
    required this.name,
    required this.price,
    required this.duration,
    required this.value,
    required this.popular,
  });
  final String id;
  final String name;
  final String price;
  final String duration;
  final int value;
  final bool popular;
}
