// <copyright file="transferStore.ts" company="John Narey">
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
import { shallowEqual } from '../lib/shallowEqual';
import { create } from 'zustand';
import * as api from '../api/transfers';
import type { Transfer, TransferDir } from '../api/transfers';

interface TransferStore {
  downloads: Transfer[];
  uploads: Transfer[];
  downloadsLoaded: boolean;
  uploadsLoaded: boolean;

  loadDownloads: () => Promise<void>;
  loadUploads: () => Promise<void>;
  /** `force` waits out any in-flight poll and re-reads — for refreshes that follow a user action. */
  refresh: (dir: TransferDir, force?: boolean) => Promise<void>;
  cancel: (dir: TransferDir, username: string, id: string, remove?: boolean) => Promise<void>;
  clearCompleted: (dir: TransferDir) => Promise<void>;
}

// Reuse existing Transfer objects for items that haven't changed so React.memo
// comparators can short-circuit without re-rendering unchanged rows.
function reconcile(prev: Transfer[], next: Transfer[]): Transfer[] {
  const prevById = new Map(prev.map(t => [t.id, t]));
  const result = next.map((item) => {
    const previous = prevById.get(item.id);
    return previous && shallowEqual(previous, item) ? previous : item;
  });
  return result.length === prev.length && result.every((item, index) => item === prev[index]) ? prev : result;
}

// One poll per direction at a time. The screen polls every 2s, but a response that took longer than
// that used to start another on top — measured at ten concurrent requests in flight, each carrying
// the full list, which saturated the connection pool and buried every other request in the app.
//
// Only the POLL is dropped, never a refresh that follows a user action: cancelling or clearing has
// to show its result, and silently skipping that refresh because a poll happened to be outstanding
// made the Clear button look broken.
const inFlight: Record<TransferDir, Promise<void> | null> = { download: null, upload: null };

export const useTransferStore = create<TransferStore>((set, get) => ({
  downloads: [],
  uploads: [],
  downloadsLoaded: false,
  uploadsLoaded: false,

  loadDownloads: () => get().refresh('download'),
  loadUploads: () => get().refresh('upload'),

  refresh: async (dir, force = false) => {
    const current = sessionGuard();
    const pending = inFlight[dir];
    if (pending) {
      // A user action must reflect reality, so wait the outstanding poll out and then re-read
      // rather than returning stale data. A plain poll just yields to the one already running.
      if (!force) return;
      await pending.catch(() => {});
      if (!current()) return;
    }

    const run = (async () => {
      try {
        const fresh = await api.getAll(dir);
        if (!current()) return;
        const prev = get();
        const previous = dir === 'download' ? prev.downloads : prev.uploads;
        const next = reconcile(previous, fresh);
        const loaded = dir === 'download' ? prev.downloadsLoaded : prev.uploadsLoaded;
        if (next === previous && loaded) return;
        set(dir === 'download'
          ? { downloads: next, downloadsLoaded: true }
          : { uploads: next, uploadsLoaded: true });
      } catch {
        /* keep the last good list; the next tick retries */
      }
    })();

    inFlight[dir] = run;
    try {
      await run;
    } finally {
      if (inFlight[dir] === run) inFlight[dir] = null;
    }
  },

  cancel: async (dir, username, id, remove = false) => {
    const current = sessionGuard();
    await api.cancelTransfer(dir, username, id, remove);
    if (!current()) return;
    await get().refresh(dir, true);
  },

  clearCompleted: async (dir) => {
    const current = sessionGuard();
    try {
      await api.clearCompleted(dir);
    } finally {
      // Refresh even when the request reported failure. The server keeps going after a client-side
      // abort, so the list on screen is stale either way — re-reading it is what tells the user
      // what actually happened.
      if (current()) await get().refresh(dir, true);
    }
  },
}));

onSessionReset(() => {
  inFlight.download = null;
  inFlight.upload = null;
  useTransferStore.setState(useTransferStore.getInitialState(), true);
});
