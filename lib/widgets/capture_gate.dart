import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const MethodChannel _securityChannel = MethodChannel('com.eamax/security_guard');

/// A traffic-capture / interception threat reported by the Android bridge.
class CaptureThreat {
  const CaptureThreat({required this.id, required this.label});

  final String id;
  final String label;
}

Future<List<CaptureThreat>> findCaptureThreats() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return const [];
  try {
    final result = await _securityChannel.invokeMethod<List<dynamic>>('findCaptureApps');
    return (result ?? const <dynamic>[])
        .whereType<Map>()
        .map(
          (m) => CaptureThreat(
            id: m['packageName']?.toString() ?? '',
            label: m['label']?.toString() ?? 'Unknown app',
          ),
        )
        .where((t) => t.id.isNotEmpty)
        .toList(growable: false);
  } on MissingPluginException {
    return const [];
  } on PlatformException {
    return const [];
  }
}

/// Blocks the whole app (replaces the child tree) while a sniffer is detected.
///
/// Re-checks on startup, on every app resume and periodically so a capture app
/// enabled while EaMax is open cannot keep observing traffic.
class CaptureGate extends StatefulWidget {
  const CaptureGate({super.key, required this.child});

  final Widget child;

  @override
  State<CaptureGate> createState() => _CaptureGateState();
}

class _CaptureGateState extends State<CaptureGate> with WidgetsBindingObserver {
  static const _recheckEvery = Duration(seconds: 20);

  List<CaptureThreat> _threats = const [];
  bool _checked = false;
  bool _checking = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _check();
    _timer = Timer.periodic(_recheckEvery, (_) => _check());
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    if (_checking) return;
    _checking = true;
    try {
      final threats = await findCaptureThreats();
      if (!mounted) return;
      final changed = !_checked ||
          threats.length != _threats.length ||
          threats.any((t) => !_threats.any((o) => o.id == t.id));
      if (changed) {
        setState(() {
          _threats = threats;
          _checked = true;
        });
      }
    } finally {
      _checking = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_checked) return const ColoredBox(color: Colors.black);
    if (_threats.isNotEmpty) {
      return CaptureGuardScreen(
        threats: _threats,
        checking: _checking,
        onRecheck: _check,
      );
    }
    return widget.child;
  }
}

class CaptureGuardScreen extends StatelessWidget {
  const CaptureGuardScreen({
    super.key,
    required this.threats,
    required this.checking,
    required this.onRecheck,
  });

  final List<CaptureThreat> threats;
  final bool checking;
  final Future<void> Function() onRecheck;

  Future<void> _openSettings() async {
    if (threats.isEmpty) return;
    try {
      await _securityChannel.invokeMethod<void>(
        'openCaptureAppSettings',
        {'packageName': threats.first.id},
      );
    } on PlatformException {
      // Keep the blocker visible if Android cannot open the settings page.
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.security, size: 56),
                  const SizedBox(height: 20),
                  Text(
                    'Zana ya kunasa mtandao imegunduliwa',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Zima au ondoa vitu hivi ili kulinda viungo (URLs) na taarifa za EaMax, kisha urudi hapa:',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  ...threats.map(
                    (t) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Text('• ${t.label}'),
                    ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: _openSettings,
                    icon: const Icon(Icons.settings),
                    label: const Text('Fungua mipangilio'),
                  ),
                  TextButton(
                    onPressed: checking ? null : onRecheck,
                    child: Text(checking ? 'Inakagua…' : 'Nimeizima/kuiondoa, kagua tena'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
