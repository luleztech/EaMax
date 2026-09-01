const IMAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

export function sanitizeMediaUrl(raw) {
  let u = String(raw ?? '')
    .trim()
    .replace(/[\r\n\t]/g, '')
    .replace(/^['"]+|['"]+$/g, '');
  if (!u || u === 'null' || u === 'undefined') return '';
  if (u.startsWith('//')) u = `https:${u}`;
  return u;
}

export function mediaImageSource(raw) {
  const uri = sanitizeMediaUrl(raw);
  if (!uri) return null;
  return { uri, headers: IMAGE_HEADERS };
}

export function channelArtworkUrl(ch) {
  if (!ch || typeof ch !== 'object') return '';
  return sanitizeMediaUrl(
    ch.thumbnail_url ||
      ch.thumbnailUrl ||
      ch.logo_url ||
      ch.logoUrl ||
      ch.image_url ||
      ch.imageUrl ||
      '',
  );
}

export function slideArtworkUrl(slide) {
  if (!slide || typeof slide !== 'object') return '';
  return sanitizeMediaUrl(slide.image_url || slide.imageUrl || '');
}
