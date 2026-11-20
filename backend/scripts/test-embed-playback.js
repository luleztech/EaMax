const assert = require('assert');
const {
  extractEmbeddedStream,
  isEmbedPlaybackUrl,
  isPublicHttpUrl,
  openRelay,
  rewritePlaylist,
  sealRelay,
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

console.log('embed playback resolver tests passed');
process.exit(0);
