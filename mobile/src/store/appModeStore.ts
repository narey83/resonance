import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export type AppMode = 'choose' | 'local' | 'remote';
const KEY = 'resonance_app_mode_v1';
const STORAGE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
interface AppModeState {
  mode: AppMode;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  select: (mode: AppMode) => Promise<void>;
}
let writes: Promise<unknown> = Promise.resolve();
export const useAppMode = create<AppModeState>((set) => ({
  mode: 'choose', loaded: false, error: null,
  load: async () => {
    try {
      const saved = await SecureStore.getItemAsync(KEY);
      set({ mode: saved === 'local' || saved === 'remote' ? saved : 'choose', loaded: true, error: null });
      if (saved === 'local' || saved === 'remote') {
        // Keep the startup choice readable when CarPlay connects to a locked phone.
        const migrate = writes.then(async () => {
          if (useAppMode.getState().mode === saved) await SecureStore.setItemAsync(KEY, saved, STORAGE_OPTIONS);
        });
        writes = migrate.catch(() => {});
        await writes;
      }
    } catch { set({ mode: 'choose', loaded: true, error: 'Could not read your saved startup choice.' }); }
  },
  select: async mode => {
    const save = writes.then(() => SecureStore.setItemAsync(KEY, mode, STORAGE_OPTIONS));
    writes = save.catch(() => {});
    try { await save; set({ mode, loaded: true, error: null }); }
    catch { set({ error: 'Could not save your startup choice. Please try again.' }); throw new Error('Could not save your startup choice.'); }
  },
}));
