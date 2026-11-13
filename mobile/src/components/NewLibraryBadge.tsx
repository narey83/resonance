import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { isRecentlyIndexed } from '../lib/recentLibraryItems';
import NewTrackIcon from './NewTrackIcon';

export default function NewLibraryBadge({ indexedAt, overlay = false }: { indexedAt?: number | null; overlay?: boolean }) {
  const { colors } = useTheme();
  if (!isRecentlyIndexed(indexedAt)) return null;
  return (
    <View pointerEvents="none" accessible accessibilityLabel="Added in the last 7 days"
      style={overlay ? [styles.overlay, { backgroundColor: colors.bgPrimary }] : styles.inline}>
      <NewTrackIcon size={overlay ? 12 : 14} color={colors.accent} />
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  inline: { marginLeft: 6 },
});
