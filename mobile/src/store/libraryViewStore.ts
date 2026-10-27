// <copyright file="libraryViewStore.ts" company="John Narey">
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
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

// How a library tab lays out its items: the original one-per-row list, or a grid of artwork
// tiles in one of three sizes. Chosen per tab — tiles suit albums, a list may suit artists.
export type LibraryViewMode = 'list' | 'small' | 'medium' | 'large';

export type TileTab = 'Artists' | 'Albums' | 'Folders' | 'Playlists';

const STORE_KEY = 'library_view_modes_v1';
const MODES: LibraryViewMode[] = ['list', 'small', 'medium', 'large'];

interface LibraryViewStore {
  modes: Partial<Record<TileTab, LibraryViewMode>>;
  loaded: boolean;
  load: () => Promise<void>;
  setMode: (tab: TileTab, mode: LibraryViewMode) => void;
}

export const useLibraryViewStore = create<LibraryViewStore>((set, get) => ({
  modes: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(STORE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      // Preserve layout choices saved under the previous display name.
      if (!parsed.Playlists && parsed.Mixtapes) parsed.Playlists = parsed.Mixtapes;
      delete parsed.Mixtapes;
      // Drop anything unrecognised so a stale or hand-edited value can't break the layout.
      const modes = Object.fromEntries(
        Object.entries(parsed).filter(([, m]) => MODES.includes(m as LibraryViewMode)),
      ) as LibraryViewStore['modes'];
      // A choice made before the load finished wins over what was on disk.
      set((state) => ({ modes: { ...modes, ...state.modes }, loaded: true }));
    } catch {
      set({ loaded: true });
    }
  },

  setMode: (tab, mode) => {
    set((state) => ({ modes: { ...state.modes, [tab]: mode } }));
    SecureStore.setItemAsync(STORE_KEY, JSON.stringify(get().modes)).catch(() => {});
  },
}));

/** The view mode for `tab` (list until the user picks otherwise), loading saved choices on first use. */
export const useLibraryViewMode = (tab: TileTab): [LibraryViewMode, (mode: LibraryViewMode) => void] => {
  const mode = useLibraryViewStore((state) => state.modes[tab] ?? 'list');
  const setMode = useLibraryViewStore((state) => state.setMode);
  const load = useLibraryViewStore((state) => state.load);
  useEffect(() => { load(); }, [load]);
  return [mode, useCallback((next: LibraryViewMode) => setMode(tab, next), [setMode, tab])];
};
