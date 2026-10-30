import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { clampStudio, clampTone, CLEAN_VALUES, presetTone, studioNumber, STUDIO_PRESETS, StudioOutputProfile, StudioPreset, StudioToneSettings } from '../lib/studio';
const KEY = 'resonance_studio_v1';
interface SavedPreset extends StudioPreset { values: number[]; tone: StudioToneSettings }
interface StudioProfile extends StudioToneSettings {
  enabled: boolean; values: number[]; disabled: boolean[]; selectedPresetId: string | null;
}
interface StudioState extends StudioProfile {
  loaded: boolean; pushed: boolean; bypass: boolean;
  outputProfile: StudioOutputProfile;
  profiles: Record<StudioOutputProfile, StudioProfile>;
  presets: SavedPreset[]; error: string | null;
  load(): Promise<void>;
  setOutputProfile(profile: StudioOutputProfile): void;
  setEnabled(enabled: boolean): void;
  setValue(index: number, value: number): void;
  toggleModule(index: number): void;
  setPushed(pushed: boolean): void;
  setBypass(bypass: boolean): void;
  setEq(index: number, gain: number): void;
  resetEq(): void;
  setBassControl(value: number): void;
  setSmoothness(value: number): void;
  setAmount(value: number): void;
  apply(values: readonly number[], presetId?: string, tone?: StudioToneSettings): void;
  savePreset(name: string): void;
}
function readProfile(value?: unknown): StudioProfile {
  const data = value && typeof value === 'object' ? value as Partial<StudioProfile> : {};
  return { ...clampTone(data), enabled: data.enabled === true, values: clampStudio(data.values),
    disabled: CLEAN_VALUES.map((_, i) => data.disabled?.[i] === true),
    selectedPresetId: typeof data.selectedPresetId === 'string' ? data.selectedPresetId : null };
}
function validateSelection(profile: StudioProfile, presets: SavedPreset[], output: StudioOutputProfile): StudioProfile {
  const preset = [
    ...STUDIO_PRESETS.map(p => ({ ...p, id: `builtin:${p.name}` })),
    ...presets.map(p => ({ ...p, id: `saved:${p.name}` })),
  ].find(p => p.id === profile.selectedPresetId);
  const tone = preset ? presetTone(preset, output) : null;
  const matches = preset && tone && !profile.disabled.some(Boolean) && preset.values.every((v, i) => v === profile.values[i])
    && tone.eq.every((v, i) => v === profile.eq[i]) && tone.bassControl === profile.bassControl && tone.smoothness === profile.smoothness;
  return { ...profile, selectedPresetId: matches ? preset.id : null };
}
// Keep the existing storage key and legacy fields so an older client can still read its rack.
// The active profile lives in the top-level fields; inactive profiles are snapshotted on switch.
let writes: Promise<unknown> = Promise.resolve();
export const useStudio = create<StudioState>((set, get) => {
  const persist = () => {
    const state = get();
    const active = readProfile(state);
    const profiles = { ...state.profiles, [state.outputProfile]: active };
    const json = JSON.stringify({ version: 2, ...active, outputProfile: state.outputProfile, profiles, presets: state.presets });
    writes = writes.catch(() => {}).then(() => SecureStore.setItemAsync(KEY, json)).catch(() => set({ error: 'Could not save Studio settings.' }));
  };
  return {
    ...readProfile(), loaded: false, pushed: false, bypass: false,
    outputProfile: 'headphones', profiles: { headphones: readProfile(), speakers: readProfile() }, presets: [], error: null,
    load: async () => {
      if (get().loaded) return;
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        const saved = raw ? JSON.parse(raw) : {};
        const outputProfile: StudioOutputProfile = saved.outputProfile === 'speakers' ? 'speakers' : 'headphones';
        const presets: SavedPreset[] = Array.isArray(saved.presets) ? saved.presets.filter((p: SavedPreset) => typeof p?.name === 'string').slice(0, 12).map((p: SavedPreset) => ({ name: p.name.slice(0, 40), values: clampStudio(p.values), tone: clampTone(p.tone) })) : [];
        const profiles = {
          headphones: validateSelection(readProfile(saved.profiles?.headphones ?? saved), presets, 'headphones'),
          speakers: validateSelection(readProfile(saved.profiles?.speakers), presets, 'speakers'),
        };
        set({ loaded: true, pushed: false, bypass: false, outputProfile, profiles, presets, ...profiles[outputProfile] });
      } catch { set({ loaded: true, error: 'Could not read Studio settings. Started clean.' }); }
    },
    setOutputProfile: outputProfile => {
      if (!['headphones', 'speakers'].includes(outputProfile) || outputProfile === get().outputProfile) return;
      const profiles = { ...get().profiles, [get().outputProfile]: readProfile(get()) };
      const next = validateSelection(readProfile(profiles[outputProfile]), get().presets, outputProfile);
      set({ outputProfile, profiles, ...next, bypass: false }); persist();
    },
    setEnabled: enabled => { set({ enabled }); persist(); },
    setValue: (index, value) => {
      if (!Number.isInteger(index) || index < 0 || index >= CLEAN_VALUES.length) return;
      const values = [...get().values]; values[index] = value;
      const clamped = clampStudio(values, get().pushed);
      set({ values: clamped, selectedPresetId: clamped[index] === get().values[index] ? get().selectedPresetId : null }); persist();
    },
    toggleModule: index => {
      if (!Number.isInteger(index) || index < 0 || index >= CLEAN_VALUES.length) return;
      const disabled = [...get().disabled]; disabled[index] = !disabled[index]; set({ disabled, selectedPresetId: null }); persist();
    },
    setPushed: pushed => {
      const values = clampStudio(get().values, pushed);
      const selectedPresetId = values.every((value, i) => value === get().values[i]) ? get().selectedPresetId : null;
      set({ pushed, values, selectedPresetId }); persist();
    },
    setBypass: bypass => set({ bypass }),
    setEq: (index, gain) => {
      if (!Number.isInteger(index) || index < 0 || index >= get().eq.length) return;
      const eq = [...get().eq]; eq[index] = studioNumber(gain, -6, 6);
      set({ eq, selectedPresetId: eq[index] === get().eq[index] ? get().selectedPresetId : null }); persist();
    },
    resetEq: () => { if (!get().eq.some(gain => gain !== 0)) return; set({ eq: get().eq.map(() => 0), selectedPresetId: null }); persist(); },
    setBassControl: value => { const bassControl = studioNumber(value, 0, 1); set({ bassControl, selectedPresetId: bassControl === get().bassControl ? get().selectedPresetId : null }); persist(); },
    setSmoothness: value => { const smoothness = studioNumber(value, 0, 1); set({ smoothness, selectedPresetId: smoothness === get().smoothness ? get().selectedPresetId : null }); persist(); },
    setAmount: value => { set({ amount: studioNumber(value, 0, 1, 1) }); persist(); },
    apply: (values, presetId, tone) => {
      set({ values: clampStudio(values, get().pushed), ...clampTone(tone), selectedPresetId: presetId ?? null, disabled: CLEAN_VALUES.map(() => false), bypass: false }); persist();
    },
    savePreset: name => {
      const trimmed = name.trim().slice(0, 40); if (!trimmed) return;
      const values = get().values.map((v, i) => get().disabled[i] ? 0 : v);
      const presets = [{ name: trimmed, values: clampStudio(values), tone: clampTone(get()) }, ...get().presets.filter(p => p.name !== trimmed)].slice(0, 12);
      let selectedPresetId = get().selectedPresetId;
      if (selectedPresetId?.startsWith('saved:') && (selectedPresetId === `saved:${trimmed}` || !presets.some(p => `saved:${p.name}` === selectedPresetId))) selectedPresetId = null;
      set({ selectedPresetId, presets }); persist();
    },
  };
});
