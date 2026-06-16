import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Typography } from '../theme';

interface Props {
  title:     string;
  subtitle?: string;
}

export default function PlaceholderScreen({ title, subtitle }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bgPrimary, justifyContent: 'center', alignItems: 'center', gap: 8 },
    title:     { fontSize: Typography.lg, fontWeight: '600', color: colors.textPrimary },
    subtitle:  { fontSize: Typography.sm, color: colors.textMuted },
  }), [colors]);

  return (
    <View style={s.container}>
      <Text style={s.title}>{title}</Text>
      {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
    </View>
  );
}
