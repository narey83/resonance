import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { clampStudio, CLEAN_VALUES } from '../lib/studio';
const KEY = 'resonance_studio_v1';
interface SavedPreset { name: string; values: number[] }
interface StudioState {
  loaded: boolean; enabled: boolean; pushed: boolean; bypass: boolean;
  values: number[]; disabled: boolean[]; presets: SavedPreset[]; error: string | null;
  load(): Promise<void>;
  setEnabled(enabled: boolean): void;
  setValue(index: number, value: number): void;
  toggleModule(index: number): void;
  setPushed(pushed: boolean): void;
  setBypass(bypass: boolean): void;
  apply(values: readonly number[]): void;
  savePreset(name: string): void;
}
let writes: Promise<unknown> = Promise.resolve();
export const useStudio = create<StudioState>((set, get) => {
  const persist = () => {
    const { enabled, values, disabled, presets } = get();
    const json = JSON.stringify({ enabled, values: clampStudio(values), disabled, presets });
    writes = writes.catch(() => {}).then(() => SecureStore.setItemAsync(KEY, json)).catch(() => set({ error: 'Could not save Studio settings.' }));
  };
  return {
    loaded: false, enabled: false, pushed: false, bypass: false,
    values: [...CLEAN_VALUES], disabled: CLEAN_VALUES.map(() => false), presets: [], error: null,
    load: async () => {
      if (get().loaded) return;
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        const saved = raw ? JSON.parse(raw) : {};
        set({ loaded: true, enabled: saved.enabled === true, pushed: false, bypass: false,
          values: clampStudio(saved.values), disabled: CLEAN_VALUES.map((_, i) => saved.disabled?.[i] === true),
          presets: Array.isArray(saved.presets) ? saved.presets.filter((p: SavedPreset) => typeof p?.name === 'string').slice(0, 12).map((p: SavedPreset) => ({ name: p.name.slice(0, 40), values: clampStudio(p.values) })) : [],
        });
      } catch { set({ loaded: true, error: 'Could not read Studio settings. Started clean.' }); }
    },
    setEnabled: enabled => { set({ enabled }); persist(); },
    setValue: (index, value) => {
      if (!Number.isInteger(index) || index < 0 || index >= CLEAN_VALUES.length) return;
      const values = [...get().values]; values[index] = value;
      set({ values: clampStudio(values, get().pushed) }); persist();
    },
    toggleModule: index => {
      if (!Number.isInteger(index) || index < 0 || index >= CLEAN_VALUES.length) return;
      const disabled = [...get().disabled]; disabled[index] = !disabled[index]; set({ disabled }); persist();
    },
    setPushed: pushed => { set({ pushed, values: clampStudio(get().values, pushed) }); persist(); },
    setBypass: bypass => set({ bypass }),
    apply: values => { set({ values: clampStudio(values, get().pushed), disabled: CLEAN_VALUES.map(() => false), bypass: false }); persist(); },
    savePreset: name => {
      const trimmed = name.trim().slice(0, 40); if (!trimmed) return;
      const values = get().values.map((v, i) => get().disabled[i] ? 0 : v);
      set({ presets: [{ name: trimmed, values: clampStudio(values) }, ...get().presets.filter(p => p.name !== trimmed)].slice(0, 12) }); persist();
    },
  };
});
