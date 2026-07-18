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
  privateMessage:    boolean;
  roomMention:       boolean;
  userBlocked:       boolean;
}

// 'auto'     — full quality on wifi, transcode to low bitrate on cellular / slow links
// 'original' — always stream the original file (seekable, highest bandwidth)
// 'saver'    — always transcode to a low bitrate
export type StreamQuality = 'auto' | 'original' | 'saver';

// 'bubble' — floating draggable chat-head player (experimental)
// 'bar'    — classic docked mini-bar above the tab bar
export type PlayerMode = 'bubble' | 'bar';

interface AppSettingsStore {
  theme:             ThemeName;
  remoteLogging:     boolean;
  librarySyncDebug:  boolean;
  backendLogs:       boolean;
  artworkBackground: boolean;
  streamQuality:     StreamQuality;
  playerMode:        PlayerMode;
  notifications:     NotificationPrefs;
  loaded:            boolean;

  load:                  () => Promise<void>;
  setTheme:              (theme: ThemeName) => Promise<void>;
  setRemoteLogging:      (enabled: boolean) => Promise<void>;
  setLibrarySyncDebug:   (enabled: boolean) => Promise<void>;
  setBackendLogs:        (enabled: boolean) => Promise<void>;
  setArtworkBackground:  (enabled: boolean) => Promise<void>;
  setStreamQuality:      (quality: StreamQuality) => Promise<void>;
  setPlayerMode:         (mode: PlayerMode) => Promise<void>;
  setNotification:       (key: keyof NotificationPrefs, enabled: boolean) => Promise<void>;
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  downloadsComplete: true,
  uploadComplete:    false,
  shareScanComplete: false,
  serverDisconnect:  true,
  privateMessage:    true,
  roomMention:       true,
  userBlocked:       true,
};

export const useAppSettings = create<AppSettingsStore>((set, get) => ({
  theme:             'system',
  remoteLogging:     false,
  librarySyncDebug:  false,
  backendLogs:       false,
  artworkBackground: true,
  streamQuality:     'auto',
  playerMode:        'bubble',
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
        backendLogs:       parsed.backendLogs       ?? false,
        artworkBackground: parsed.artworkBackground ?? true,
        streamQuality:     parsed.streamQuality     ?? 'auto',
        playerMode:        parsed.playerMode         ?? 'bubble',
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

  setBackendLogs: async (enabled) => {
    set({ backendLogs: enabled });
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

  setPlayerMode: async (mode) => {
    set({ playerMode: mode });
    await persist(get());
  },

  setNotification: async (key, enabled) => {
    const notifications = { ...get().notifications, [key]: enabled };
    set({ notifications });
    await persist({ ...get(), notifications });
  },
}));

async function persist(state: Pick<AppSettingsStore, 'theme' | 'remoteLogging' | 'librarySyncDebug' | 'backendLogs' | 'artworkBackground' | 'streamQuality' | 'playerMode' | 'notifications'>) {
  try {
    await SecureStore.setItemAsync(
      STORE_KEY,
      JSON.stringify({
        theme:             state.theme,
        remoteLogging:     state.remoteLogging,
        librarySyncDebug:  state.librarySyncDebug,
        backendLogs:       state.backendLogs,
        artworkBackground: state.artworkBackground,
        streamQuality:     state.streamQuality,
        playerMode:        state.playerMode,
        notifications:     state.notifications,
      }),
    );
  } catch {}
}
