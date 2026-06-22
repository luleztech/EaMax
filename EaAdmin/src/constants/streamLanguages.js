/** Admin-controlled stream audio language. */
export const STREAM_LANGUAGES = [
  { id: 'sw', label: 'Swahili', icon: 'translate' },
  { id: 'en', label: 'English', icon: 'translate' },
  { id: 'ar', label: 'Arabic', icon: 'translate' },
  { id: 'fr', label: 'French', icon: 'translate' },
  { id: 'multi', label: 'Multi-audio', icon: 'surround-sound' },
];

export const DEFAULT_STREAM_LANGUAGE = 'sw';

export const streamLanguageLabel = (id) => {
  const lang = String(id || DEFAULT_STREAM_LANGUAGE).toLowerCase();
  if (lang === 'auto' || lang === 'default' || !lang) return 'Swahili';
  const found = STREAM_LANGUAGES.find((l) => l.id === lang);
  return found ? found.label : 'Swahili';
};

export const normalizeStreamLanguage = (id) => {
  const lang = String(id || DEFAULT_STREAM_LANGUAGE).trim().toLowerCase();
  if (!lang || lang === 'auto' || lang === 'default') return DEFAULT_STREAM_LANGUAGE;
  if (STREAM_LANGUAGES.some((l) => l.id === lang)) return lang;
  if (lang === 'en' || lang.startsWith('en-')) return 'en';
  if (lang === 'ar' || lang.startsWith('ar-')) return 'ar';
  if (lang === 'fr' || lang.startsWith('fr-')) return 'fr';
  return DEFAULT_STREAM_LANGUAGE;
};
