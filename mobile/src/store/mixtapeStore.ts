import { useEffect } from 'react';
import { AppState } from 'react-native';
import { HubConnectionState } from '@microsoft/signalr';
import { create } from 'zustand';
import * as mixtapesAPI from '../api/mixtapes';
import type { Mixtape } from '../api/mixtapes';
import { createMixtapesHubConnection, MIXTAPES_UPDATED } from '../api/mixtapesHub';
import { attachHubLogging, remoteLog } from '../api/remoteLogger';

interface MixtapeStore {
  mixtapes: Mixtape[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (name: string, description?: string) => Promise<Mixtape>;
  rename: (id: string, name: string, description?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addTrack: (id: string, filePath: string) => Promise<void>;
  removeTrack: (id: string, trackId: string) => Promise<void>;
  clearTracks: (id: string) => Promise<void>;
  reorderTracks: (id: string, trackIds: string[]) => Promise<void>;
  publish: (id: string) => Promise<void>;
  unpublish: (id: string) => Promise<void>;
}

export const useMixtapeStore = create<MixtapeStore>((set, get) => ({
  mixtapes: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const mixtapes = await mixtapesAPI.getAll();
      set({ mixtapes, isLoading: false });
    } catch (e: unknown) {
      set({ isLoading: false, error: (e as Error)?.message ?? 'Failed to load' });
    }
  },

  create: async (name, description) => {
    const mixtape = await mixtapesAPI.create(name, description);
    set((s) => ({ mixtapes: [mixtape, ...s.mixtapes] }));
    return mixtape;
  },

  rename: async (id, name, description) => {
    await mixtapesAPI.update(id, name, description);
    await get().load();
  },

  remove: async (id) => {
    await mixtapesAPI.remove(id);
    set((s) => ({ mixtapes: s.mixtapes.filter((m) => m.id !== id) }));
  },

  addTrack: async (id, filePath) => {
    await mixtapesAPI.addTrack(id, filePath);
    await get().load();
  },

  removeTrack: async (id, trackId) => {
    await mixtapesAPI.removeTrack(id, trackId);
    await get().load();
  },

  clearTracks: async (id) => {
    await mixtapesAPI.clearTracks(id);
    await get().load();
  },

  reorderTracks: async (id, trackIds) => {
    await mixtapesAPI.reorderTracks(id, trackIds);
    await get().load();
  },

  publish: async (id) => {
    await mixtapesAPI.publish(id);
    await get().load();
  },

  unpublish: async (id) => {
    await mixtapesAPI.unpublish(id);
    await get().load();
  },
}));

// Hook — mount once at the top of the authenticated app to keep mixtapes in sync
export const useMixtapesHub = () => {
  const load = useMixtapeStore((s) => s.load);

  useEffect(() => {
    const hub = createMixtapesHubConnection();
    if (!hub) return;

    attachHubLogging(hub, 'mixtapes');

    hub.on(MIXTAPES_UPDATED, () => { load(); });
    // Reload after reconnect to catch any events missed while disconnected
    hub.onreconnected(() => { load(); });
    const startPromise = hub.start().catch((err: unknown) => {
      remoteLog('error', `[hub:mixtapes] start failed — ${err instanceof Error ? err.message : String(err)}`);
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
  }, [load]);
};
