import React, { useRef } from 'react';
import { StyleSheet, Text, UIManager, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme } from '../context/ThemeContext';
import { Typography } from '../theme';

export const studioSlidersAvailable = UIManager.hasViewManagerConfig('RNCSlider');

interface Props {
  label: string;
  value: number;
  onChange(value: number, save?: boolean): void;
  disabled: boolean;
  db?: boolean;
}

export default function StudioSlider({ label, value, onChange, disabled, db = false }: Props) {
  const { colors: c } = useTheme();
  const dragging = useRef(false);
  const min = db ? -6 : 0, max = db ? 6 : 1, step = db ? .5 : .01;
  const readout = db ? `${value > 0 ? '+' : ''}${value.toFixed(1)} dB` : `${Math.round(value * 100)}%`;
  const update = (next: number, save = true) => {
    if (disabled || !Number.isFinite(next)) return;
    // Native slider events use floats; save exact percentage / half-decibel steps.
    onChange(Number(Math.max(min, Math.min(max, Math.round(next / step) * step)).toFixed(2)), save);
  };
  return <View style={{ opacity: disabled || !studioSlidersAvailable ? .5 : 1 }}>
    <View style={s.header}><Text style={[s.label, { color: c.textPrimary }]}>{label}</Text><Text accessible={false} style={[s.readout, { color: c.textPrimary }]}>{readout}</Text></View>
    {studioSlidersAvailable && <Slider accessibilityLabel={label} accessibilityRole="adjustable" accessibilityState={{ disabled }} accessibilityValue={{ min, max, now: value, text: db ? readout : `${Math.round(value * 100)} percent` }}
      value={value} minimumValue={min} maximumValue={max} step={step} disabled={disabled} tapToSeek
      minimumTrackTintColor={c.accent} maximumTrackTintColor={c.borderStrong} thumbTintColor={c.accent} style={s.slider}
      onSlidingStart={() => { dragging.current = true; }}
      onValueChange={next => update(next, !dragging.current)}
      onSlidingComplete={next => { dragging.current = false; update(next); }} />}
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={s.range}><Text style={[s.limit, { color: c.textMuted }]}>{db ? '−6 dB' : '0%'}</Text>{db && <Text style={[s.limit, { color: c.textMuted }]}>0 dB</Text>}<Text style={[s.limit, { color: c.textMuted }]}>{db ? '+6 dB' : '100%'}</Text></View>
  </View>;
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontSize: 14, fontWeight: '600' },
  readout: { fontVariant: ['tabular-nums'], fontFamily: Typography.mono, fontSize: 15 },
  slider: { width: '100%', height: 48 },
  range: { flexDirection: 'row', justifyContent: 'space-between' },
  limit: { fontSize: 11, lineHeight: 17 },
});
