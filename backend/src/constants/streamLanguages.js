const VALID_AUDIO_LANGUAGES = new Set(['sw', 'en']);
const DEFAULT_AUDIO_LANGUAGE = 'sw';

function sanitizeChannelAudioLanguage(raw) {
  if (raw == null || raw === '') return DEFAULT_AUDIO_LANGUAGE;
  const lang = String(raw).trim().toLowerCase();
  if (!lang || lang === 'auto' || lang === 'default') return DEFAULT_AUDIO_LANGUAGE;
  if (lang === 'en' || lang === 'eng' || lang.startsWith('en-')) return 'en';
  if (VALID_AUDIO_LANGUAGES.has(lang)) return lang;
  return DEFAULT_AUDIO_LANGUAGE;
}

module.exports = {
  VALID_AUDIO_LANGUAGES,
  DEFAULT_AUDIO_LANGUAGE,
  sanitizeChannelAudioLanguage,
};
