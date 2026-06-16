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
} from '../api/libraryActivityHub';
import { attachHubLogging, remoteLog } from '../api/remoteLogger';

interface LibraryActivityState {
  lovedPaths: Set<string>;
  playStats: Map<string, PlayStat>;
  recentPlays: PlayRecord[];   // SignalR-sourced, prepended in real-time
  historyVersion: number;       // bumped on delete/clear so HistoryTab can reload
  libraryRevision: number;      // bumped when a library sync adds/removes tracks

  applySnapshot: (snapshot: LibraryActivitySnapshot) => void;
  applyLoved: (path: string) => void;
  applyUnloved: (path: string) => void;
  applyAllUnloved: () => void;
  applyPlayed: (payload: { stat: PlayStat; record: PlayRecord }) => void;
  applyPlayDeleted: (id: string) => void;
  applyHistoryCleared: () => void;
  bumpLibraryRevision: (payload?: { removed?: number; removedPaths?: string[] | null }) => void;

  toggleLove: (path: string) => Promise<void>;
  clearAllLoved: () => Promise<void>;
  recordPlay: (path: string) => Promise<void>;
  deletePlay: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const useLibraryActivityStore = create<LibraryActivityState>((set, get) => ({
  lovedPaths: new Set(),
  playStats: new Map(),
  recentPlays: [],
  historyVersion: 0,
  libraryRevision: 0,

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

  recordPlay: async (path) => {
    try { await apiRecordPlay(path); } catch {}
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
  const store = useLibraryActivityStore();

  useEffect(() => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
