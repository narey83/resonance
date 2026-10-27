// <copyright file="theme.ts" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import { Platform } from 'react-native';

// 'system' = follow device dark/light setting; the rest are explicit palettes.
export type ThemeName = 'system' | 'dark' | 'amoled' | 'midnight' | 'light';
export type PaletteName = Exclude<ThemeName, 'system'>;

// Ink, paper and a small amount of label red. Artwork supplies the other colours.
const dark = {
  bgPrimary:    '#171815',
  bgSurface:    '#1F211D',
  bgElevated:   '#2B2D27',
  border:       'rgba(239,235,223,0.13)',
  borderStrong: 'rgba(239,235,223,0.32)',
  textPrimary:  '#EFEBDD',
  textMuted:    '#ACAFA0',
  textDim:      'rgba(239,235,223,0.35)',
  accent:       '#F08063',
  accentHover:  '#F89A7E',
  success:      '#98B487',
  warning:      '#D3AC63',
  danger:       '#F08063',
  queued:       '#C7B283',
  tabBar:       '#171815',
  tabBarBorder: 'rgba(239,235,223,0.32)',
  header:       '#171815',
};

const amoled: typeof dark = {
  ...dark,
  bgPrimary:    '#000000',
  bgSurface:    '#0C0D0B',
  bgElevated:   '#1A1C17',
  tabBar:       '#000000',
  header:       '#000000',
};

const midnight: typeof dark = {
  ...dark,
  bgPrimary:    '#101A20',
  bgSurface:    '#17232A',
  bgElevated:   '#22323A',
  border:       'rgba(226,230,220,0.13)',
  borderStrong: 'rgba(226,230,220,0.32)',
  accent:       '#E5B76F',
  accentHover:  '#F0C88D',
  tabBar:       '#101A20',
  header:       '#101A20',
};

const light: typeof dark = {
  bgPrimary:    '#F0EDE4',
  bgSurface:    '#F7F4EC',
  bgElevated:   '#E4E0D4',
  border:       'rgba(38,40,32,0.16)',
  borderStrong: 'rgba(38,40,32,0.48)',
  textPrimary:  '#262820',
  textMuted:    '#67695C',
  textDim:      'rgba(38,40,32,0.35)',
  accent:       '#B83D29',
  accentHover:  '#96301F',
  success:      '#47693D',
  warning:      '#896116',
  danger:       '#B83D29',
  queued:       '#806237',
  tabBar:       '#F0EDE4',
  tabBarBorder: 'rgba(38,40,32,0.48)',
  header:       '#F0EDE4',
};

export type ThemeColors = typeof dark;

export const themes: Record<PaletteName, ThemeColors> = { dark, amoled, midnight, light };

// Static export kept for backward compatibility — always the dark palette.
export const Colors: ThemeColors = dark;

export const Typography = {
  fontFamily: Platform.select({ ios: 'Helvetica Neue', android: 'sans-serif', default: 'System' }),
  display: Platform.select({ ios: 'HelveticaNeue-CondensedBold', android: 'sans-serif-condensed', default: 'System' }),
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
  sm: 2,
  md: 3,
  lg: 4,
  full: 999,
};

// Factory for navigation screen options — pass current theme colors for dynamic theming.
export const makeScreenOptions = (c: ThemeColors) => ({
  headerStyle:         { backgroundColor: c.header },
  headerTintColor:     c.textPrimary,
  headerTitleStyle:    { fontFamily: Typography.display, fontSize: Typography.xl, fontWeight: '700' as const },
  headerShadowVisible: false,
  contentStyle:        { backgroundColor: c.bgPrimary },
});

// Static fallback used by screens not yet migrated to dynamic theming.
export const screenOptions = makeScreenOptions(dark);
