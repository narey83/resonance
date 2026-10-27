// <copyright file="analysisProgressStore.ts" company="John Narey">
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

import { onSessionReset, sessionGuard, getSessionScope } from '../lib/sessionScope';
import { create } from 'zustand';
import { getScanState } from '../api/musicLibrary';
import { useLibraryActivityStore } from './libraryActivityStore';

// The server doesn't push scan progress, so while a scan runs its status is polled -- the same
// thing the web Analysis page does.
const POLL_MS = 2000;
const RETRY_MS = 5000;
const MAX_FAILURES = 6;
// Straight after the phone starts a scan the server can still be reporting the previous run as
// finished, so "not scanning" isn't taken as the end until the new one has had time to start.
const START_GRACE_MS = 4000;

export type TrackAnalysisStatus = 'queued' | 'analysing';

interface AnalysisProgressState {
  /** Tracks this phone asked to analyse that haven't finished yet. */
  queued: ReadonlySet<string>;
  /** Tracks the server is decoding right now, from any scan -- the web's and automatic ones too. */
  inFlight: ReadonlySet<string>;
  scanning: boolean;
  done: number;
  total: number;
  /** Records tracks the phone has just queued, and starts following the scan. */
  markQueued: (paths: string[]) => void;
  /** Checks whether a scan is running, and follows it if so. Cheap to call repeatedly. */
  refresh: () => void;
}

const EMPTY: ReadonlySet<string> = new Set();

let polling = false;
let graceUntil = 0;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useAnalysisProgress = create<AnalysisProgressState>((set, get) => {
  const stop = () => {
    polling = false;
    failures = 0;
  };

  const poll = async (): Promise<void> => {
    const current = sessionGuard();
    if (getSessionScope() === null) { stop(); return; }
    try {
      const state = await getScanState();
      if (!current()) return;
      failures = 0;
      const inFlight = new Set(state.inFlightPaths ?? []);

      if (state.scanning || Date.now() < graceUntil) {
        // A queued track that was being decoded at the last check and no longer is has finished.
        // One decoded entirely between two checks stays queued until the scan ends.
        const previous = get();
        const queued = new Set([...previous.queued].filter((p) => inFlight.has(p) || !previous.inFlight.has(p)));
        set({
          queued, inFlight, scanning: state.scanning,
          done: state.analysed + state.skipped + state.failed, total: state.total,
        });
        timer = setTimeout(poll, POLL_MS);
        return;
      }

      set({ queued: EMPTY, inFlight: EMPTY, scanning: false, done: 0, total: 0 });
      stop();
    } catch {
      if (!current()) return;
      failures += 1;
      if (failures >= MAX_FAILURES) {
        // Can't reach the server; drop the indicators rather than leave them spinning forever.
        set({ queued: EMPTY, inFlight: EMPTY, scanning: false });
        stop();
        return;
      }
      timer = setTimeout(poll, RETRY_MS);
    }
  };

  return {
    queued: EMPTY,
    inFlight: EMPTY,
    scanning: false,
    done: 0,
    total: 0,
    markQueued: (paths) => {
      set((s) => ({ queued: new Set([...s.queued, ...paths]) }));
      graceUntil = Date.now() + START_GRACE_MS;
      get().refresh();
    },
    refresh: () => {
      if (polling) return;
      polling = true;
      poll();
    },
  };
});

// LIBRARY_UPDATED is the only sign of a scan started elsewhere (the web, or the automatic
// analysis of new downloads): scans broadcast it as tracks finish. Each one checks for a scan.
useLibraryActivityStore.subscribe((state, previous) => {
  if (getSessionScope() !== null && state.libraryRevision !== previous.libraryRevision) useAnalysisProgress.getState().refresh();
});

/** Whether a track is waiting to be analysed or being analysed right now; null otherwise. */
export const useTrackAnalysisStatus = (path: string | null | undefined): TrackAnalysisStatus | null =>
  useAnalysisProgress((s) => {
    if (!path) return null;
    if (s.inFlight.has(path)) return 'analysing';
    return s.queued.has(path) ? 'queued' : null;
  });

onSessionReset(() => {
  if (timer) clearTimeout(timer);
  timer = null;
  polling = false;
  graceUntil = 0;
  failures = 0;
  useAnalysisProgress.setState(useAnalysisProgress.getInitialState(), true);
});
