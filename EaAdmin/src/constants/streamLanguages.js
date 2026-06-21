/** Admin-controlled stream audio language — applied on the user player automatically. */
export const STREAM_LANGUAGES = [
  { id: 'auto', label: 'Auto (stream default)', icon: 'cog-outline' },
  { id: 'sw', label: 'Swahili', icon: 'translate' },
  { id: 'en', label: 'English', icon: 'translate' },
  { id: 'ar', label: 'Arabic', icon: 'translate' },
  { id: 'fr', label: 'French', icon: 'translate' },
  { id: 'es', label: 'Spanish', icon: 'translate' },
  { id: 'pt', label: 'Portuguese', icon: 'translate' },
  { id: 'hi', label: 'Hindi', icon: 'translate' },
  { id: 'de', label: 'German', icon: 'translate' },
  { id: 'it', label: 'Italian', icon: 'translate' },
  { id: 'tr', label: 'Turkish', icon: 'translate' },
  { id: 'ru', label: 'Russian', icon: 'translate' },
  { id: 'zh', label: 'Chinese', icon: 'translate' },
];

export const streamLanguageLabel = (id) => {
  const lang = STREAM_LANGUAGES.find((l) => l.id === id);
  return lang ? lang.label : id || 'Auto';
};
