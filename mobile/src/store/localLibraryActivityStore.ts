// <copyright file="localLibraryActivityStore.ts" company="John Narey">
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

// Local-only counterpart to libraryActivityStore.ts. Loved/History for on-device tracks never
// leaves the phone — a local file:// path means nothing to the server — so this reads/writes the
// local_loved/local_play_history tables in metadataDb.ts instead of calling the server API. Kept
// permanently separate from the server store, even when "Merge with Server Library" is on.

import { create } from 'zustand';
import {
  getLocalLovedPaths, addLocalLoved, removeLocalLoved, clearLocalLoved,
  getLocalPlayHistory, addLocalPlay, removeLocalPlay, clearLocalPlayHistory,
} from '../services/metadataDb';
import type { PlayRecord } from '../api/libraryActivity';

function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface LocalLibraryActivityState {
  loaded: boolean;
  lovedPaths: Set<string>;
  recentPlays: PlayRecord[];

  load: () => Promise<void>;
  toggleLove: (path: string) => Promise<void>;
  clearAllLoved: () => Promise<void>;
  recordPlay: (path: string, meta?: { title?: string | null; artist?: string | null; folder?: string | null }) => Promise<void>;
  deletePlay: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

const toPlayRecord = (e: { id: string; path: string; playedAt: number; title: string | null; artist: string | null; folder: string | null }): PlayRecord => ({
  id: e.id, path: e.path, playedAt: e.playedAt,
  title: e.title ?? '', artist: e.artist ?? '', folder: e.folder ?? '', source: 'local',
});

export const useLocalLibraryActivityStore = create<LocalLibraryActivityState>((set, get) => ({
  loaded: false,
  lovedPaths: new Set(),
  recentPlays: [],

  load: async () => {
    if (get().loaded) return;
    const [paths, history] = await Promise.all([getLocalLovedPaths(), getLocalPlayHistory()]);
    set({ loaded: true, lovedPaths: new Set(paths), recentPlays: history.map(toPlayRecord) });
  },

  toggleLove: async (path) => {
    const isLoved = get().lovedPaths.has(path);
    set((s) => {
      const n = new Set(s.lovedPaths);
      if (isLoved) n.delete(path); else n.add(path);
      return { lovedPaths: n };
    });
    if (isLoved) await removeLocalLoved(path); else await addLocalLoved(path);
  },

  clearAllLoved: async () => {
    set({ lovedPaths: new Set() });
    await clearLocalLoved();
  },

  recordPlay: async (path, meta) => {
    const entry = {
      id: randomId(), path, playedAt: Date.now(),
      title: meta?.title ?? null, artist: meta?.artist ?? null, folder: meta?.folder ?? null,
    };
    set((s) => ({ recentPlays: [toPlayRecord(entry), ...s.recentPlays].slice(0, 500) }));
    await addLocalPlay(entry);
  },

  deletePlay: async (id) => {
    set((s) => ({ recentPlays: s.recentPlays.filter((r) => r.id !== id) }));
    await removeLocalPlay(id);
  },

  clearHistory: async () => {
    set({ recentPlays: [] });
    await clearLocalPlayHistory();
  },
}));
