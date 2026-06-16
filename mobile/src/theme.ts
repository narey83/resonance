import { Platform } from 'react-native';

// 'system' = follow device dark/light setting; the rest are explicit palettes.
export type ThemeName = 'system' | 'dark' | 'amoled' | 'midnight' | 'light';
export type PaletteName = Exclude<ThemeName, 'system'>;

const dark = {
  bgPrimary:    '#0d1117',
  bgSurface:    '#161b22',
  bgElevated:   '#21262d',
  border:       'rgba(240,246,252,0.1)',
  borderStrong: 'rgba(240,246,252,0.2)',
  textPrimary:  '#e6edf3',
  textMuted:    '#7d8590',
  textDim:      'rgba(255,255,255,0.28)',
  accent:       '#388bfd',
  accentHover:  '#58a6ff',
  success:      '#3fb950',
  warning:      '#d29922',
  danger:       '#f85149',
  queued:       '#a371f7',
  tabBar:       '#0d1117',
  tabBarBorder: 'rgba(240,246,252,0.1)',
  header:       '#161b22',
};

const amoled: typeof dark = {
  ...dark,
  bgPrimary:    '#000000',
  bgSurface:    '#0d0d0d',
  bgElevated:   '#1a1a1a',
  tabBar:       '#000000',
  header:       '#0d0d0d',
};

const midnight: typeof dark = {
  ...dark,
  bgPrimary:    '#0a0f1e',
  bgSurface:    '#0f1729',
  bgElevated:   '#182035',
  border:       'rgba(100,140,255,0.15)',
  borderStrong: 'rgba(100,140,255,0.25)',
  accent:       '#6b8cff',
  accentHover:  '#8da8ff',
  tabBar:       '#0a0f1e',
  header:       '#0f1729',
};

// Light palette uses violet as accent so it reads clearly different from
// the blue accent used in all dark palettes.
const light: typeof dark = {
  bgPrimary:    '#f6f8fa',
  bgSurface:    '#ffffff',
  bgElevated:   '#eaeef2',
  border:       'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.16)',
  textPrimary:  '#1f2328',
  textMuted:    '#57606a',
  textDim:      'rgba(0,0,0,0.28)',
  accent:       '#6d28d9',
  accentHover:  '#5b21b6',
  success:      '#1a7f37',
  warning:      '#9a6700',
  danger:       '#cf222e',
  queued:       '#0969da',
  tabBar:       '#ffffff',
  tabBarBorder: 'rgba(0,0,0,0.08)',
  header:       '#ffffff',
};

export type ThemeColors = typeof dark;

export const themes: Record<PaletteName, ThemeColors> = { dark, amoled, midnight, light };

// Static export kept for backward compatibility — always the dark palette.
export const Colors: ThemeColors = dark;

export const Typography = {
  fontFamily: Platform.select({ ios: 'System', android: 'Roboto', default: 'System' }),
  xs:    11,
  sm:    12,
  base:  14,
  md:    15,
  lg:    17,
  xl:    20,
  xxl:   24,
  mono:  Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
};

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 28,
};

export const Radius = {
  sm: 6,
  md: 8,
  lg: 12,
  full: 999,
};

// Factory for navigation screen options — pass current theme colors for dynamic theming.
export const makeScreenOptions = (c: ThemeColors) => ({
  headerStyle:         { backgroundColor: c.header },
  headerTintColor:     c.textPrimary,
  headerTitleStyle:    { fontSize: Typography.md, fontWeight: '600' as const },
  headerShadowVisible: false,
  contentStyle:        { backgroundColor: c.bgPrimary },
});

// Static fallback used by screens not yet migrated to dynamic theming.
export const screenOptions = makeScreenOptions(dark);
