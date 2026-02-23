/**
 * Safe orientation helper. Only calls react-native-orientation-locker
 * when the native module is linked (NativeModules.Orientation exists).
 * Avoids "cannot read property lockToPortrait of null" when the module is missing.
 * App stays portrait; only the video player is allowed to rotate (when visible).
 */

const { NativeModules, AppState } = require('react-native');

const hasNativeModule = () => {
  try {
    return NativeModules?.Orientation != null;
  } catch (_) {
    return false;
  }
};

let Orientation = null;
if (hasNativeModule()) {
  try {
    Orientation = require('react-native-orientation-locker').default;
  } catch (_) {}
}

// When true, player is open — allow rotation. When false, app (home etc.) must stay portrait.
let _isPlayerVisible = false;

export function setPlayerVisible(visible) {
  _isPlayerVisible = !!visible;
}

export function isPlayerVisible() {
  return _isPlayerVisible;
}

export function lockToPortrait() {
  if (Orientation && hasNativeModule()) {
    try {
      Orientation.lockToPortrait();
    } catch (_) {}
  }
}

export function unlockAllOrientations() {
  if (Orientation && hasNativeModule()) {
    try {
      Orientation.unlockAllOrientations();
    } catch (_) {}
  }
}

export function isAvailable() {
  return !!(Orientation && hasNativeModule());
}

/**
 * Call from App.js once. When app comes to foreground, lock to portrait
 * only if the player is not visible (so home screen never rotates).
 */
export function lockToPortraitWhenAppActive() {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active' && !_isPlayerVisible) {
      lockToPortrait();
    }
  });
  return () => sub?.remove?.();
}
