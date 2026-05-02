import 'package:shared_preferences/shared_preferences.dart';

/// Persists "Usioneshe tena" for the rotate hint (iOS / Web / in-app player).
/// Android native player uses [RotateHintPreferences] in Kotlin with matching behavior.
class PlayerRotateHintPrefs {
  PlayerRotateHintPrefs._();

  static const neverShowKey = 'player_rotate_hint_never';

  static Future<bool> getNeverShow() async {
    final p = await SharedPreferences.getInstance();
    return p.getBool(neverShowKey) ?? false;
  }

  static Future<void> setNeverShow(bool value) async {
    final p = await SharedPreferences.getInstance();
    await p.setBool(neverShowKey, value);
  }
}
