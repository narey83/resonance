import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { clampStudio, CLEAN_VALUES, STUDIO_PRESETS } from '../lib/studio';
const KEY = 'resonance_studio_v1';
interface SavedPreset { name: string; values: number[] }
interface StudioState {
  loaded: boolean; enabled: boolean; pushed: boolean; bypass: boolean;
  selectedPresetId: string | null;
  values: number[]; disabled: boolean[]; presets: SavedPreset[]; error: string | null;
  load(): Promise<void>;
  setEnabled(enabled: boolean): void;
  setValue(index: number, value: number): void;
  toggleModule(index: number): void;
  setPushed(pushed: boolean): void;
  setBypass(bypass: boolean): void;
  apply(values: readonly number[], presetId?: string): void;
  savePreset(name: string): void;
}
let writes: Promise<unknown> = Promise.resolve();
export const useStudio = create<StudioState>((set, get) => {
  const persist = () => {
    const { enabled, values, disabled, presets, selectedPresetId } = get();
    const json = JSON.stringify({ enabled, values: clampStudio(values), disabled, presets, selectedPresetId });
    writes = writes.catch(() => {}).then(() => SecureStore.setItemAsync(KEY, json)).catch(() => set({ error: 'Could not save Studio settings.' }));
  };
  return {
    loaded: false, enabled: false, pushed: false, bypass: false, selectedPresetId: null,
    values: [...CLEAN_VALUES], disabled: CLEAN_VALUES.map(() => false), presets: [], error: null,
    load: async () => {
      if (get().loaded) return;
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        const saved = raw ? JSON.parse(raw) : {};
        const values = clampStudio(saved.values);
        const disabled = CLEAN_VALUES.map((_, i) => saved.disabled?.[i] === true);
        const presets: SavedPreset[] = Array.isArray(saved.presets) ? saved.presets.filter((p: SavedPreset) => typeof p?.name === 'string').slice(0, 12).map((p: SavedPreset) => ({ name: p.name.slice(0, 40), values: clampStudio(p.values) })) : [];
        const selected = [
          ...STUDIO_PRESETS.map(p => ({ ...p, id: `builtin:${p.name}` })),
          ...presets.map(p => ({ ...p, id: `saved:${p.name}` })),
        ].find(p => p.id === saved.selectedPresetId);
        const selectedPresetId = selected && !disabled.some(Boolean) && selected.values.every((value, i) => value === values[i]) ? selected.id : null;
        set({ loaded: true, enabled: saved.enabled === true, pushed: false, bypass: false,
          values, disabled, presets, selectedPresetId,
        });
      } catch { set({ loaded: true, error: 'Could not read Studio settings. Started clean.' }); }
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
    apply: (values, presetId) => { set({ values: clampStudio(values, get().pushed), selectedPresetId: presetId ?? null, disabled: CLEAN_VALUES.map(() => false), bypass: false }); persist(); },
    savePreset: name => {
      const trimmed = name.trim().slice(0, 40); if (!trimmed) return;
      const values = get().values.map((v, i) => get().disabled[i] ? 0 : v);
      const presets = [{ name: trimmed, values: clampStudio(values) }, ...get().presets.filter(p => p.name !== trimmed)].slice(0, 12);
      let selectedPresetId = get().selectedPresetId;
      if (selectedPresetId?.startsWith('saved:') && (selectedPresetId === `saved:${trimmed}` || !presets.some(p => `saved:${p.name}` === selectedPresetId))) selectedPresetId = null;
      set({ selectedPresetId, presets }); persist();
    },
  };
});
