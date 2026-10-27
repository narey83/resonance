// <copyright file="libraryCache.ts" company="John Narey">
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

import { InteractionManager } from 'react-native';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { notePerfBlock } from '../lib/perfProbe';
import { getSessionScope, onSessionReset } from '../lib/sessionScope';

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
// Bumped by clearListCache. Deferred disk writes check it before landing, so a sync in flight
// during a logout or server change can't resurrect the previous account's library afterwards.
let generation = 0;
// Decompressed JSON byte length of the last payload per key. Used as the "expected total" for a
// download progress %, since gzipped responses are chunked (no Content-Length to measure against).
const memBytes = new Map<string, number>();
// Last ETag per key, for conditional (If-None-Match) requests → incremental updates.
const memEtag = new Map<string, string>();

// Legacy unscoped rows are deliberately never read: their owner cannot be established.
const scopedKey = (key: string): string | null => {
  const scope = getSessionScope();
  return scope === null ? null : `${scope}:${key}`;
};

onSessionReset(() => {
  generation += 1;
  mem.clear();
  memBytes.clear();
  memEtag.clear();
});

/** Synchronous read of the in-memory layer only (undefined if not loaded this session yet). */
export function peekListCache<T>(key: string): T | undefined {
  const scoped = scopedKey(key);
  return scoped === null ? undefined : mem.get(scoped) as T | undefined;
}

/** Last known payload size (bytes) for a key, for download-progress estimation. */
export function peekListCacheBytes(key: string): number | undefined {
  const scoped = scopedKey(key);
  return scoped === null ? undefined : memBytes.get(scoped);
}

/** Cheap existence check (no data parse) — used to skip the first-sync overlay on restart. */
export async function hasListCache(key: string): Promise<boolean> {
  const scoped = scopedKey(key);
  if (scoped === null) return false;
  key = scoped;
  const started = generation;
  if (mem.has(key)) return true;
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ one: number }>('SELECT 1 AS one FROM list_cache WHERE key = ?', key);
    return started === generation && !!row;
  } catch {
    return false;
  }
}

/** Last ETag for a key (memory, falling back to disk), for conditional requests. */
export async function getListCacheETag(key: string): Promise<string | undefined> {
  const scoped = scopedKey(key);
  if (scoped === null) return undefined;
  key = scoped;
  const started = generation;
  if (memEtag.has(key)) return memEtag.get(key);
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ etag: string | null }>(
      'SELECT etag FROM list_cache WHERE key = ?',
      key,
    );
    if (started !== generation) return undefined;
    if (row?.etag) { memEtag.set(key, row.etag); return row.etag; }
  } catch { /* ignore */ }
  return undefined;
}

/** Read from memory, falling back to the SQLite blob (which then warms the memory layer). */
export async function readListCache<T>(key: string): Promise<T | undefined> {
  const scoped = scopedKey(key);
  if (scoped === null) return undefined;
  key = scoped;
  const started = generation;
  if (mem.has(key)) {
    return mem.get(key) as T;
  }

  try {
    const d = await db();
    const row = await d.getFirstAsync<{ data: string; etag: string | null }>(
      'SELECT data, etag FROM list_cache WHERE key = ?',
      key,
    );
    if (started !== generation || !row) {
      return undefined;
    }

    // These blobs are megabytes for a large library and JSON.parse is synchronous, so this single
    // call can hold the JS thread — and therefore every queued touch — for seconds.
    const tParse = Date.now();
    const parsed = JSON.parse(row.data) as T;
    notePerfBlock(`parse:${key}`, tParse);
    mem.set(key, parsed);
    memBytes.set(key, row.data.length);
    if (row.etag) memEtag.set(key, row.etag);
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Write through both layers. SQLite persist is best-effort and never throws to the caller.
 *
 * Pass `rawJson` when the caller already holds the exact serialisation of `data` — a response body
 * straight off the wire. Re-stringifying a multi-megabyte list that axios only just parsed is a
 * second synchronous pass over the whole thing, for a string we were already handed.
 *
 * The disk write is deliberately NOT awaited by the in-memory path: readers are served from `mem`,
 * which is populated synchronously here, so persistence is pure catch-up for the next cold start.
 * Deferring it past any in-flight touch handling keeps a library sync off the interaction path —
 * this runs on resume, exactly when taps are queued up waiting.
 */
export async function writeListCache<T>(key: string, data: T, etag?: string, rawJson?: string): Promise<void> {
  const scoped = scopedKey(key);
  if (scoped === null) return ;
  key = scoped;
  const started = generation;
  mem.set(key, data);
  let json = rawJson;
  if (json === undefined) {
    const tStringify = Date.now();
    json = JSON.stringify(data);
    notePerfBlock(`stringify:${key}`, tStringify);
  }
  const body = json;
  memBytes.set(key, body.length);
  if (etag) memEtag.set(key, etag);

  const writtenAtGeneration = started;
  InteractionManager.runAfterInteractions(() => {
    void (async () => {
      if (writtenAtGeneration !== generation) return; // cleared while we waited
      try {
        const d = await db();
        if (writtenAtGeneration !== generation) return;
        await d.runAsync(
          'INSERT INTO list_cache (key, data, etag, updated_at) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET data = excluded.data, etag = excluded.etag, updated_at = excluded.updated_at',
          key,
          body,
          etag ?? null,
          Date.now(),
        );
      } catch {
        /* best-effort — the ETag revalidates it next sync */
      }
    })();
  });
}

/** Drop everything (e.g. on logout / server change). */
export async function clearListCache(): Promise<void> {
  const scope = getSessionScope();
  generation += 1;
  mem.clear();
  memBytes.clear();
  memEtag.clear();
  if (scope === null) return;
  try {
    const d = await db();
    const prefix = `${scope}:`;
    await d.runAsync('DELETE FROM list_cache WHERE substr(key, 1, ?) = ?', prefix.length, prefix);
  } catch {
    /* best-effort */
  }
}
