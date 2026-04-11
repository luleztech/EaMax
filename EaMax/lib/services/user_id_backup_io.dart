import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

const _backupFileName = 'eamax_user_identity.txt';

Future<void> persistUserIdToFileBackup(String id) async {
  if (kIsWeb) return;
  try {
    final dir = await getApplicationSupportDirectory();
    await File('${dir.path}/$_backupFileName').writeAsString(id, flush: true);
  } catch (_) {}
}

Future<String?> readUserIdFromFileBackup() async {
  if (kIsWeb) return null;
  try {
    final dir = await getApplicationSupportDirectory();
    final f = File('${dir.path}/$_backupFileName');
    if (!await f.exists()) return null;
    final s = (await f.readAsString()).trim();
    return s.isEmpty ? null : s;
  } catch (_) {
    return null;
  }
}
