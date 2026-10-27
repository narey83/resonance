import React, { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { usePlaybackStatus } from '../../context/PlayerContext';
import { useCast } from '../../context/CastContext';
import { STUDIO_MODULES, STUDIO_PRESETS } from '../../lib/studio';
import { studio, StudioMeters } from '../../native/studio';
import { useStudio } from '../../store/studioStore';
import { Typography } from '../../theme';

const db = (value: number) => value > 0 ? `${(20 * Math.log10(value)).toFixed(1)} dBFS` : '−∞ dBFS';
const meterPercent = (value: number) => value > 0 ? Math.max(0, Math.min(100, (20 * Math.log10(value) + 60) / 60 * 100)) : 0;
export function StudioRack({ embedded = false }: { embedded?: boolean }) {
  const { colors: c } = useTheme();
  const { fontScale } = useWindowDimensions();
  const state = useStudio();
  const { isCasting } = useCast();
  const { isPlaying } = usePlaybackStatus();
  const [checkedPlayback, setCheckedPlayback] = useState(false);
  const [meters, setMeters] = useState<StudioMeters>();
  const [active, setActive] = useState(false);
  const [name, setName] = useState('');
  const [section, setSection] = useState<'mastering' | 'creative'>('mastering');
  const usable = studio.available && !isCasting && state.loaded;
  useEffect(() => {
    setCheckedPlayback(false);
    if (!isPlaying || isCasting) return;
    const timer = setTimeout(() => setCheckedPlayback(true), 3000);
    return () => clearTimeout(timer);
  }, [isPlaying, isCasting]);
  useEffect(() => {
    if (!studio.available || isCasting) return;
    let canceled = false, busy = false, last = -1, lastAudioAt = 0;
    const poll = async () => {
      if (busy || AppState.currentState !== 'active') return;
      busy = true;
      try {
        const next = await studio.meters();
        if (!canceled && next) {
          const now = Date.now();
          if (next.buffers !== last && next.buffers > 0) lastAudioAt = now;
          last = next.buffers;
          setMeters(next);
          setActive(lastAudioAt > 0 && now - lastAudioAt < 1500);
        }
      } catch { if (!canceled) setActive(false); }
      finally { busy = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 350);
    return () => { canceled = true; clearInterval(timer); };
  }, [isCasting]);
  const metering = active && isPlaying && !isCasting;
  const meterWarning = metering && (meters?.reduction ?? 0) > 3
    ? 'Peak guard is working hard. Reduce effect amounts for a cleaner sound.'
    : metering && (meters?.input ?? 0) >= 1
      ? 'Input peaks reach full scale. Output is being controlled by the peak guard.'
      : metering && (meters?.correlation ?? 1) < 0
        ? 'Wide stereo may lose detail in mono. Try reducing width.'
        : '';
  const push = () => {
    if (state.pushed) { state.setPushed(false); return; }
    Alert.alert('This can get ugly.', 'Extreme processing may cause distortion, harshness and unpredictable level changes. The output peak guard stays on. Continue?', [
      { text: 'Keep it controlled', style: 'cancel' },
      { text: 'Push it — I accept', style: 'destructive', onPress: () => state.setPushed(true) },
    ]);
  };
  const text = { color: c.textPrimary };
  const muted = { color: c.textMuted };
  const button = { borderColor: c.borderStrong, backgroundColor: c.bgSurface };
  return <ScrollView style={{ backgroundColor: c.bgPrimary }} contentContainerStyle={[s.screen, embedded && { paddingBottom: 32 }]}>
    <Text style={[s.kicker, { color: c.accent }]}>RESONANCE / STUDIO</Text>
    <Text style={[s.title, text]}>Shape the sound.</Text>
    <Text style={[s.copy, muted]}>A mastering rack with a creative streak. Automatic headroom, linked dynamics and a fixed −1 dBFS sample-peak ceiling.</Text>
    {!studio.available && <Text accessibilityRole="alert" style={[s.notice, { color: c.warning, borderColor: c.warning }]}>Studio needs a new native app build. These controls are unavailable in the installed version.</Text>}
    {isCasting && <Text accessibilityRole="alert" style={[s.notice, muted]}>The cast receiver plays the audio. Studio applies only to playback on this handset.</Text>}
    {studio.available && isPlaying && checkedPlayback && !active && !isCasting && <Text accessibilityRole="alert" style={[s.notice, { color: c.warning }]}>Studio is not receiving audio from this playback path. Processing and peak protection are unavailable for this route.</Text>}
    {state.error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{state.error}</Text>}
    <View style={[s.row, s.panel, button]}><View style={s.grow}><Text style={[s.label, text]}>Processing rack</Text><Text style={[s.small, muted]}>Peak guard remains on when bypassed</Text></View><Switch accessibilityLabel="Processing rack" value={state.enabled} disabled={!usable} onValueChange={state.setEnabled} trackColor={{ true: c.accent, false: c.bgElevated }} /></View>
    <View style={[s.panel, button]}>
      <Text style={[s.kicker, { color: metering ? c.accent : c.textMuted }]}>{metering ? 'AUDIO FLOWING / PEAK GUARD ON' : 'WAITING FOR HANDSET AUDIO'}</Text>
      <View style={s.row}>{[['Input', meters?.input ?? 0], ['Output', meters?.output ?? 0]].map(([label, value]) => <View key={label} style={s.grow}><Text style={[s.small, muted]}>{label}</Text><Text style={[s.readout, text]}>{metering ? db(Number(value)) : '—'}</Text><View style={[s.meter, { backgroundColor: c.bgElevated }]}><View style={{ height: 5, width: `${metering ? meterPercent(Number(value)) : 0}%`, backgroundColor: c.accent }} /></View></View>)}</View>
      <Text style={[s.small, muted]}>Limiter reduction {metering ? `${meters?.reduction.toFixed(1)} dB` : '—'} · Stereo correlation {metering ? meters?.correlation.toFixed(2) : '—'}</Text>
      <Text style={[s.small, muted]}>Sample peaks · dBFS · meter range −60 to 0 dBFS</Text>
      <View style={{ minHeight: 60 * Math.max(1, fontScale) }}>
        <Text style={[s.meterStatus, { color: meterWarning ? c.warning : c.textMuted }]}>{meterWarning || 'Peak levels are measured before handset volume. These are not LUFS loudness readings.'}</Text>
      </View>
    </View>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: state.bypass }} disabled={!usable || !state.enabled} onPress={() => state.setBypass(!state.bypass)} style={[s.action, s.grow, button, state.bypass && { borderColor: c.accent }]}><Text style={[s.label, text]}>{state.bypass ? 'A / Dry comparison' : 'B / Processed'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: state.pushed }} disabled={!usable} onPress={push} style={[s.action, button, { borderColor: state.pushed ? c.danger : c.borderStrong }]}><Text style={[s.label, { color: state.pushed ? c.danger : c.textPrimary }]}>{state.pushed ? 'Return to controlled' : 'Push it'}</Text></Pressable>
    </View>
    <Text style={[s.small, muted]}>A/B matches levels by attenuation, never extra gain. Extreme ranges reset when the app restarts. Your handset volume still controls listening level.</Text>
    <Text style={[s.kicker, muted]}>STARTING POINTS</Text>
    <View style={s.wrap}>{[...STUDIO_PRESETS, ...state.presets].map((preset, index) => <Pressable key={`${preset.name}-${index}`} accessibilityRole="button" disabled={!usable} onPress={() => { state.apply(preset.values); state.setEnabled(true); }} style={[s.chip, button]}><Text style={text}>{preset.name}</Text></Pressable>)}</View>
    <View style={s.row}>{(['mastering', 'creative'] as const).map(group => <Pressable key={group} accessibilityRole="tab" accessibilityState={{ selected: section === group }} style={[s.action, s.grow, { borderColor: section === group ? c.accent : c.borderStrong }]} onPress={() => setSection(group)}><Text style={[s.kicker, { color: section === group ? c.accent : c.textMuted }]}>{group.toUpperCase()}</Text></Pressable>)}</View>
    {STUDIO_MODULES.map((module, index) => module.group !== section ? null : <View key={module.id} style={[s.panel, button, { opacity: !usable || state.disabled[index] ? .5 : 1 }]}>
      <View style={s.row}><View style={s.grow}><Text style={[s.label, text]}>{module.title}</Text><Text style={[s.small, muted]}>{module.detail}</Text></View><Switch accessibilityLabel={`${module.title} enabled`} disabled={!usable} value={!state.disabled[index]} onValueChange={() => state.toggleModule(index)} trackColor={{ true: c.accent, false: c.bgElevated }} /></View>
      <View style={s.row}>
        <Pressable accessibilityLabel={`Reduce ${module.title}`} accessibilityRole="button" disabled={!usable || state.disabled[index]} onPress={() => state.setValue(index, state.values[index] - .025)} style={[s.step, button]}><Text style={[s.label, text]}>−</Text></Pressable>
        <View style={s.grow}><Text style={[s.readout, text]}>{Math.round(state.values[index] * 100)}<Text style={[s.small, muted]}> / {Math.round((state.pushed ? 1 : module.safe) * 100)}</Text></Text><View style={[s.meter, { backgroundColor: c.bgElevated }]}><View style={{ height: 5, width: `${state.values[index] * 100}%`, backgroundColor: state.values[index] > module.safe ? c.danger : c.accent }} /></View></View>
        <Pressable accessibilityLabel={`Increase ${module.title}`} accessibilityRole="button" disabled={!usable || state.disabled[index]} onPress={() => state.setValue(index, state.values[index] + .025)} style={[s.step, button]}><Text style={[s.label, text]}>+</Text></Pressable>
      </View>
    </View>)}
    <View style={[s.panel, button]}><Text style={[s.label, text]}>Save your rack</Text><TextInput accessibilityLabel="Preset name" placeholder="Preset name" placeholderTextColor={c.textMuted} value={name} maxLength={40} onChangeText={setName} style={[s.input, text, { borderColor: c.borderStrong }]} /><Pressable accessibilityRole="button" disabled={!usable || !name.trim()} onPress={() => { state.savePreset(name); setName(''); }} style={[s.action, button]}><Text style={text}>Save preset</Text></Pressable><Text style={[s.small, muted]}>Saved presets use controlled ranges. Push it consent is never saved.</Text></View>
  </ScrollView>;
}
export default function StudioScreen() { return <StudioRack />; }

const s = StyleSheet.create({ screen: { padding: 20, gap: 16, paddingBottom: 110 }, kicker: { fontFamily: Typography.mono, fontSize: 10, letterSpacing: 1 }, title: { fontFamily: Typography.display, fontSize: 36 }, copy: { fontSize: 14, lineHeight: 21 }, small: { fontSize: 11, lineHeight: 17 }, label: { fontSize: 14, fontWeight: '600' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, grow: { flex: 1 }, panel: { borderWidth: 1, padding: 16, gap: 14 }, action: { borderWidth: 1, padding: 13, alignItems: 'center', justifyContent: 'center', minHeight: 48 }, step: { borderWidth: 1, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, chip: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, meterStatus: { fontSize: 12, lineHeight: 20 }, readout: { fontVariant: ['tabular-nums'], fontFamily: Typography.mono, fontSize: 15, paddingVertical: 6 }, meter: { height: 5, overflow: 'hidden' }, notice: { padding: 14, borderWidth: 1, fontSize: 13, lineHeight: 20 }, input: { borderBottomWidth: 1, paddingVertical: 12, fontSize: 14 } });
