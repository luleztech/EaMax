const VALID_AUDIO_LANGUAGES = new Set([
  'auto', 'en', 'sw', 'ar', 'fr', 'es', 'pt', 'hi', 'de', 'it', 'tr', 'ru', 'zh',
]);

function sanitizeChannelAudioLanguage(raw) {
  if (raw == null || raw === '') return 'auto';
  const lang = String(raw).trim().toLowerCase();
  if (!lang || lang === 'auto' || lang === 'default') return 'auto';
  if (VALID_AUDIO_LANGUAGES.has(lang)) return lang;
  if (/^[a-z]{2,3}$/.test(lang)) return lang;
  return 'auto';
}

module.exports = {
  VALID_AUDIO_LANGUAGES,
  sanitizeChannelAudioLanguage,
};
