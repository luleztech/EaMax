import 'package:flutter/material.dart';

void main() {
  runApp(const EaAdminGuardApp());
}

/// Shown when someone runs `flutter run` inside EaAdmin by mistake.
class EaAdminGuardApp extends StatelessWidget {
  const EaAdminGuardApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7C3AED)),
        useMaterial3: true,
      ),
      home: Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.admin_panel_settings_outlined,
                    size: 72,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'EaAdmin is React Native',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'This folder is not the EaMax user app. '
                    'Admin runs on Android (phone or emulator).',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 28),
                  _Step(number: '1', text: 'cd EaAdmin && npm install'),
                  const SizedBox(height: 8),
                  _Step(number: '2', text: 'npm start  (Metro, keep open)'),
                  const SizedBox(height: 8),
                  _Step(number: '3', text: 'npm run android'),
                  const SizedBox(height: 28),
                  Text(
                    'EaMax user app (Flutter + Chrome):',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  const SelectableText(
                    'cd .. && ./scripts/run-chrome.sh',
                    textAlign: TextAlign.center,
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

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.text});

  final String number;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 14,
          child: Text(number, style: const TextStyle(fontSize: 12)),
        ),
        const SizedBox(width: 12),
        Expanded(child: SelectableText(text)),
      ],
    );
  }
}
