import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

const _backupFileName = 'eamax_user_identity.txt';

/// Writes to two app-private locations so Play Store / OEM clears of one tree still recover identity.
Future<void> persistUserIdToFileBackup(String id) async {
  if (kIsWeb) return;
  for (final path in await _backupPaths()) {
    try {
      await File(path).writeAsString(id, flush: true);
    } catch (_) {}
  }
}

Future<List<String>> _backupPaths() async {
  try {
    final support = await getApplicationSupportDirectory();
    final docs = await getApplicationDocumentsDirectory();
    return ['${support.path}/$_backupFileName', '${docs.path}/$_backupFileName'];
  } catch (_) {
    return [];
  }
}

Future<String?> readUserIdFromFileBackup() async {
  if (kIsWeb) return null;
  for (final path in await _backupPaths()) {
    try {
      final f = File(path);
      if (!await f.exists()) continue;
      final s = (await f.readAsString()).trim();
      if (s.isNotEmpty) return s;
    } catch (_) {}
  }
  return null;
}
