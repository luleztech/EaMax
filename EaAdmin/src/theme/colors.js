/**
 * EaAdmin design tokens.
 * One accent colour (teal) + neutral surfaces. Semantic colours (success/warning/danger)
 * are only used for status, never for decoration.
 */
const ACCENT = '#2dd4bf';

const colors = {
  // Surfaces (flat, no gradients)
  background: '#0b0d12',
  backgroundElevated: '#10131a',
  panel: '#12151c',
  panelSoft: '#12151c',
  panelMuted: '#181c25',
  border: '#232835',
  borderSoft: '#1b202b',
  borderStrong: '#313846',

  // Text
  textPrimary: '#f3f5f9',
  textSecondary: '#a0a9ba',
  textMuted: '#6b7587',

  // Single accent
  accent: ACCENT,
  accentDim: 'rgba(45, 212, 191, 0.14)',
  onAccent: '#04201c',
  // Legacy aliases: every old "primary/accent" reference now resolves to the one accent.
  primary: ACCENT,
  primarySoft: ACCENT,
  primaryDim: 'rgba(45, 212, 191, 0.14)',

  // Status only
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
  info: '#60a5fa',
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const space = {
  page: 16,
  card: 14,
};

export default colors;
