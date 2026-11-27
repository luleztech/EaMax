'use strict';

/**
 * Regression guards for the playback fixes. If someone (or a merge) undoes one of them, this
 * fails loudly instead of the channel silently breaking in production.
 *
 *   node scripts/test-playback-guards.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------- behaviour (server) ----------
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/x';
const svc = require('../src/services/embedPlaybackService');

test('withoutPageHeaders strips Referer/Origin/X-Requested-With (any case) only', () => {
  const out = svc.__test.withoutPageHeaders({
    Referer: 'https://a/',
    origin: 'https://a',
    'X-Requested-With': 'com.washatv',
    'User-Agent': 'ExoPlayer',
    Accept: '*/*',
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ['Accept', 'User-Agent']);
});

test('bare-host memory: remembered after markBare, unknown host is not', () => {
  const t = svc.__test;
  t.bareHosts.clear();
  assert.strictEqual(t.prefersBare('https://cdn.example.net/live/a.mpd'), false);
  t.markBare('https://cdn.example.net/live/a.mpd');
  assert.strictEqual(t.prefersBare('https://cdn.example.net/other/b.mpd'), true);
  assert.strictEqual(t.prefersBare('https://another.example.net/x.mpd'), false);
  t.bareHosts.clear();
});

test('watchdog + health API are exported', () => {
  for (const fn of ['healChannel', 'refreshEmbedPlayback', 'getChannelHealth', 'touchChannel']) {
    assert.strictEqual(typeof svc[fn], 'function', `${fn} missing`);
  }
  assert.deepStrictEqual(svc.getChannelHealth().failing, []);
});

// ---------- invariants (source) ----------
const server = read('backend/src/services/embedPlaybackService.js');

test('upstream MPD fetch keeps the bare (no Referer/Origin) attempts', () => {
  assert.match(server, /withoutPageHeaders\(exoFull\)/);
  assert.match(server, /withoutPageHeaders\(browserFull\)/);
});

test('segment relay keeps the bare attempt plan', () => {
  assert.match(server, /\['ExoPlayer', true\]/);
});

test('MPD body cache + shared in-flight job present', () => {
  assert.match(server, /const mpdBodyJobs = new Map\(\)/);
  assert.match(server, /MPD_BODY_TTL_MS/);
});

test('failed re-resolve keeps the last good result', () => {
  assert.match(server, /LAST_GOOD_GRACE_MS/);
  assert.match(server, /serving last good result/);
});

test('Azam failover to nur ClearKey is wired in play + watchdog', () => {
  assert.ok((server.match(/fetchNurClearKeyForAzam\(/g) || []).length >= 3);
});

test('server starts the watchdog', () => {
  assert.match(read('backend/src/server.js'), /startChannelWatchdog\(\)/);
});

test('admin config can never set the package marker to this app id (server)', () => {
  const cfg = read('backend/src/services/playerConfigService.js');
  assert.match(cfg, /appPackageHeader: 'com\.washatv'/);
  assert.match(cfg, /out\.appPackageHeader = 'com\.washatv'/);
});

test('Kotlin: package marker is sanitised and used by every header builder', () => {
  const cfg = read('android/app/src/main/kotlin/com/eamax/player/PlayerRuntimeConfig.kt');
  assert.match(cfg, /PINNED_PACKAGE = "com\.washatv"/);
  assert.match(cfg, /fun packageMarker\(\)/);
  for (const f of ['PlaybackHttpHeaders', 'PlaybackBrowserHeaders', 'GatewayPlaybackResolver']) {
    const src = read(`android/app/src/main/kotlin/com/eamax/player/${f}.kt`);
    assert.match(src, /packageMarker\(\)/, `${f} must use packageMarker()`);
    assert.doesNotMatch(src, /appPackageHeader\.ifBlank/, `${f} must not read the raw admin value`);
  }
});

test('Kotlin: gateway API call rotates header variants', () => {
  const src = read('android/app/src/main/kotlin/com/eamax/player/GatewayPlaybackResolver.kt');
  assert.match(src, /apiHeaderVariants\(/);
  assert.match(src, /variants\[attempt % variants\.size\]/);
});

test('Kotlin: direct media uses signature detection, not only extensions', () => {
  const src = read('android/app/src/main/kotlin/com/eamax/player/PlaybackHttpHeaders.kt');
  assert.match(src, /StreamUrlClassifier\.hasMediaSignature/);
});

test('Dart header builder mirrors native rules', () => {
  const src = read('lib/player/playback_http_headers.dart');
  assert.match(src, /hasMediaSignature\(u\)/);
  assert.match(src, /contains\('eamax'\)/);
});

test('player controls stay touch-only', () => {
  const act = read('android/app/src/main/kotlin/com/eamax/OrizonPlayerActivity.kt');
  assert.match(act, /controllerAutoShow = false/);
  assert.match(act, /override fun dispatchTouchEvent/);
  assert.match(read('android/app/src/main/res/layout/activity_orizon_player.xml'), /android:visibility="gone"/);
});

test('fast-open hooks present', () => {
  assert.match(read('android/app/src/main/kotlin/com/eamax/MainActivity.kt'), /OrizonStreamClient\.preconnect/);
  assert.match(read('lib/player/core/playback_orchestrator.dart'), /_prewarmManifest\(url\)/);
});

console.log(process.exitCode ? 'playback guard tests FAILED' : `playback guard tests passed (${passed})`);
