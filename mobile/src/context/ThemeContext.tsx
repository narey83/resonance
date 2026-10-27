// <copyright file="ThemeContext.tsx" company="John Narey">
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

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { themes, ThemeName, PaletteName, ThemeColors } from '../theme';
import { applyAccent, resolvePalette } from '../lib/appearance';
import { useAppSettings } from '../store/appSettingsStore';

interface ThemeContextValue {
  name: ThemeName;
  palette: PaletteName;   // resolved palette (never 'system')
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  name:    'system',
  palette: 'dark',
  colors:  themes.dark,
  isDark:  true,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppSettings(state => state.theme);
  const accentColour = useAppSettings(state => state.accentColour);
  const systemScheme = useColorScheme(); // 'dark' | 'light' | null | undefined

  const palette = resolvePalette(theme, systemScheme);
  const colors = useMemo(() => applyAccent(themes[palette], palette, accentColour), [palette, accentColour]);
  const isDark  = palette !== 'light';

  const value = useMemo<ThemeContextValue>(
    () => ({ name: theme, palette, colors, isDark }),
    [theme, palette, colors, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
