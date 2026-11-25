const assert = require('assert');
const {
  applyResolvedDrm,
  extractEmbeddedStream,
  isDirectMediaUrl,
  isEmbedPlaybackUrl,
  isOnDeviceEmbedApiUrl,
  isPublicHttpUrl,
  needsHostedWebPlayer,
  openRelay,
  rewriteMpdXml,
  rewritePlaylist,
  sealRelay,
  watchPageUrl,
} = require('../src/services/embedPlaybackService');

function xorEncrypt(plain, key) {
  const raw = Buffer.from(plain, 'utf8');
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] ^ key.charCodeAt(i % key.length);
  return out.toString('base64');
}

const page = 'https://panel.example.com/embed/live.php';
const media = 'https://cdn.example.com/live/index.m3u8?token=1';
const html = `<script>var keyPart = "secret"; var encryptedHls = "${xorEncrypt(media, 'secret')}";</script>`;
const extracted = extractEmbeddedStream(html, page);
assert.strictEqual(extracted.streamUrl, media);
assert.strictEqual(extracted.kind, 'hls');
assert.strictEqual(extracted.referer, page);

const manifestHtml = '<video src="https://cdn.example.com/dash/stream.mpd?hd=1"></video>';
const dash = extractEmbeddedStream(manifestHtml, page);
assert.strictEqual(dash.kind, 'dash');
assert.ok(dash.streamUrl.includes('.mpd'));

const relative = extractEmbeddedStream('<script>file: "/hls/playlist.m3u8"</script>', page);
assert.strictEqual(relative.streamUrl, 'https://panel.example.com/hls/playlist.m3u8');

assert.strictEqual(isEmbedPlaybackUrl(media), false);
assert.strictEqual(isEmbedPlaybackUrl('https://panel.example.com/embed/channel'), true);
assert.strictEqual(isEmbedPlaybackUrl('https://panel.example.com/live.php'), true);
assert.strictEqual(
  isEmbedPlaybackUrl('https://sokamax.live/embed.php?app=187&key=abc'),
  true,
);
assert.strictEqual(isPublicHttpUrl('http://127.0.0.1/embed/x'), false);
assert.strictEqual(isPublicHttpUrl('http://169.254.169.254/latest'), false);
assert.strictEqual(extractEmbeddedStream('<a href="http://127.0.0.1/secret.m3u8">x</a>', page), null);

const playlist = [
  '#EXTM3U',
  '#EXT-X-KEY:METHOD=AES-128,URI="keys/a.key"',
  '#EXTINF:6,',
  'seg-1.ts',
].join('\n');
const rewritten = rewritePlaylist(playlist, 'https://cdn.example.com/live/index.m3u8', 'https://api.example.com', {
  referer: page,
  origin: 'https://panel.example.com',
  authorization: '',
});
assert.ok(rewritten.includes('https://api.example.com/api/playback/relay?e='));
assert.ok(!rewritten.includes('seg-1.ts'));
const token = rewritten.match(/e=([^&\s]+)/)[1];
const opened = openRelay(decodeURIComponent(token));
assert.ok(opened.u.endsWith('/live/seg-1.ts') || opened.u.endsWith('/live/keys/a.key'));

const sealed = sealRelay({
  u: media,
  exp: Date.now() + 60000,
  r: page,
  o: 'https://panel.example.com',
  a: '',
});
assert.strictEqual(openRelay(sealed).u, media);
assert.strictEqual(openRelay(sealRelay({ u: media, exp: Date.now() - 1000, r: '', o: '', a: '' })), null);

assert.strictEqual(
  isOnDeviceEmbedApiUrl('https://sokamax.live/embed.php?app=187&key=abcdef'),
  true,
);
assert.strictEqual(
  isOnDeviceEmbedApiUrl('https://nur.mpilalivetv.com/v2/player.php?channel=3'),
  false,
);

const resolvedDash = {
  streamUrl: 'https://cdn.example.com/live/stream.mpd',
  kind: 'dash',
  referer: 'https://sokamax.live/',
  origin: 'https://sokamax.live',
  licenseUrl: 'https://license.example.com/wv',
  nvAuthorizations: 'token',
  drmType: 'WIDEVINE',
};
// DASH/HLS prefer Exo play.mpd — hosted Shaka caused WebView error 6001.
assert.strictEqual(needsHostedWebPlayer(resolvedDash), false);
assert.strictEqual(
  needsHostedWebPlayer({
    ...resolvedDash,
    kind: 'progressive',
    streamUrl: 'https://cdn.example.com/clip.mp4',
  }),
  true,
);
const watch = watchPageUrl('https://api.example.com', resolvedDash);
assert.ok(watch.includes('/api/playback/embed/player.php?e='));
assert.ok(watch.includes('.php'), 'hosted player URL must look like a gateway so WebViewEngine loads it');
const watchToken = watch.match(/e=([^&]+)/)[1];
const watchPayload = openRelay(decodeURIComponent(watchToken));
assert.strictEqual(watchPayload.kind, 'watch');
assert.strictEqual(watchPayload.u, resolvedDash.streamUrl);
assert.strictEqual(watchPayload.license, resolvedDash.licenseUrl);

const presented = applyResolvedDrm({}, resolvedDash, 'https://api.example.com');
assert.ok(
  String(presented.licenseUrl || '').includes('/api/playback/relay/license'),
  'Widevine licenseUrl must be the server relay (avoids Nagra 400 from client headers)',
);
assert.strictEqual(presented.licenseUrl, presented.licenseRelayUrl);

assert.strictEqual(
  isDirectMediaUrl('https://nur.mpilalivetv.com/v2/manifest.php?ch=AzamSport3'),
  true,
);
assert.strictEqual(
  isOnDeviceEmbedApiUrl('https://nur.mpilalivetv.com/v2/player.php?channel=3'),
  false,
);

const mpd = `<?xml version="1.0"?><MPD><Period id="1"><SegmentTemplate initialization="clip-\$RepresentationID\$-init.mp4" media="clip-\$RepresentationID\$-\$Time\$.mp4"/></Period></MPD>`;
const rewrittenMpd = rewriteMpdXml(
  mpd,
  'https://cdn.example.com/live/stream.mpd',
  'https://api.example.com',
  { referer: 'https://sokamax.live/', origin: 'https://sokamax.live' },
);
assert.ok(rewrittenMpd.includes('<BaseURL>https://api.example.com/api/playback/dash/'), 'MPD must inject dash BaseURL');
assert.ok(rewrittenMpd.includes('initialization="clip-$RepresentationID$-init.mp4"'), 'template paths stay relative');
const dashToken = rewrittenMpd.match(/\/api\/playback\/dash\/([^/"<]+)\//)[1];
const dashPayload = openRelay(decodeURIComponent(dashToken));
assert.strictEqual(dashPayload.kind, 'dashbase');
assert.ok(String(dashPayload.u).endsWith('/live/'));

console.log('embed playback resolver tests passed');
process.exit(0);
