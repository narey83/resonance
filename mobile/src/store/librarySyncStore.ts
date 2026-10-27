// <copyright file="librarySyncStore.ts" company="John Narey">
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

import { create } from 'zustand';
import { onSessionReset, sessionGuard, getSessionScope } from '../lib/sessionScope';
import { useLibraryActivityStore } from './libraryActivityStore';
import { apiClient, getValidToken } from '../api/client';
import { writeListCache, readListCache, hasListCache, getListCacheETag } from '../services/libraryCache';
import { seedCoverSignatures, seedTrackSignatures } from '../api/musicLibrary';
import { dbg as rawDbg } from '../api/debugLog';
import { notePerfBlock } from '../lib/perfProbe';

// Hard upper bound per list request. axios's own timeout didn't reliably fire during the observed
// 80s stalls (requests queued in the native HTTP dispatcher), so we race each request against this
// wall-clock cap: a stalled list fails fast, keeps its cached copy, and retries on the next sync —
// instead of hanging the whole sync.
const REQUEST_CAP_MS = 20_000;

// libraryCache key holding the backend library version we last fully synced (see GET /version).
const VERSION_KEY = '__sync_version__';

// Floor between automatic (hub-driven) syncs — see the rate-limit note in sync(). Session-scoped
// rather than persisted: a fresh app start should always sync immediately.
const MIN_AUTO_SYNC_INTERVAL_MS = 3 * 60_000;
let lastAutoSyncAt = 0;
let activeRun: object | null = null;
type SyncRequest = { revision: number; force: boolean; tabs?: string[] };
let pending: SyncRequest | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const withCap = async <T>(p: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`cap ${REQUEST_CAP_MS}ms (${label})`)), REQUEST_CAP_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
// Logged at sync start (when the "Library sync debug" toggle is on) so the timeline in the backend
// logs is self-identifying. Bump when the sync logic changes.
const SYNC_BUILD = '2026-06-26-sortfix-v7';

const dbg = (msg: string) => rawDbg(`[sync] ${msg}`);

// One-shot bulk download of the whole library's METADATA into the on-device cache, with a single
// overall progress. Tabs then read purely from the cache (see useServerCachedList) — no per-tab
// network fetch. Updates are INCREMENTAL: each list is fetched with its stored ETag via
// If-None-Match, so a list that hasn't actually changed comes back 304 (~0 bytes) and we keep the
// cached copy. So re-syncs after a library change only transfer the lists that really changed.

type Status = 'idle' | 'syncing' | 'ready' | 'error';

 
interface Endpoint {
  label: string;
  key: string;                       // libraryCache key the slice readers use
  tab: string;                       // the library tab this list backs; skipped when that tab is hidden
  path: string;
  params?: Record<string, string | number>;
  // Transform a 200 body into the value to cache (and seed its signatures). Identity for most.
  toStore: (data: any) => unknown;
}

const ENDPOINTS: Endpoint[] = [
  { label: 'Artists', key: 'artists', tab: 'Artists', path: '/musiclibrary/artists',
    toStore: (d) => { seedCoverSignatures(d); return d; } },
  { label: 'Albums', key: 'albums', tab: 'Albums', path: '/musiclibrary/albums',
    toStore: (d) => { seedCoverSignatures(d); return d; } },
  { label: 'Folders', key: 'folders', tab: 'Folders', path: '/musiclibrary/folders',
    toStore: (d) => { seedCoverSignatures(d); return d; } },
  { label: 'Genres', key: 'genres', tab: 'Genres', path: '/musiclibrary/genres',
    toStore: (d) => d },
  { label: 'Years', key: 'years', tab: 'Years', path: '/musiclibrary/years',
    toStore: (d) => d },
  { label: 'Loved', key: 'loved', tab: 'Loved', path: '/musiclibrary/loved/tracks',
    toStore: (d) => { seedTrackSignatures(d); return d; } },
  { label: 'Tracks', key: 'tracks:first:artist:asc', tab: 'Tracks', path: '/musiclibrary/tracks',
    params: { limit: 50, offset: 0, sort: 'artist', descending: 'false' },
    toStore: (d) => { const r = { tracks: d.tracks, total: d.total }; seedTrackSignatures(r.tracks); return r; } },
];
 

interface LibrarySyncState {
  status: Status;
  completed: number;
  total: number;
  currentLabel: string;
  hasSyncedOnce: boolean;
  syncedRevision: number | null;
  cacheVersion: number;     // bumps after each endpoint is written, so slice readers re-read
  error: string | null;
  percent: number;          // 0-100 overall
  /** `tabs` limits the fetch to the lists actually on screen; omit to sync everything. */
  sync: (revision: number, force?: boolean, tabs?: string[]) => Promise<void>;
}

export const useLibrarySync = create<LibrarySyncState>((set, get) => ({
  status: 'idle',
  completed: 0,
  total: ENDPOINTS.length,
  currentLabel: '',
  hasSyncedOnce: false,
  syncedRevision: null,
  cacheVersion: 0,
  error: null,
  percent: 0,

  sync: async (revision, force = false, tabs) => {
    if (getSessionScope() === null) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (activeRun) {
      pending = { revision, force: force || (pending?.force ?? false), tabs };
      return;
    }
    const run = {};
    activeRun = run;
    const current = sessionGuard();
    try {
      const st = get();

      // Only the lists behind visible tabs. Hiding a tab used to save nothing: the list was still
      // downloaded, parsed and then held in memory for the life of the session. On a 47k-track
      // library that is most of a 400MB JS heap spent on screens the user can't reach — and a heap
      // that size is what makes a GC on resume stall the thread for seconds.
      const endpoints = tabs?.length ? ENDPOINTS.filter((e) => tabs.includes(e.tab)) : ENDPOINTS;
      if (endpoints.length === 0) { dbg('skip — no visible tabs need a server list'); return; }

      // A list with no on-device cache can't be served offline, so it overrides both gates below.
      // Checked against the persisted cache (not session state) so a cold start with a populated
      // cache can still reach the version gate instead of unconditionally forcing a full sync.
      const cacheChecks = await Promise.all(endpoints.map((e) => hasListCache(e.key)));
      if (!current()) return;
      const needsFirstFetch = cacheChecks.some((has) => !has);

      if (!force && !needsFirstFetch && st.hasSyncedOnce && st.syncedRevision === revision) {
        dbg(`skip — already fresh in-session for rev=${revision}`);
        return;
      }
      // Rate limit. The backend re-scans the whole library whenever files land on disk, so a run of
      // downloads produced a completed scan (and a revision bump) roughly once a minute — measured at
      // 48 in one hour against a baseline of 4. Every one of those that finds a changed list
      // re-downloads it, JSON.parses it and re-renders thousands of rows on the JS thread; the probe
      // caught 6.9s of a 10s window blocked, with a single 4s parse stall. Being a couple of minutes
      // behind on a library this size is worth far more than a tab that locks up whenever a download
      // finishes. `force` (an explicit user refresh) still bypasses this.
      if (!force && !needsFirstFetch && lastAutoSyncAt && Date.now() - lastAutoSyncAt < MIN_AUTO_SYNC_INTERVAL_MS) {
        const delay = MIN_AUTO_SYNC_INTERVAL_MS - (Date.now() - lastAutoSyncAt);
        dbg(`defer — rate limited; retrying in ${delay}ms`);
        const retry = () => {
          if (!current()) return;
          // A scan can start while the retry is waiting. Keep the old cache until it finishes.
          if (useLibraryActivityStore.getState().syncState?.running) {
            retryTimer = setTimeout(retry, 5_000);
            return;
          }
          retryTimer = null;
          void get().sync(revision, false, tabs);
        };
        retryTimer = setTimeout(retry, delay);
        return;
      }

      // Cheap gate: fetch the backend library version and skip the whole 7-endpoint sync when it
      // matches what we last synced (and we have a cache). So a cold start where nothing changed on
      // the backend costs ONE tiny request, not 7. Only a real backend change does the full sync.
      let version: string | undefined;
      try {
        version = (await apiClient.get('/musiclibrary/version')).data?.version;
      } catch { /* offline / error — fall through to the normal (cache + ETag) sync */ }

      if (!current()) return;
      if (!force && !needsFirstFetch && version) {
        const storedVersion = await readListCache<string>(VERSION_KEY);
        if (!current()) return;
        if (storedVersion === version) {
          dbg(`skip — backend version unchanged (${version})`);
          set({ status: 'ready', hasSyncedOnce: true, syncedRevision: revision, percent: 100 });
          return;
        }
        dbg(`version changed: stored=${storedVersion ?? 'none'} backend=${version} → syncing`);
      }

      const t0 = Date.now();
      // Stamped here, not at the version-gate skip above: a skip costs one tiny request and no
      // rendering, so it must not start the clock on the expensive path.
      lastAutoSyncAt = t0;
      dbg(`START build=${SYNC_BUILD} rev=${revision} force=${force} endpoints=${endpoints.length}/${ENDPOINTS.length}`);
      set({ status: 'syncing', total: endpoints.length, completed: 0, currentLabel: 'Library', error: null, percent: 0 });

      // Refresh the token ONCE up front so the parallel burst doesn't have 7 requests each hit 401 and
      // independently trigger a refresh (which serialized/stalled them). Best-effort.
      const tTok = Date.now();
      try { await getValidToken(); } catch { /* ignore — requests will still try */ }
      if (!current()) return;
      dbg(`token ready in ${Date.now() - tTok}ms`);

      const total = endpoints.length;
      let completed = 0;
      let failures = 0;

      // Fetch all lists in PARALLEL, each hard-capped so one network stall can't hang the whole sync.
      await Promise.all(endpoints.map(async (ep) => {
        const te = Date.now();
        let status = 0;
        let netMs = 0;
        let procMs = 0;
        let note = '';
        let changed = false;
        // The exact bytes the server sent, captured during parsing. When toStore is the identity (all
        // but Tracks) this IS the serialisation of what we cache, so the write can reuse it instead of
        // stringifying the whole list a second time.
        let rawBody: string | null = null;
        try {
          const etag = await getListCacheETag(ep.key);
          if (!current()) return;
          const tn = Date.now();
          const res = await withCap(apiClient.get(ep.path, {
            params: ep.params,
            headers: etag ? { 'If-None-Match': etag } : undefined,
            timeout: REQUEST_CAP_MS,
            validateStatus: (s) => s === 200 || s === 304, // 304 = unchanged, not an error
            // Same parse axios would do by default, but timed. These bodies are megabytes for a large
            // library and JSON.parse is synchronous, so this runs on the JS thread with every queued
            // touch behind it — and being inside axios, it was invisible to both the probe and the
            // netMs figure it hid inside.
            transformResponse: [(raw: unknown) => {
              if (typeof raw !== 'string' || raw.length === 0) return raw;
              rawBody = raw;
              const tParse = Date.now();
              try {
                const parsed = JSON.parse(raw);
                notePerfBlock(`parse:net:${ep.key}`, tParse);
                return parsed;
              } catch {
                return raw;
              }
            }],
          }), ep.label);
          if (!current()) return;
          netMs = Date.now() - tn;
          status = res.status;
          if (res.status !== 304) {
            const tp = Date.now();
            const tSeed = Date.now();
            const stored = ep.toStore(res.data);
            notePerfBlock(`seed:${ep.key}`, tSeed);
            // Identity transform ⇒ rawBody is already this value's JSON; anything else has to be
            // serialised (only Tracks, and only its first 50 rows).
            const raw = stored === res.data ? rawBody ?? undefined : undefined;
            await writeListCache(ep.key, stored, res.headers?.etag ?? res.headers?.ETag, raw);
            procMs = Date.now() - tp;
            changed = true;
          }
        } catch (e) {
          failures += 1;
          const err = e as { response?: { status?: number }; message?: string };
          status = err?.response?.status ?? -1;
          note = ` ERR ${err?.message ?? 'unknown'}`;
        }
        dbg(`${ep.label} status=${status} net=${netMs}ms proc=${procMs}ms total=${Date.now() - te}ms${note}`);

        if (!current()) return;
        completed += 1;
        // Only bump cacheVersion when the list actually changed (200) — a 304 leaves the cache
        // untouched, so re-reading/re-rendering the visible tab for it is pure waste.
        set((s) => ({
          completed,
          percent: Math.round((completed / total) * 100),
          cacheVersion: changed ? s.cacheVersion + 1 : s.cacheVersion,
        }));
      }));

      if (!current()) return;
      dbg(`DONE in ${Date.now() - t0}ms ok=${total - failures} failed=${failures}`);
      // Record the version we just synced so the next startup can skip the sync if it's unchanged.
      // Only on full success — a partial sync must re-check next time.
      if (!failures && version && endpoints.length === ENDPOINTS.length) {
        await writeListCache(VERSION_KEY, version);
      }

      if (!current()) return;
      set({
        status: failures ? 'error' : 'ready',
        hasSyncedOnce: true,
        // Only pin the revision on success, so a failed (e.g. offline) sync retries on the next visit.
        syncedRevision: failures ? get().syncedRevision : revision,
        currentLabel: '',
        error: failures ? `${failures} list(s) failed to download` : null,
      });
    } finally {
      // An old session's finally must not unlock or drain the new session's work.
      if (activeRun === run) {
        activeRun = null;
        const next = pending;
        pending = null;
        if (next && current()) void get().sync(next.revision, next.force, next.tabs);
      }
    }
  },
}));

onSessionReset(() => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  pending = null;
  activeRun = null;
  lastAutoSyncAt = 0;
  useLibrarySync.setState(useLibrarySync.getInitialState(), true);
});
