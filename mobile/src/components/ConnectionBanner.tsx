import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useConnectionStore, ConnectionStatus } from '../services/connectionMonitor';
import { Typography, Spacing, Radius } from '../theme';

const TAB_BAR_HEIGHT  = 49;
const MINI_BAR_HEIGHT = 82; // paddingVertical 16*2 + artwork 48 + progress 2

type Config = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  label: string;
};

function useConfig(status: ConnectionStatus, latencyMs: number | null, lastError: string | null): Config {
  const { colors } = useTheme();
  switch (status) {
    case 'offline':
      return { icon: 'wifi-outline',         color: colors.danger,  label: 'No network connection' };
    case 'down':
      return { icon: 'cloud-offline-outline', color: colors.danger,  label: lastError ? `Unreachable: ${lastError} · Retrying…` : 'Server unreachable · Retrying…' };
    case 'slow':
      return { icon: 'time-outline',          color: colors.warning, label: latencyMs != null ? `Slow connection · ${latencyMs}ms` : 'Slow connection' };
    default:
      return { icon: 'checkmark-circle-outline', color: colors.success, label: 'Connected' };
  }
}

export default function ConnectionBanner() {
  const { status, latencyMs, lastError } = useConnectionStore();
  const insets = useSafeAreaInsets();
  const config  = useConfig(status, latencyMs, lastError);

  const visible  = status !== 'connected';
  const slideY      = useRef(new Animated.Value(40)).current;
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const prevVisible = useRef(false);

  useEffect(() => {
    if (visible === prevVisible.current) return;
    prevVisible.current = visible;

    if (visible) {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 0,  duration: 340, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1,  duration: 220, easing: Easing.out(Easing.ease),         useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 40, duration: 280, easing: Easing.bezier(0.4, 0, 1, 1), useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0,  duration: 180, easing: Easing.in(Easing.ease),      useNativeDriver: true }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const bottomOffset = insets.bottom + TAB_BAR_HEIGHT + MINI_BAR_HEIGHT + Spacing.md;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrapper, { bottom: bottomOffset, opacity: fadeAnim, transform: [{ translateY: slideY }] }]}
    >
      <View style={[styles.pill, { backgroundColor: config.color }]}>
        <Ionicons color="#fff" name={config.icon} size={14} style={styles.icon} />
        <Text style={styles.label}>{config.label}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 9999,
  },
  pill: {
    alignItems: 'center',
    borderRadius: Radius.full,
    elevation: 8,
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  icon:  { marginRight: Spacing.xs },
  label: { color: '#fff', fontSize: Typography.sm, fontWeight: '600' },
});
