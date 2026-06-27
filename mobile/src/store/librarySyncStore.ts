import { create } from 'zustand';
import { apiClient, getValidToken } from '../api/client';
import { writeListCache, readListCache, hasListCache, getListCacheETag } from '../services/libraryCache';
import { seedCoverSignatures, seedTrackSignatures } from '../api/musicLibrary';
import { dbg as rawDbg } from '../api/debugLog';

// Hard upper bound per list request. axios's own timeout didn't reliably fire during the observed
// 80s stalls (requests queued in the native HTTP dispatcher), so we race each request against this
// wall-clock cap: a stalled list fails fast, keeps its cached copy, and retries on the next sync —
// instead of hanging the whole sync.
const REQUEST_CAP_MS = 20_000;

// libraryCache key holding the backend library version we last fully synced (see GET /version).
const VERSION_KEY = '__sync_version__';

const withCap = <T>(p: Promise<T>, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`cap ${REQUEST_CAP_MS}ms (${label})`)), REQUEST_CAP_MS)),
  ]);
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
  path: string;
  params?: Record<string, string | number>;
  // Transform a 200 body into the value to cache (and seed its signatures). Identity for most.
  toStore: (data: any) => unknown;
}

const ENDPOINTS: Endpoint[] = [
  { label: 'Artists', key: 'artists', path: '/musiclibrary/artists',
    toStore: (d) => { seedCoverSignatures(d); return d; } },
  { label: 'Albums', key: 'albums', path: '/musiclibrary/albums',
    toStore: (d) => { seedCoverSignatures(d); return d; } },
  { label: 'Folders', key: 'folders', path: '/musiclibrary/folders',
    toStore: (d) => { seedCoverSignatures(d); return d; } },
  { label: 'Genres', key: 'genres', path: '/musiclibrary/genres',
    toStore: (d) => d },
  { label: 'Years', key: 'years', path: '/musiclibrary/years',
    toStore: (d) => d },
  { label: 'Loved', key: 'loved', path: '/musiclibrary/loved/tracks',
    toStore: (d) => { seedTrackSignatures(d); return d; } },
  { label: 'Tracks', key: 'tracks:first:artist:asc', path: '/musiclibrary/tracks',
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
  sync: (revision: number, force?: boolean) => Promise<void>;
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

  sync: async (revision, force = false) => {
    const st = get();
    if (st.status === 'syncing') { dbg('skip — already syncing'); return; }
    if (!force && st.hasSyncedOnce && st.syncedRevision === revision) {
      dbg(`skip — already fresh in-session for rev=${revision}`);
      return;
    }

    // Cheap gate: fetch the backend library version and skip the whole 7-endpoint sync when it
    // matches what we last synced (and we have a cache). So a cold start where nothing changed on
    // the backend costs ONE tiny request, not 7. Only a real backend change does the full sync.
    let version: string | undefined;
    try {
      version = (await apiClient.get('/musiclibrary/version')).data?.version;
    } catch { /* offline / error — fall through to the normal (cache + ETag) sync */ }

    if (!force && version) {
      const storedVersion = await readListCache<string>(VERSION_KEY);
      if (storedVersion === version && (await hasListCache('artists'))) {
        dbg(`skip — backend version unchanged (${version})`);
        set({ status: 'ready', hasSyncedOnce: true, syncedRevision: revision, percent: 100 });
        return;
      }
      dbg(`version changed: stored=${storedVersion ?? 'none'} backend=${version} → syncing`);
    }

    const t0 = Date.now();
    dbg(`START build=${SYNC_BUILD} rev=${revision} force=${force} endpoints=${ENDPOINTS.length}`);
    set({ status: 'syncing', completed: 0, currentLabel: 'Library', error: null, percent: 0 });

    // Refresh the token ONCE up front so the parallel burst doesn't have 7 requests each hit 401 and
    // independently trigger a refresh (which serialized/stalled them). Best-effort.
    const tTok = Date.now();
    try { await getValidToken(); } catch { /* ignore — requests will still try */ }
    dbg(`token ready in ${Date.now() - tTok}ms`);

    const total = ENDPOINTS.length;
    let completed = 0;
    let failures = 0;

    // Fetch all lists in PARALLEL, each hard-capped so one network stall can't hang the whole sync.
    await Promise.all(ENDPOINTS.map(async (ep) => {
      const te = Date.now();
      let status = 0;
      let netMs = 0;
      let procMs = 0;
      let note = '';
      let changed = false;
      try {
        const etag = await getListCacheETag(ep.key);
        const tn = Date.now();
        const res = await withCap(apiClient.get(ep.path, {
          params: ep.params,
          headers: etag ? { 'If-None-Match': etag } : undefined,
          timeout: REQUEST_CAP_MS,
          validateStatus: (s) => s === 200 || s === 304, // 304 = unchanged, not an error
        }), ep.label);
        netMs = Date.now() - tn;
        status = res.status;
        if (res.status !== 304) {
          const tp = Date.now();
          const stored = ep.toStore(res.data);
          await writeListCache(ep.key, stored, res.headers?.etag ?? res.headers?.ETag);
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

      completed += 1;
      // Only bump cacheVersion when the list actually changed (200) — a 304 leaves the cache
      // untouched, so re-reading/re-rendering the visible tab for it is pure waste.
      set((s) => ({
        completed,
        percent: Math.round((completed / total) * 100),
        cacheVersion: changed ? s.cacheVersion + 1 : s.cacheVersion,
      }));
    }));

    dbg(`DONE in ${Date.now() - t0}ms ok=${total - failures} failed=${failures}`);
    // Record the version we just synced so the next startup can skip the sync if it's unchanged.
    // Only on full success — a partial sync must re-check next time.
    if (!failures && version) {
      await writeListCache(VERSION_KEY, version);
    }

    set({
      status: failures ? 'error' : 'ready',
      hasSyncedOnce: true,
      // Only pin the revision on success, so a failed (e.g. offline) sync retries on the next visit.
      syncedRevision: failures ? get().syncedRevision : revision,
      currentLabel: '',
      error: failures ? `${failures} list(s) failed to download` : null,
    });
  },
}));
