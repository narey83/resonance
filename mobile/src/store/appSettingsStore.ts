// <copyright file="appSettingsStore.ts" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

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
  librarySyncDebug:  boolean;
  artworkBackground: boolean;
  streamQuality:     StreamQuality;
  notifications:     NotificationPrefs;
  loaded:            boolean;

  load:                  () => Promise<void>;
  setTheme:              (theme: ThemeName) => Promise<void>;
  setRemoteLogging:      (enabled: boolean) => Promise<void>;
  setLibrarySyncDebug:   (enabled: boolean) => Promise<void>;
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
  librarySyncDebug:  false,
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
        librarySyncDebug:  parsed.librarySyncDebug  ?? false,
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

  setLibrarySyncDebug: async (enabled) => {
    set({ librarySyncDebug: enabled });
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

async function persist(state: Pick<AppSettingsStore, 'theme' | 'remoteLogging' | 'librarySyncDebug' | 'artworkBackground' | 'streamQuality' | 'notifications'>) {
  try {
    await SecureStore.setItemAsync(
      STORE_KEY,
      JSON.stringify({
        theme:             state.theme,
        remoteLogging:     state.remoteLogging,
        librarySyncDebug:  state.librarySyncDebug,
        artworkBackground: state.artworkBackground,
        streamQuality:     state.streamQuality,
        notifications:     state.notifications,
      }),
    );
  } catch {}
}
