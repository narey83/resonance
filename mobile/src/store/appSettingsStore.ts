import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { ThemeName } from '../theme';

const STORE_KEY = 'app_settings_v1';

export interface NotificationPrefs {
  downloadsComplete: boolean;
  uploadComplete:    boolean;
  shareScanComplete: boolean;
  serverDisconnect:  boolean;
}

// 'auto'     — full quality on wifi, transcode to low bitrate on cellular / slow links
// 'original' — always stream the original file (seekable, highest bandwidth)
// 'saver'    — always transcode to a low bitrate
export type StreamQuality = 'auto' | 'original' | 'saver';

interface AppSettingsStore {
  theme:             ThemeName;
  remoteLogging:     boolean;
  artworkBackground: boolean;
  streamQuality:     StreamQuality;
  notifications:     NotificationPrefs;
  loaded:            boolean;

  load:                  () => Promise<void>;
  setTheme:              (theme: ThemeName) => Promise<void>;
  setRemoteLogging:      (enabled: boolean) => Promise<void>;
  setArtworkBackground:  (enabled: boolean) => Promise<void>;
  setStreamQuality:      (quality: StreamQuality) => Promise<void>;
  setNotification:       (key: keyof NotificationPrefs, enabled: boolean) => Promise<void>;
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  downloadsComplete: true,
  uploadComplete:    false,
  shareScanComplete: false,
  serverDisconnect:  true,
};

export const useAppSettings = create<AppSettingsStore>((set, get) => ({
  theme:             'system',
  remoteLogging:     false,
  artworkBackground: true,
  streamQuality:     'auto',
  notifications:     DEFAULT_NOTIFICATIONS,
  loaded:            false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      set({
        theme:             parsed.theme             ?? 'system',
        remoteLogging:     parsed.remoteLogging     ?? false,
        artworkBackground: parsed.artworkBackground ?? true,
        streamQuality:     parsed.streamQuality     ?? 'auto',
        notifications:     { ...DEFAULT_NOTIFICATIONS, ...(parsed.notifications ?? {}) },
        loaded:            true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  setTheme: async (theme) => {
    set({ theme });
    await persist(get());
  },

  setRemoteLogging: async (enabled) => {
    set({ remoteLogging: enabled });
    await persist(get());
  },

  setArtworkBackground: async (enabled) => {
    set({ artworkBackground: enabled });
    await persist(get());
  },

  setStreamQuality: async (quality) => {
    set({ streamQuality: quality });
    await persist(get());
  },

  setNotification: async (key, enabled) => {
    const notifications = { ...get().notifications, [key]: enabled };
    set({ notifications });
    await persist({ ...get(), notifications });
  },
}));

async function persist(state: Pick<AppSettingsStore, 'theme' | 'remoteLogging' | 'artworkBackground' | 'streamQuality' | 'notifications'>) {
  try {
    await SecureStore.setItemAsync(
      STORE_KEY,
      JSON.stringify({
        theme:             state.theme,
        remoteLogging:     state.remoteLogging,
        artworkBackground: state.artworkBackground,
        streamQuality:     state.streamQuality,
        notifications:     state.notifications,
      }),
    );
  } catch {}
}
