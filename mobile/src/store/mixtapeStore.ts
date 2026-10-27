// <copyright file="mixtapeStore.ts" company="John Narey">
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

import { onSessionReset, sessionGuard } from '../lib/sessionScope';
import { useEffect } from 'react';
import { create } from 'zustand';
import { maintainServerConnection } from '../lib/serverConnection';
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
    const current = sessionGuard();
    set({ isLoading: true, error: null });
    try {
      const mixtapes = await mixtapesAPI.getAll();
      if (!current()) return;
      set({ mixtapes, isLoading: false });
    } catch (e: unknown) {
      if (!current()) return;
      set({ isLoading: false, error: (e as Error)?.message ?? 'Failed to load' });
    }
  },

  create: async (name, description) => {
    const current = sessionGuard();
    const mixtape = await mixtapesAPI.create(name, description);
    if (!current()) throw new Error('Session changed');
    set((s) => ({ mixtapes: [mixtape, ...s.mixtapes] }));
    return mixtape;
  },

  rename: async (id, name, description) => {
    const current = sessionGuard();
    await mixtapesAPI.update(id, name, description);
    if (!current()) return;
    await get().load();
  },

  remove: async (id) => {
    const current = sessionGuard();
    await mixtapesAPI.remove(id);
    if (!current()) return;
    set((s) => ({ mixtapes: s.mixtapes.filter((m) => m.id !== id) }));
  },

  addTrack: async (id, filePath) => {
    const current = sessionGuard();
    await mixtapesAPI.addTrack(id, filePath);
    if (!current()) return;
    await get().load();
  },

  removeTrack: async (id, trackId) => {
    const current = sessionGuard();
    await mixtapesAPI.removeTrack(id, trackId);
    if (!current()) return;
    await get().load();
  },

  clearTracks: async (id) => {
    const current = sessionGuard();
    await mixtapesAPI.clearTracks(id);
    if (!current()) return;
    await get().load();
  },

  reorderTracks: async (id, trackIds) => {
    const current = sessionGuard();
    await mixtapesAPI.reorderTracks(id, trackIds);
    if (!current()) return;
    await get().load();
  },

  publish: async (id) => {
    const current = sessionGuard();
    await mixtapesAPI.publish(id);
    if (!current()) return;
    await get().load();
  },

  unpublish: async (id) => {
    const current = sessionGuard();
    await mixtapesAPI.unpublish(id);
    if (!current()) return;
    await get().load();
  },
}));

// Hook — mount once at the top of the authenticated app to keep mixtapes in sync
export const useMixtapesHub = () => {
  const load = useMixtapeStore((s) => s.load);

  useEffect(() => {
    const current = sessionGuard();
    const hub = createMixtapesHubConnection();
    if (!hub) return;

    attachHubLogging(hub, 'mixtapes');

    hub.on(MIXTAPES_UPDATED, () => { if (current()) void load(); });
    // Reload after reconnect to catch any events missed while disconnected
    hub.onreconnected(() => { if (current()) void load(); });
    return maintainServerConnection(hub, current, () => { void load(); }, (err) => {
      remoteLog('error', `[hub:playlists] start failed — ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [load]);
};

onSessionReset(() => {
  useMixtapeStore.setState(useMixtapeStore.getInitialState(), true);
});
