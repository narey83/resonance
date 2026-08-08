// <copyright file="metadataDb.ts" company="John Narey">
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

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { File, Directory, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';

export interface TrackMetadata {
  path: string;
  source: 'local' | 'server';
  title: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  duration: number | null;
  bpm: number | null;
  musicalKey: string | null;
  fileSize: number | null;
  hasArtwork: boolean;
  artworkPath: string | null;
  fileMtime: number | null;
  cachedAt: number;
}

const artworkDirectory = () => new Directory(Paths.cache, 'resonance_artwork');

// Bump this whenever the local scanning logic changes in a way that
// requires previously-cached entries to be re-scanned from scratch.
const LOCAL_SCAN_VERSION = 22; // fixed: openDb() race that made every local-scan write fail silently

// Memoizes the in-flight open, not just the resolved db — with only a resolved-value cache,
// two callers racing at startup (e.g. PlayerContext loading local Loved/History alongside the
// Library screen's local scan, both on mount) would each see no db yet and both independently
// call openDatabaseAsync() for the same file, and every write after that started rejecting with
// "NativeDatabase.execAsync has been rejected" — the local scan ran to completion but silently
// wrote nothing, leaving Artists/Albums/Genres/Years empty despite tag reading working fine.
let _dbPromise: Promise<SQLiteDatabase> | null = null;

export const openDb = (): Promise<SQLiteDatabase> => {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDbInternal();
  return _dbPromise;
};

const openDbInternal = async (): Promise<SQLiteDatabase> => {
  const db = await openDatabaseAsync('resonance_metadata.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS track_metadata (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT,
      artist TEXT,
      album_artist TEXT,
      album TEXT,
      year INTEGER,
      genre TEXT,
      track_number INTEGER,
      disc_number INTEGER,
      duration REAL,
      bpm REAL,
      musical_key TEXT,
      file_size INTEGER,
      has_artwork INTEGER NOT NULL DEFAULT 0,
      artwork_path TEXT,
      file_mtime INTEGER,
      cached_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_tm_source ON track_metadata(source);
    CREATE TABLE IF NOT EXISTS local_loved (
      path TEXT PRIMARY KEY,
      loved_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_play_history (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      played_at INTEGER NOT NULL,
      title TEXT,
      artist TEXT,
      folder TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lph_played_at ON local_play_history(played_at DESC);
  `);

  // If the scan version is outdated, wipe local entries so they're re-scanned fresh.
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM schema_info WHERE key = ?', ['local_scan_version'],
  );
  if (!row || parseInt(row.value, 10) < LOCAL_SCAN_VERSION) {
    await db.runAsync('DELETE FROM track_metadata WHERE source = ?', ['local']);
    await db.runAsync(
      'INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)',
      ['local_scan_version', String(LOCAL_SCAN_VERSION)],
    );
  }

  return db;
};

// Read the whole persisted metadata table for a source. Used by the local library's
// change-detection fast path: when the on-device file set is unchanged, the track list
// is rebuilt straight from here with no MediaStore enumeration or re-parse.
export const getAllMetadata = async (source: 'local' | 'server'): Promise<TrackMetadata[]> => {
  const db = await openDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM track_metadata WHERE source = ?', [source],
  );
  return rows.map(rowToMetadata);
};

// Generic key/value access over schema_info — used to persist the local library
// signature (file count + newest modification time) across app/phone restarts.
export const getSchemaValue = async (key: string): Promise<string | null> => {
  const db = await openDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM schema_info WHERE key = ?', [key],
  );
  return row?.value ?? null;
};

export const setSchemaValue = async (key: string, value: string): Promise<void> => {
  const db = await openDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)', [key, value],
  );
};

export const getMetadataForPaths = async (paths: string[]): Promise<Map<string, TrackMetadata>> => {
  if (paths.length === 0) return new Map();
  const db = await openDb();
  const placeholders = paths.map(() => '?').join(',');
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM track_metadata WHERE path IN (${placeholders})`,
    paths
  );
  const map = new Map<string, TrackMetadata>();
  for (const row of rows) {
    map.set(row.path as string, rowToMetadata(row));
  }
  return map;
};

export const upsertMetadata = async (entries: TrackMetadata[]): Promise<void> => {
  if (entries.length === 0) return;
  const db = await openDb();
  await db.withTransactionAsync(async () => {
    for (const e of entries) {
      await db.runAsync(
        `INSERT OR REPLACE INTO track_metadata
         (path, source, title, artist, album_artist, album, year, genre,
          track_number, disc_number, duration, bpm, musical_key, file_size,
          has_artwork, artwork_path, file_mtime, cached_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          e.path, e.source, e.title, e.artist, e.albumArtist, e.album,
          e.year, e.genre, e.trackNumber, e.discNumber, e.duration,
          e.bpm, e.musicalKey, e.fileSize,
          e.hasArtwork ? 1 : 0, e.artworkPath,
          e.fileMtime, Date.now(),
        ]
      );
    }
  });
};

export const clearLocalMetadata = async (): Promise<void> => {
  const db = await openDb();
  await db.runAsync('DELETE FROM track_metadata WHERE source = ?', ['local']);
  // Clear cached artwork files too
  try {
    const dir = artworkDirectory();
    if (dir.exists) dir.delete();
  } catch { /* ignore */ }
};

export const pruneRemovedTracks = async (currentPaths: string[], source: 'local' | 'server'): Promise<void> => {
  const db = await openDb();
  if (currentPaths.length === 0) {
    await db.runAsync('DELETE FROM track_metadata WHERE source = ?', [source]);
    return;
  }
  const placeholders = currentPaths.map(() => '?').join(',');
  await db.runAsync(
    `DELETE FROM track_metadata WHERE source = ? AND path NOT IN (${placeholders})`,
    [source, ...currentPaths]
  );
};

const artworkFilename = (trackPath: string): string => {
  let hash = 0;
  for (let i = 0; i < trackPath.length; i++) {
    hash = (Math.imul(31, hash) + trackPath.charCodeAt(i)) | 0;
  }
  const stem = trackPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'artwork';
  return stem.slice(0, 32) + '_' + Math.abs(hash).toString(16) + '.jpg';
};

export const cacheArtwork = async (trackPath: string, base64Data: string): Promise<string> => {
  const dir = artworkDirectory();
  if (!dir.exists) dir.create({ idempotent: true });
  const file = new File(dir, artworkFilename(trackPath));
  // Use legacy writeAsStringAsync — it correctly decodes base64 to binary bytes.
  // The new file.write(Uint8Array) path has unreliable JS→native TypedArray bridging.
  await LegacyFS.writeAsStringAsync(file.uri, base64Data, {
    encoding: LegacyFS.EncodingType.Base64,
  });
  return file.uri;
};

// Local-only Loved/History storage. These never leave the phone — the server has no concept of
// a device file path, so local activity is tracked entirely on-device instead of via the
// /musiclibrary/loved and /musiclibrary/plays endpoints used for server tracks.
export interface LocalPlayEntry {
  id: string;
  path: string;
  playedAt: number;
  title: string | null;
  artist: string | null;
  folder: string | null;
}

export const getLocalLovedPaths = async (): Promise<string[]> => {
  const db = await openDb();
  const rows = await db.getAllAsync<{ path: string }>('SELECT path FROM local_loved');
  return rows.map((r) => r.path);
};

export const addLocalLoved = async (path: string): Promise<void> => {
  const db = await openDb();
  await db.runAsync('INSERT OR REPLACE INTO local_loved (path, loved_at) VALUES (?, ?)', [path, Date.now()]);
};

export const removeLocalLoved = async (path: string): Promise<void> => {
  const db = await openDb();
  await db.runAsync('DELETE FROM local_loved WHERE path = ?', [path]);
};

export const clearLocalLoved = async (): Promise<void> => {
  const db = await openDb();
  await db.runAsync('DELETE FROM local_loved');
};

export const getLocalPlayHistory = async (limit = 500): Promise<LocalPlayEntry[]> => {
  const db = await openDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM local_play_history ORDER BY played_at DESC LIMIT ?', [limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    path: r.path as string,
    playedAt: r.played_at as number,
    title: (r.title as string | null) ?? null,
    artist: (r.artist as string | null) ?? null,
    folder: (r.folder as string | null) ?? null,
  }));
};

export const addLocalPlay = async (entry: LocalPlayEntry): Promise<void> => {
  const db = await openDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO local_play_history (id, path, played_at, title, artist, folder) VALUES (?,?,?,?,?,?)',
    [entry.id, entry.path, entry.playedAt, entry.title, entry.artist, entry.folder],
  );
};

export const removeLocalPlay = async (id: string): Promise<void> => {
  const db = await openDb();
  await db.runAsync('DELETE FROM local_play_history WHERE id = ?', [id]);
};

export const clearLocalPlayHistory = async (): Promise<void> => {
  const db = await openDb();
  await db.runAsync('DELETE FROM local_play_history');
};

const rowToMetadata = (row: Record<string, unknown>): TrackMetadata => ({
  path: row.path as string,
  source: row.source as 'local' | 'server',
  title: (row.title as string | null) ?? null,
  artist: (row.artist as string | null) ?? null,
  albumArtist: (row.album_artist as string | null) ?? null,
  album: (row.album as string | null) ?? null,
  year: (row.year as number | null) ?? null,
  genre: (row.genre as string | null) ?? null,
  trackNumber: (row.track_number as number | null) ?? null,
  discNumber: (row.disc_number as number | null) ?? null,
  duration: (row.duration as number | null) ?? null,
  bpm: (row.bpm as number | null) ?? null,
  musicalKey: (row.musical_key as string | null) ?? null,
  fileSize: (row.file_size as number | null) ?? null,
  hasArtwork: (row.has_artwork as number) === 1,
  artworkPath: (row.artwork_path as string | null) ?? null,
  fileMtime: (row.file_mtime as number | null) ?? null,
  cachedAt: row.cached_at as number,
});
