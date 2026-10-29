import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { isRecentlyIndexed } from '../lib/recentLibraryItems';

export default function NewLibraryBadge({ indexedAt, overlay = false }: { indexedAt?: number | null; overlay?: boolean }) {
  const { colors } = useTheme();
  if (!isRecentlyIndexed(indexedAt)) return null;
  return (
    <View pointerEvents="none" accessible accessibilityLabel="Added in the last 7 days"
      style={overlay ? [styles.overlay, { backgroundColor: colors.bgPrimary }] : styles.inline}>
      <Ionicons name="sparkles" size={overlay ? 12 : 14} color={colors.accent} />
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 1, left: 1, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  inline: { marginLeft: 6 },
});
