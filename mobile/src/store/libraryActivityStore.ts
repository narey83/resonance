// <copyright file="libraryActivityStore.ts" company="John Narey">
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

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { HubConnectionState } from '@microsoft/signalr';
import { create } from 'zustand';
import { evictArtwork } from '../services/artworkCache';
import {
  loveTrack as apiLoveTrack,
  unloveTrack as apiUnloveTrack,
  clearAllLoved as apiClearAllLoved,
  recordPlay as apiRecordPlay,
  deletePlay as apiDeletePlay,
  clearHistory as apiClearHistory,
  type PlayStat,
  type PlayRecord,
  type LibraryActivitySnapshot,
} from '../api/libraryActivity';
import type { MusicLibrarySyncState } from '../api/musicLibrary';
import {
  createLibraryActivityHubConnection,
  LIBRARY_ACTIVITY_SNAPSHOT,
  LIBRARY_ACTIVITY_LOVED,
  LIBRARY_ACTIVITY_UNLOVED,
  LIBRARY_ACTIVITY_ALL_UNLOVED,
  LIBRARY_ACTIVITY_PLAYED,
  LIBRARY_ACTIVITY_PLAY_DELETED,
  LIBRARY_ACTIVITY_HISTORY_CLEARED,
  LIBRARY_ACTIVITY_LIBRARY_UPDATED,
  LIBRARY_ACTIVITY_SYNC_STATE,
} from '../api/libraryActivityHub';
import { attachHubLogging, remoteLog } from '../api/remoteLogger';

interface LibraryActivityState {
  lovedPaths: Set<string>;
  playStats: Map<string, PlayStat>;
  recentPlays: PlayRecord[];   // SignalR-sourced, prepended in real-time
  historyVersion: number;       // bumped on delete/clear so HistoryTab can reload
  libraryRevision: number;      // bumped when a library sync adds/removes tracks
  syncState: MusicLibrarySyncState | null;  // server-side scan state, pushed via SYNC_STATE

  applySnapshot: (snapshot: LibraryActivitySnapshot) => void;
  applyLoved: (path: string) => void;
  applyUnloved: (path: string) => void;
  applyAllUnloved: () => void;
  applyPlayed: (payload: { stat: PlayStat; record: PlayRecord }) => void;
  applyPlayDeleted: (id: string) => void;
  applyHistoryCleared: () => void;
  bumpLibraryRevision: (payload?: { removed?: number; removedPaths?: string[] | null }) => void;
  applySyncState: (state: MusicLibrarySyncState) => void;

  toggleLove: (path: string) => Promise<void>;
  clearAllLoved: () => Promise<void>;
  recordPlay: (path: string, meta?: { title?: string; artist?: string; folder?: string; source?: string }) => Promise<void>;
  deletePlay: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const useLibraryActivityStore = create<LibraryActivityState>((set, get) => ({
  lovedPaths: new Set(),
  playStats: new Map(),
  recentPlays: [],
  historyVersion: 0,
  libraryRevision: 0,
  syncState: null,

  applySnapshot: ({ lovedPaths, playStats }) => {
    set({
      lovedPaths: new Set(lovedPaths),
      playStats: new Map(playStats.map((s) => [s.path, s])),
    });
  },

  applyLoved: (path) => {
    set((s) => ({ lovedPaths: new Set([...s.lovedPaths, path]) }));
  },

  applyUnloved: (path) => {
    set((s) => { const n = new Set(s.lovedPaths); n.delete(path); return { lovedPaths: n }; });
  },

  applyAllUnloved: () => {
    set({ lovedPaths: new Set() });
  },

  applyPlayed: ({ stat, record }) => {
    set((s) => ({
      playStats: new Map(s.playStats).set(stat.path, stat),
      recentPlays: s.recentPlays.some((r) => r.id === record.id)
        ? s.recentPlays
        : [record, ...s.recentPlays].slice(0, 200),
    }));
  },

  applyPlayDeleted: (id) => {
    set((s) => ({
      recentPlays: s.recentPlays.filter((r) => r.id !== id),
      historyVersion: s.historyVersion + 1,
    }));
  },

  applyHistoryCleared: () => {
    set((s) => ({ recentPlays: [], historyVersion: s.historyVersion + 1 }));
  },

  bumpLibraryRevision: (payload) => {
    if (payload?.removedPaths?.length) {
      evictArtwork(payload.removedPaths);
    }
    set((s) => ({ libraryRevision: s.libraryRevision + 1 }));
  },

  applySyncState: (state) => {
    set({ syncState: state });
  },

  toggleLove: async (path) => {
    const isLoved = get().lovedPaths.has(path);
    if (isLoved) get().applyUnloved(path); else get().applyLoved(path);
    try {
      if (isLoved) await apiUnloveTrack(path); else await apiLoveTrack(path);
    } catch {
      if (isLoved) get().applyLoved(path); else get().applyUnloved(path);
    }
  },

  clearAllLoved: async () => {
    get().applyAllUnloved();
    try { await apiClearAllLoved(); } catch {}
  },

  recordPlay: async (path, meta) => {
    try { await apiRecordPlay(path, meta); } catch {}
    // Hub broadcasts TRACK_PLAYED → applyPlayed handles state update
  },

  deletePlay: async (id) => {
    get().applyPlayDeleted(id);
    try { await apiDeletePlay(id); } catch {}
  },

  clearHistory: async () => {
    get().applyHistoryCleared();
    try { await apiClearHistory(); } catch {}
  },
}));

export const useLibraryActivityHub = () => {
  useEffect(() => {
    // getState(), not the hook: this runs in AuthenticatedApp, so subscribing to the whole store
    // re-rendered the entire app shell (tabs, overlay, bubble, banner) on every hub event —
    // every play, love, sync-state tick and library-revision bump. The actions are static.
    const store = useLibraryActivityStore.getState();

    const hub = createLibraryActivityHubConnection();
    if (!hub) return;

    attachHubLogging(hub, 'libraryActivity');

    hub.on(LIBRARY_ACTIVITY_SNAPSHOT,        store.applySnapshot);
    hub.on(LIBRARY_ACTIVITY_LOVED,           store.applyLoved);
    hub.on(LIBRARY_ACTIVITY_UNLOVED,         store.applyUnloved);
    hub.on(LIBRARY_ACTIVITY_ALL_UNLOVED,     store.applyAllUnloved);
    hub.on(LIBRARY_ACTIVITY_PLAYED,          store.applyPlayed);
    hub.on(LIBRARY_ACTIVITY_PLAY_DELETED,    store.applyPlayDeleted);
    hub.on(LIBRARY_ACTIVITY_HISTORY_CLEARED, store.applyHistoryCleared);
    hub.on(LIBRARY_ACTIVITY_LIBRARY_UPDATED, store.bumpLibraryRevision);
    hub.on(LIBRARY_ACTIVITY_SYNC_STATE,      store.applySyncState);

    const startPromise = hub.start().catch((err: unknown) => {
      remoteLog('error', `[hub:libraryActivity] start failed — ${err instanceof Error ? err.message : String(err)}`);
    });

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hub.state === HubConnectionState.Disconnected) {
        hub.start().catch(() => {});
      }
    });

    return () => {
      appStateSub.remove();
      startPromise.then(() => hub.stop().catch(() => {}));
    };
  }, []);
};
