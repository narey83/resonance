import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

export type LibraryTab = 'Artists' | 'Albums' | 'Tracks' | 'Folders' | 'Genres' | 'Years' | 'Mixtapes' | 'Loved' | 'History';

export const ALL_TABS: LibraryTab[] = ['Artists', 'Albums', 'Tracks', 'Folders', 'Genres', 'Years', 'Mixtapes', 'Loved', 'History'];
const DEFAULT_TABS: LibraryTab[] = ['Artists', 'Albums', 'Tracks', 'Folders', 'Genres', 'Years', 'Mixtapes', 'Loved', 'History'];
const STORE_KEY = 'library_settings_v1';
// Bumped when a new tab is introduced so settings saved before it existed pick it up
const SETTINGS_VERSION = 2;

interface LibrarySettingsStore {
  visibleTabs: LibraryTab[];
  loaded: boolean;
  load: () => Promise<void>;
  setVisibleTabs: (tabs: LibraryTab[]) => Promise<void>;
}

export const useLibrarySettings = create<LibrarySettingsStore>((set) => ({
  visibleTabs: DEFAULT_TABS,
  loaded: false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORE_KEY);
      if (raw) {
        let { visibleTabs, version } = JSON.parse(raw) as { visibleTabs: string[]; version?: number };
        // Migrate: 'Playlists' was renamed to 'Mixtapes'
        visibleTabs = (visibleTabs ?? DEFAULT_TABS).map((t) => t === 'Playlists' ? 'Mixtapes' : t);
        // Migrate: 'Albums' tab was re-added; surface it for settings saved before it existed
        if ((version ?? 1) < 2 && !visibleTabs.includes('Albums')) {
          visibleTabs = [...visibleTabs, 'Albums'];
        }
        // Keep only known tabs, sorted by the canonical ALL_TABS order
        const sorted = (visibleTabs as LibraryTab[])
          .filter((t) => ALL_TABS.includes(t))
          .sort((a, b) => ALL_TABS.indexOf(a) - ALL_TABS.indexOf(b));
        set({ visibleTabs: sorted.length ? sorted : DEFAULT_TABS, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  setVisibleTabs: async (tabs) => {
    set({ visibleTabs: tabs });
    try {
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ visibleTabs: tabs, version: SETTINGS_VERSION }));
    } catch {}
  },
}));
