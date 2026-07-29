const VALID_AUDIO_LANGUAGES = new Set(['sw', 'en']);
const DEFAULT_AUDIO_LANGUAGE = 'sw';

function sanitizeChannelAudioLanguage(raw, fallback = DEFAULT_AUDIO_LANGUAGE) {
  const base = VALID_AUDIO_LANGUAGES.has(fallback) ? fallback : DEFAULT_AUDIO_LANGUAGE;
  if (raw == null || raw === '') return base;
  const lang = String(raw).trim().toLowerCase();
  if (!lang || lang === 'auto' || lang === 'default') return base;
  if (lang === 'en' || lang === 'eng' || lang.startsWith('en-')) return 'en';
  if (VALID_AUDIO_LANGUAGES.has(lang)) return lang;
  return base;
}

function sanitizeDefaultLanguage(raw) {
  const lang = String(raw || DEFAULT_AUDIO_LANGUAGE).trim().toLowerCase();
  if (lang === 'en' || lang === 'eng' || lang.startsWith('en-')) return 'en';
  return DEFAULT_AUDIO_LANGUAGE;
}

module.exports = {
  VALID_AUDIO_LANGUAGES,
  DEFAULT_AUDIO_LANGUAGE,
  sanitizeChannelAudioLanguage,
  sanitizeDefaultLanguage,
};
