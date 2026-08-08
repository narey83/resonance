// <copyright file="librarySettingsStore.ts" company="John Narey">
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

export type LibraryTab = 'Artists' | 'Albums' | 'Tracks' | 'Folders' | 'Genres' | 'Years' | 'Mixtapes' | 'Loved' | 'History';

export const ALL_TABS: LibraryTab[] = ['Artists', 'Albums', 'Tracks', 'Folders', 'Genres', 'Years', 'Mixtapes', 'Loved', 'History'];
const DEFAULT_TABS: LibraryTab[] = ['Artists', 'Albums', 'Tracks', 'Folders', 'Genres', 'Years', 'Mixtapes', 'Loved', 'History'];
// Mixtapes are entirely server-backed (no local variant — a mixtape lives on the server whether
// or not any of its tracks happen to be local files), so it's not a real option for Local Library.
export const LOCAL_TABS: LibraryTab[] = ALL_TABS.filter((t) => t !== 'Mixtapes');
const LOCAL_DEFAULT_TABS: LibraryTab[] = DEFAULT_TABS.filter((t) => t !== 'Mixtapes');
const STORE_KEY = 'library_settings_v1';
// Bumped when a new tab is introduced so settings saved before it existed pick it up
const SETTINGS_VERSION = 2;

type TabSource = 'server' | 'local';

interface LibrarySettingsStore {
  visibleTabsServer: LibraryTab[];
  visibleTabsLocal: LibraryTab[];
  includeLocalLibrary: boolean;
  mergeLocalAndServer: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setVisibleTabs: (tabs: LibraryTab[], source: TabSource) => Promise<void>;
  setIncludeLocalLibrary: (include: boolean) => Promise<void>;
  setMergeLocalAndServer: (merge: boolean) => Promise<void>;
}

function sanitizeTabs(tabs: string[] | undefined, allowed: LibraryTab[], fallback: LibraryTab[]): LibraryTab[] {
  // Migrate: 'Playlists' was renamed to 'Mixtapes'; keep only known-and-allowed tabs, canonically
  // sorted. `allowed` also strips anything that's since become source-inapplicable (e.g. Mixtapes
  // for local) even out of an old persisted list that predates that restriction.
  const mapped = (tabs ?? fallback).map((t) => t === 'Playlists' ? 'Mixtapes' : t);
  const sorted = (mapped as LibraryTab[])
    .filter((t) => allowed.includes(t))
    .sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
  return sorted.length ? sorted : fallback;
}

export const useLibrarySettings = create<LibrarySettingsStore>((set, get) => ({
  visibleTabsServer: DEFAULT_TABS,
  visibleTabsLocal: LOCAL_DEFAULT_TABS,
  includeLocalLibrary: false,
  mergeLocalAndServer: false,
  loaded: false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          visibleTabs?: string[];
          visibleTabsServer?: string[];
          visibleTabsLocal?: string[];
          version?: number;
          includeLocalLibrary?: boolean;
          mergeLocalAndServer?: boolean;
        };
        // Migrate: 'Albums' tab was re-added; surface it for settings saved before it existed
        const legacy = (parsed.version ?? 1) < 2 && parsed.visibleTabs && !parsed.visibleTabs.includes('Albums')
          ? [...parsed.visibleTabs, 'Albums']
          : parsed.visibleTabs;
        // Pre-split settings had one shared list; seed both sources from it once
        set({
          visibleTabsServer: sanitizeTabs(parsed.visibleTabsServer ?? legacy, ALL_TABS, DEFAULT_TABS),
          visibleTabsLocal: sanitizeTabs(parsed.visibleTabsLocal ?? legacy, LOCAL_TABS, LOCAL_DEFAULT_TABS),
          includeLocalLibrary: parsed.includeLocalLibrary ?? false,
          // Merging local and server library views is retired — force off even if a device
          // has an old settings blob on disk with it saved as true.
          mergeLocalAndServer: false,
          loaded: true,
        });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  setVisibleTabs: async (tabs, source) => {
    const key = source === 'local' ? 'visibleTabsLocal' : 'visibleTabsServer';
    set({ [key]: tabs } as Partial<LibrarySettingsStore>);
    const { visibleTabsServer, visibleTabsLocal, includeLocalLibrary, mergeLocalAndServer } = get();
    try {
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({
        visibleTabsServer,
        visibleTabsLocal,
        version: SETTINGS_VERSION,
        includeLocalLibrary,
        mergeLocalAndServer,
      }));
    } catch {}
  },

  setIncludeLocalLibrary: async (include) => {
    set({ includeLocalLibrary: include });
    const { visibleTabsServer, visibleTabsLocal, mergeLocalAndServer } = get();
    try {
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({
        visibleTabsServer,
        visibleTabsLocal,
        version: SETTINGS_VERSION,
        includeLocalLibrary: include,
        mergeLocalAndServer,
      }));
    } catch {}
  },

  setMergeLocalAndServer: async (merge) => {
    set({ mergeLocalAndServer: merge });
    const { visibleTabsServer, visibleTabsLocal, includeLocalLibrary } = get();
    try {
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({
        visibleTabsServer,
        visibleTabsLocal,
        version: SETTINGS_VERSION,
        includeLocalLibrary,
        mergeLocalAndServer: merge,
      }));
    } catch {}
  },
}));
