import { Editorial, Typography } from '../../theme';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useCast } from '../../context/CastContext';
import { needsStudioTone, presetTone, STUDIO_EQ_BANDS, STUDIO_MODULES, STUDIO_PRESETS } from '../../lib/studio';
import { studio } from '../../native/studio';
import { useStudio } from '../../store/studioStore';
import StudioSlider, { studioSlidersAvailable } from '../../components/StudioSlider';

export function StudioRack({ embedded = false }: { embedded?: boolean }) {
  const { colors: c } = useTheme();
  const state = useStudio();
  const { isCasting } = useCast();
  const [name, setName] = useState('');
  const [section, setSection] = useState<'tone' | 'mastering' | 'creative'>('tone');
  const usable = studio.available && !isCasting && state.loaded;
  const toneUsable = usable && studio.enhancedAvailable;
  const push = () => {
    if (state.pushed) { state.setPushed(false); return; }
    Alert.alert('This can get ugly.', 'Extreme processing may cause distortion, harshness and unpredictable level changes. The output peak guard stays on. Continue?', [
      { text: 'Keep it controlled', style: 'cancel' },
      { text: 'Push it — I accept', style: 'destructive', onPress: () => state.setPushed(true) },
    ]);
  };
  const text = { color: c.textPrimary };
  const muted = { color: c.textMuted };
  const presets = [
    ...[...STUDIO_PRESETS.filter(preset => preset.tones), ...STUDIO_PRESETS.filter(preset => !preset.tones)].map(preset => ({ ...preset, id: `builtin:${preset.name}` })),
    ...state.presets.map(preset => ({ ...preset, id: `saved:${preset.name}` })),
  ];
  const presetRows = Array.from({ length: Math.ceil(presets.length / 2) }, (_, row) => presets.slice(row * 2, row * 2 + 2));
  const selectedPreset = presets.find(preset => preset.id === state.selectedPresetId);
  const button = { borderColor: c.borderStrong, backgroundColor: c.bgSurface };
  const level = (label: string, value: number, change: (value: number) => void, disabled: boolean, step = .05, min = 0, max = 1, db = false) => <View style={s.row}>
    <View style={s.grow}><Text style={[s.label, text]}>{label}</Text><Text accessibilityRole="adjustable" accessibilityState={{ disabled }} accessibilityLabel={label} accessibilityValue={{ min, max, now: value, text: db ? `${value.toFixed(1)} dB` : `${Math.round(value * 100)} percent` }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={event => { const action = event.nativeEvent.actionName; if (!disabled && (action === 'increment' || action === 'decrement')) change(Math.max(min, Math.min(max, value + (action === 'increment' ? step : -step)))); }} style={[s.readout, text]}>{db ? `${value > 0 ? '+' : ''}${value.toFixed(1)} dB` : `${Math.round(value * 100)}%`}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Reduce ${label}`} disabled={disabled || value <= min} onPress={() => change(Math.max(min, value - step))} style={[s.step, button]}><Text style={[s.label, text]}>−</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} disabled={disabled || value >= max} onPress={() => change(Math.min(max, value + step))} style={[s.step, button]}><Text style={[s.label, text]}>+</Text></Pressable>
  </View>;
  return <ScrollView style={{ backgroundColor: c.bgPrimary }} contentContainerStyle={[s.screen, embedded && { paddingBottom: 32 }]}>
    <Text style={[s.kicker, { color: c.accent }]}>RESONANCE / STUDIO</Text>
    <Text style={[s.title, text]}>Shape the sound.</Text>
    <Text style={[s.copy, muted]}>Headphone and speaker tuning, eight-band EQ and a mastering rack with a creative streak. Automatic headroom and a fixed −1 dBFS sample-peak ceiling.</Text>
    {!studio.available && <Text accessibilityRole="alert" style={[s.notice, { color: c.warning, borderColor: c.warning }]}>Studio needs a new native app build. These controls are unavailable in the installed version.</Text>}
    {isCasting && <Text accessibilityRole="alert" style={[s.notice, muted]}>The cast receiver plays the audio. Studio applies only to playback on this handset.</Text>}
    {studio.available && !studio.enhancedAvailable && <Text accessibilityRole="alert" style={[s.notice, { color: c.warning, borderColor: c.warning }]}>EQ, tone controls and preset Amount need an updated native app build.</Text>}
    {studio.available && !studioSlidersAvailable && <Text accessibilityRole="alert" style={[s.notice, { color: c.warning, borderColor: c.warning }]}>Sliders need an updated native app build. Rebuild the app to adjust Amount and EQ.</Text>}
    <Text style={[s.kicker, muted]}>LISTENING THROUGH</Text>
    <View style={s.row}>{(['headphones', 'speakers'] as const).map(profile => <Pressable key={profile} accessibilityRole="button" accessibilityLabel={profile === 'headphones' ? 'Headphones and earbuds' : 'Speakers'} accessibilityState={{ selected: state.outputProfile === profile, disabled: !toneUsable }} disabled={!toneUsable} onPress={() => state.setOutputProfile(profile)} style={[s.action, s.grow, button, state.outputProfile === profile && { borderColor: c.accent }]}><Text style={[s.label, text]}>{profile === 'headphones' ? 'Headphones' : 'Speakers'}</Text></Pressable>)}</View>
    <Text style={[s.small, muted]}>Choose your output. Each profile remembers its own rack and tone settings.</Text>
    {state.error && <Text accessibilityRole="alert" style={{ color: c.danger }}>{state.error}</Text>}
    <View style={[s.row, s.panel, button]}><View style={s.grow}><Text style={[s.label, text]}>Processing rack</Text><Text style={[s.small, muted]}>Peak guard remains on when bypassed</Text></View><Switch accessibilityLabel="Processing rack" value={state.enabled} disabled={!usable} onValueChange={state.setEnabled} trackColor={{ true: c.accent, false: c.bgElevated }} /></View>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: state.bypass }} disabled={!usable || !state.enabled} onPress={() => state.setBypass(!state.bypass)} style={[s.action, s.grow, button, state.bypass && { borderColor: c.accent }]}><Text style={[s.label, text]}>{state.bypass ? 'A / Dry comparison' : 'B / Processed'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: state.pushed }} disabled={!usable} onPress={push} style={[s.action, button, { borderColor: state.pushed ? c.danger : c.borderStrong }]}><Text style={[s.label, { color: state.pushed ? c.danger : c.textPrimary }]}>{state.pushed ? 'Return to controlled' : 'Push it'}</Text></Pressable>
    </View>
    <Text style={[s.small, muted]}>A/B matches levels by attenuation, never extra gain. Extreme ranges reset when the app restarts. Your handset volume still controls listening level.</Text>
    <Text style={[s.kicker, muted]}>STARTING POINTS</Text>
    <View style={s.presetGrid}>{presetRows.map(row => <View key={row[0].id} style={s.presetRow}>{row.map(preset => {
      const presetUsable = usable && (studio.enhancedAvailable || !needsStudioTone(preset, state.outputProfile));
      const selected = presetUsable && state.enabled && !state.bypass && preset.id === state.selectedPresetId;
      return <Pressable key={preset.id} accessibilityRole="button" accessibilityLabel={preset.name} accessibilityState={{ selected, disabled: !presetUsable }} disabled={!presetUsable} onPress={() => {
        if (selected) { state.setEnabled(false); return; }
        if (preset.id === state.selectedPresetId) { state.setBypass(false); state.setEnabled(true); return; }
        state.apply(preset.values, preset.id, presetTone(preset, state.outputProfile));
        state.setEnabled(true);
      }} style={[s.chip, button, selected && { borderColor: c.accent, backgroundColor: c.bgElevated }]}>
        <Text style={[s.presetLabel, text, selected && { color: c.accent, fontWeight: '700' }]}>{preset.name}</Text>
      </Pressable>;
    })}{row.length === 1 && <View style={s.grow} />}</View>)}</View>
    <Text accessibilityLiveRegion="polite" style={[s.small, muted]}>{selectedPreset ? `${selectedPreset.name} · ${!usable ? 'Unavailable on this playback route' : needsStudioTone(selectedPreset, state.outputProfile) && !studio.enhancedAvailable ? 'Needs an updated native app build' : !state.enabled ? 'Rack off' : state.bypass ? 'Bypassed for dry comparison' : 'Active'}` : 'Custom settings · choose a starting point or save your rack.'}</Text>
    <View style={[s.panel, button]}><StudioSlider label="Preset amount" value={state.amount} onChange={state.setAmount} disabled={!toneUsable} /><Text style={[s.small, muted]}>Blend the strength of the whole preset. At 0%, the effects and EQ are neutral; the peak guard stays on.</Text></View>
    <View style={s.row}>{(['tone', 'mastering', 'creative'] as const).map(group => <Pressable key={group} accessibilityRole="tab" accessibilityState={{ selected: section === group }} style={[s.action, s.grow, { borderColor: section === group ? c.accent : c.borderStrong }]} onPress={() => setSection(group)}><Text style={[s.kicker, { color: section === group ? c.accent : c.textMuted }]}>{group.toUpperCase()}</Text></Pressable>)}</View>
    {section === 'tone' && <>
      <View style={[s.panel, button]}><Text style={[s.kicker, muted]}>DYNAMIC TONE</Text>{level('Bass control', state.bassControl, state.setBassControl, !toneUsable)}<Text style={[s.small, muted]}>Tames excessive bass bloom as it appears, preserving quieter passages.</Text>{level('Smoothness', state.smoothness, state.setSmoothness, !toneUsable)}<Text style={[s.small, muted]}>Softens prominent upper mids and treble as the music changes.</Text></View>
      <View style={[s.panel, button]}><View style={s.row}><Text style={[s.label, s.grow, text]}>Eight-band EQ</Text><Pressable accessibilityRole="button" accessibilityLabel="Reset EQ" disabled={!toneUsable} onPress={state.resetEq}><Text style={{ color: c.accent }}>Reset</Text></Pressable></View><Text style={[s.small, muted]}>±6 dB per band, with automatic headroom for boosts. Adjust for your headphones, speakers and room.</Text>{STUDIO_EQ_BANDS.map((band, i) => <View key={band.hz}><StudioSlider label={`EQ ${band.label}`} value={state.eq[i]} onChange={(gain, save) => state.setEq(i, gain, save)} disabled={!toneUsable} db /><Text style={[s.small, muted]}>{band.detail}</Text></View>)}</View>
    </>}
    {STUDIO_MODULES.map((module, index) => module.group !== section ? null : <View key={module.id} style={[s.panel, button, { opacity: !usable || state.disabled[index] ? .5 : 1 }]}>
      <View style={s.row}><View style={s.grow}><Text style={[s.label, text]}>{module.title}</Text><Text style={[s.small, muted]}>{module.detail}</Text></View><Switch accessibilityLabel={`${module.title} enabled`} disabled={!usable} value={!state.disabled[index]} onValueChange={() => state.toggleModule(index)} trackColor={{ true: c.accent, false: c.bgElevated }} /></View>
      <View style={s.row}>
        <Pressable accessibilityLabel={`Reduce ${module.title}`} accessibilityRole="button" disabled={!usable || state.disabled[index]} onPress={() => state.setValue(index, state.values[index] - .025)} style={[s.step, button]}><Text style={[s.label, text]}>−</Text></Pressable>
        <View style={s.grow}><Text style={[s.readout, text]}>{Math.round(state.values[index] * 100)}<Text style={[s.small, muted]}> / {Math.round((state.pushed ? 1 : module.safe) * 100)}</Text></Text><View style={[s.amountTrack, { backgroundColor: c.bgElevated }]}><View style={{ height: 5, width: `${state.values[index] * 100}%`, backgroundColor: state.values[index] > module.safe ? c.danger : c.accent }} /></View></View>
        <Pressable accessibilityLabel={`Increase ${module.title}`} accessibilityRole="button" disabled={!usable || state.disabled[index]} onPress={() => state.setValue(index, state.values[index] + .025)} style={[s.step, button]}><Text style={[s.label, text]}>+</Text></Pressable>
      </View>
    </View>)}
    <View style={[s.panel, button]}><Text style={[s.label, text]}>Save your rack</Text><TextInput accessibilityLabel="Preset name" placeholder="Preset name" placeholderTextColor={c.textMuted} value={name} maxLength={40} onChangeText={setName} style={[s.input, text, { borderColor: c.borderStrong }]} /><Pressable accessibilityRole="button" disabled={!usable || !name.trim()} onPress={() => { state.savePreset(name); setName(''); }} style={[s.action, button]}><Text style={text}>Save preset</Text></Pressable><Text style={[s.small, muted]}>Saved presets use controlled ranges. Push it consent is never saved.</Text></View>
  </ScrollView>;
}
export default function StudioScreen() { return <StudioRack />; }

const s = StyleSheet.create({ screen: { padding: 20, gap: 16, paddingBottom: 110 }, kicker: { fontSize: 10, ...Editorial.label }, title: { fontSize: 36, ...Editorial.heading }, copy: { fontSize: 14, lineHeight: 21 }, small: { fontSize: 11, lineHeight: 17 }, label: { fontSize: 14, fontWeight: '600' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, grow: { flex: 1 }, panel: { borderWidth: 1, padding: 16, gap: 14, ...Editorial.panel }, action: { borderWidth: 1, padding: 13, alignItems: 'center', justifyContent: 'center', minHeight: 48 }, step: { borderWidth: 1, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, chip: { flex: 1, minWidth: 0, borderWidth: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12, ...Editorial.control }, presetGrid: { gap: 12 }, presetRow: { flexDirection: 'row', gap: 12 }, presetLabel: { textAlign: 'center' }, readout: { fontVariant: ['tabular-nums'], fontFamily: Typography.mono, fontSize: 15, paddingVertical: 6 }, amountTrack: { height: 5, overflow: 'hidden' }, notice: { padding: 14, borderWidth: 1, fontSize: 13, lineHeight: 20 }, input: { borderBottomWidth: 1, paddingVertical: 12, fontSize: 14, ...Editorial.control } });
