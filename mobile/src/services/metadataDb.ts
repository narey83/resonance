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
const LOCAL_SCAN_VERSION = 14;

let _db: SQLiteDatabase | null = null;

export const openDb = async (): Promise<SQLiteDatabase> => {
  if (_db) return _db;
  _db = await openDatabaseAsync('resonance_metadata.db');
  await _db.execAsync(`
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
  `);

  // If the scan version is outdated, wipe local entries so they're re-scanned fresh.
  const row = await _db.getFirstAsync<{ value: string }>(
    'SELECT value FROM schema_info WHERE key = ?', ['local_scan_version'],
  );
  if (!row || parseInt(row.value, 10) < LOCAL_SCAN_VERSION) {
    await _db.runAsync('DELETE FROM track_metadata WHERE source = ?', ['local']);
    await _db.runAsync(
      'INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)',
      ['local_scan_version', String(LOCAL_SCAN_VERSION)],
    );
  }

  return _db;
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
