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
import { isAccentName, isThemeName, type AccentName } from '../lib/appearance';

const STORE_KEY = 'app_settings_v1';

export interface NotificationPrefs {
  downloadsComplete: boolean;
  uploadComplete:    boolean;
  shareScanComplete: boolean;
  privateMessage:    boolean;
  roomMention:       boolean;
  backgroundChat:    boolean;
  userBlocked:       boolean;
  restartRequired:   boolean;
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
  accentColour:      AccentName;
  remoteLogging:     boolean;
  librarySyncDebug:  boolean;
  perfProbe:         boolean;
  backendLogs:       boolean;
  artworkBackground: boolean;
  streamQuality:     StreamQuality;
  playerMode:        PlayerMode;
  showTrackNumbers:  boolean;
  notifications:     NotificationPrefs;
  loaded:            boolean;

  load:                  () => Promise<void>;
  setTheme:              (theme: ThemeName) => Promise<void>;
  setAccentColour:       (colour: AccentName) => Promise<void>;
  setRemoteLogging:      (enabled: boolean) => Promise<void>;
  setLibrarySyncDebug:   (enabled: boolean) => Promise<void>;
  setPerfProbe:          (enabled: boolean) => Promise<void>;
  setBackendLogs:        (enabled: boolean) => Promise<void>;
  setArtworkBackground:  (enabled: boolean) => Promise<void>;
  setStreamQuality:      (quality: StreamQuality) => Promise<void>;
  setPlayerMode:         (mode: PlayerMode) => Promise<void>;
  setShowTrackNumbers:   (enabled: boolean) => Promise<void>;
  setNotification:       (key: keyof NotificationPrefs, enabled: boolean) => Promise<void>;
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  downloadsComplete: false,
  uploadComplete:    false,
  shareScanComplete: false,
  privateMessage:    true,
  roomMention:       true,
  backgroundChat:    false,
  userBlocked:       false,
  // On by default: only administrators are sent this, and a config change sitting
  // unapplied is exactly the kind of thing that goes unnoticed otherwise.
  restartRequired:   true,
};

export const useAppSettings = create<AppSettingsStore>((set, get) => ({
  theme:             'system',
  accentColour:      'default',
  remoteLogging:     false,
  librarySyncDebug:  false,
  perfProbe:         false,
  backendLogs:       false,
  artworkBackground: true,
  streamQuality:     'auto',
  playerMode:        'bar',
  showTrackNumbers:  false,
  notifications:     DEFAULT_NOTIFICATIONS,
  loaded:            false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      set({
        theme:             isThemeName(parsed.theme) ? parsed.theme : 'system',
        accentColour:      isAccentName(parsed.accentColour) ? parsed.accentColour : 'default',
        remoteLogging:     parsed.remoteLogging     ?? false,
        librarySyncDebug:  parsed.librarySyncDebug  ?? false,
        perfProbe:         parsed.perfProbe         ?? false,
        backendLogs:       parsed.backendLogs       ?? false,
        artworkBackground: parsed.artworkBackground ?? true,
        streamQuality:     parsed.streamQuality     ?? 'auto',
        playerMode:        parsed.playerMode         ?? 'bar',
        showTrackNumbers:  parsed.showTrackNumbers === true,
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

  setAccentColour: async (colour) => {
    if (!isAccentName(colour)) return;
    set({ accentColour: colour });
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

  setPerfProbe: async (enabled) => {
    set({ perfProbe: enabled });
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

  setShowTrackNumbers: async (enabled) => {
    set({ showTrackNumbers: enabled });
    await persist(get());
  },

  setNotification: async (key, enabled) => {
    const notifications = { ...get().notifications, [key]: enabled };
    set({ notifications });
    await persist({ ...get(), notifications });
  },
}));

async function persist(state: Pick<AppSettingsStore, 'theme' | 'accentColour' | 'remoteLogging' | 'librarySyncDebug' | 'perfProbe' | 'backendLogs' | 'artworkBackground' | 'streamQuality' | 'playerMode' | 'showTrackNumbers' | 'notifications'>) {
  try {
    await SecureStore.setItemAsync(
      STORE_KEY,
      JSON.stringify({
        theme:             state.theme,
        accentColour:      state.accentColour,
        remoteLogging:     state.remoteLogging,
        librarySyncDebug:  state.librarySyncDebug,
        perfProbe:         state.perfProbe,
        backendLogs:       state.backendLogs,
        artworkBackground: state.artworkBackground,
        streamQuality:     state.streamQuality,
        playerMode:        state.playerMode,
        showTrackNumbers:  state.showTrackNumbers,
        notifications:     state.notifications,
      }),
    );
  } catch {}
}
