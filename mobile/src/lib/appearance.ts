import type { ColorSchemeName } from 'react-native';
import type { PaletteName, ThemeColors, ThemeName } from '../theme';

export const ACCENT_OPTIONS = [
  { name: 'default', label: 'Original', light: '#B83D29', dark: '#F08063' },
  { name: 'orange', label: 'Orange', light: '#A34D16', dark: '#EFA266' },
  { name: 'ochre', label: 'Ochre', light: '#80620F', dark: '#D9B65D' },
  { name: 'olive', label: 'Olive', light: '#52682D', dark: '#AFBF7E' },
  { name: 'blue', label: 'Blue', light: '#285D91', dark: '#83B6DF' },
  { name: 'violet', label: 'Violet', light: '#745090', dark: '#C4A2DD' },
] as const;
export type AccentName = typeof ACCENT_OPTIONS[number]['name'];

export function isAccentName(value: unknown): value is AccentName {
  return ACCENT_OPTIONS.some(option => option.name === value);
}
export function isThemeName(value: unknown): value is ThemeName {
  return ['system', 'light', 'dark', 'amoled', 'midnight'].includes(value as string);
}
export function resolvePalette(theme: ThemeName, handsetScheme: ColorSchemeName): PaletteName {
  return theme === 'system' ? (handsetScheme === 'light' ? 'light' : 'dark') : theme;
}
export function applyAccent(base: ThemeColors, palette: PaletteName, accent: AccentName): ThemeColors {
  if (accent === 'default') return base;
  const option = ACCENT_OPTIONS.find(item => item.name === accent);
  if (!option) return base;
  const colour = palette === 'light' ? option.light : option.dark;
  // Semantic success/warning/error colours stay independent of personal colour choices.
  return { ...base, accent: colour, accentHover: colour };
}
