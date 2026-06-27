import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

// Persistent stale-while-revalidate cache for the server library list endpoints (artists,
// albums, tracks, folders, genres, years, loved). These lists are large (artists/albums are
// thousands of rows) and were re-fetched over the network on every tab open, which is the main
// source of the "library is slow to load" UX. We cache the last server response on-device so a
// tab can paint instantly from cache, then revalidate against the server in the background and
// wholesale-replace the data — so backend updates/deletes reconcile on the very next fetch and
// the cache is never treated as the source of truth.
//
// Two layers:
//   • in-memory Map  — so switching tabs within a session never re-reads or re-parses from disk.
//   • SQLite blob    — so a cold app start still paints instantly from the last known data.

let _db: Promise<SQLiteDatabase> | null = null;

function db(): Promise<SQLiteDatabase> {
  if (!_db) {
    _db = (async () => {
      const d = await openDatabaseAsync('resonance_library_cache.db');
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS list_cache (
          key        TEXT PRIMARY KEY,
          data       TEXT NOT NULL,
          etag       TEXT,
          updated_at INTEGER NOT NULL
        );
      `);
      // Migration for caches created before the etag column existed.
      try { await d.execAsync('ALTER TABLE list_cache ADD COLUMN etag TEXT'); } catch { /* exists */ }
      return d;
    })();
  }
  return _db;
}

const mem = new Map<string, unknown>();
// Decompressed JSON byte length of the last payload per key. Used as the "expected total" for a
// download progress %, since gzipped responses are chunked (no Content-Length to measure against).
const memBytes = new Map<string, number>();
// Last ETag per key, for conditional (If-None-Match) requests → incremental updates.
const memEtag = new Map<string, string>();

/** Synchronous read of the in-memory layer only (undefined if not loaded this session yet). */
export function peekListCache<T>(key: string): T | undefined {
  return mem.get(key) as T | undefined;
}

/** Last known payload size (bytes) for a key, for download-progress estimation. */
export function peekListCacheBytes(key: string): number | undefined {
  return memBytes.get(key);
}

/** Cheap existence check (no data parse) — used to skip the first-sync overlay on restart. */
export async function hasListCache(key: string): Promise<boolean> {
  if (mem.has(key)) return true;
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ one: number }>('SELECT 1 AS one FROM list_cache WHERE key = ?', key);
    return !!row;
  } catch {
    return false;
  }
}

/** Last ETag for a key (memory, falling back to disk), for conditional requests. */
export async function getListCacheETag(key: string): Promise<string | undefined> {
  if (memEtag.has(key)) return memEtag.get(key);
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ etag: string | null }>(
      'SELECT etag FROM list_cache WHERE key = ?',
      key,
    );
    if (row?.etag) { memEtag.set(key, row.etag); return row.etag; }
  } catch { /* ignore */ }
  return undefined;
}

/** Read from memory, falling back to the SQLite blob (which then warms the memory layer). */
export async function readListCache<T>(key: string): Promise<T | undefined> {
  if (mem.has(key)) {
    return mem.get(key) as T;
  }

  try {
    const d = await db();
    const row = await d.getFirstAsync<{ data: string; etag: string | null }>(
      'SELECT data, etag FROM list_cache WHERE key = ?',
      key,
    );
    if (!row) {
      return undefined;
    }

    const parsed = JSON.parse(row.data) as T;
    mem.set(key, parsed);
    memBytes.set(key, row.data.length);
    if (row.etag) memEtag.set(key, row.etag);
    return parsed;
  } catch {
    return undefined;
  }
}

/** Write through both layers. SQLite persist is best-effort and never throws to the caller. */
export async function writeListCache<T>(key: string, data: T, etag?: string): Promise<void> {
  mem.set(key, data);
  const json = JSON.stringify(data);
  memBytes.set(key, json.length);
  if (etag) memEtag.set(key, etag);
  try {
    const d = await db();
    await d.runAsync(
      'INSERT INTO list_cache (key, data, etag, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET data = excluded.data, etag = excluded.etag, updated_at = excluded.updated_at',
      key,
      json,
      etag ?? null,
      Date.now(),
    );
  } catch {
    /* best-effort */
  }
}

/** Drop everything (e.g. on logout / server change). */
export async function clearListCache(): Promise<void> {
  mem.clear();
  memBytes.clear();
  memEtag.clear();
  try {
    const d = await db();
    await d.execAsync('DELETE FROM list_cache');
  } catch {
    /* best-effort */
  }
}
