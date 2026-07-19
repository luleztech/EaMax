import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

/// Clean Swahili payment guides — single player, no mid-stream seeks (avoids scratches).
class PaymentVoices {
  PaymentVoices._();

  static const assets = <String>[
    'voices/1st.wav',
    'voices/2nd.wav',
    'voices/3rd.wav',
    'voices/4th.wav',
  ];

  static const successAsset = 'voices/4th.wav';

  static final AudioPlayer _player = AudioPlayer();
  static StreamSubscription<void>? _completeSub;
  static bool _ready = false;
  static Future<void>? _prepareFuture;
  static int _playGen = 0;
  static String? _playing;

  static void Function()? _externalOnStart;
  static void Function()? _externalOnDone;

  static void bindUiHooks({void Function()? onStart, void Function()? onDone}) {
    _externalOnStart = onStart;
    _externalOnDone = onDone;
  }

  static void clearUiHooks() {
    _externalOnStart = null;
    _externalOnDone = null;
  }

  static Future<void> prepare() => _prepareFuture ??= _doPrepare();

  static Future<void> _doPrepare() async {
    if (_ready) return;
    try {
      await _player.setReleaseMode(ReleaseMode.stop);
      await _player.setVolume(1.0);
      // Only warm the first clip at startup — keeps network free for config APIs.
      try {
        await AudioCache.instance.load(assets.first);
      } catch (_) {}
      _ready = true;
      // Warm the rest in the background after a short delay.
      Future<void>.delayed(const Duration(seconds: 2), () async {
        for (final asset in assets.skip(1)) {
          try {
            await AudioCache.instance.load(asset);
          } catch (_) {}
        }
      });
    } catch (e) {
      debugPrint('PaymentVoices.prepare: $e');
      _ready = true;
    }
  }

  static Future<void> playStep(
    int step, {
    void Function()? onStart,
    void Function()? onDone,
  }) async {
    final i = step.clamp(0, assets.length - 1);
    await playAsset(assets[i], onStart: onStart, onDone: onDone);
  }

  static Future<void> playAsset(
    String asset, {
    void Function()? onStart,
    void Function()? onDone,
  }) async {
    final gen = ++_playGen;
    unawaited(prepare());

    try {
      await _completeSub?.cancel();
      _completeSub = null;

      // Hard-stop previous clip, then start clean from the beginning.
      try {
        await _player.stop();
      } catch (_) {}

      if (gen != _playGen) return;

      onStart?.call();
      _externalOnStart?.call();
      _playing = asset;

      _completeSub = _player.onPlayerComplete.listen((_) {
        if (gen != _playGen) return;
        if (_playing == asset) {
          onDone?.call();
          _externalOnDone?.call();
        }
      });

      // Play full cleaned asset from start — no seek (seek caused scratches).
      await _player.play(AssetSource(asset), volume: 1.0);
    } catch (e) {
      debugPrint('PaymentVoices.playAsset($asset): $e');
      onDone?.call();
      _externalOnDone?.call();
    }
  }

  static Future<void> stop() async {
    _playGen++;
    _playing = null;
    try {
      await _completeSub?.cancel();
      _completeSub = null;
      await _player.stop();
    } catch (_) {}
  }
}
