import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { themes, ThemeName, PaletteName, ThemeColors } from '../theme';
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
  const { theme } = useAppSettings();
  const systemScheme = useColorScheme(); // 'dark' | 'light' | null | undefined

  const palette: PaletteName = theme === 'system'
    ? (systemScheme === 'light' ? 'light' : 'dark')
    : theme;

  const colors = themes[palette];
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
