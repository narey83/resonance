// <copyright file="localMusicLibrary.ts" company="John Narey">
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

import { Platform } from 'react-native';
import { importedMusicFiles, importedMusicDirectory } from './importedMusic';
import {
  requestPermissionsAsync,
  Asset,
  Query,
  AssetField,
  MediaType,
} from 'expo-media-library';
import { readId3Tags } from './id3Reader';
import { dbg } from '../api/debugLog';
import { notePerfBlock } from '../lib/perfProbe';
import { MusicTrack, MusicAlbum, MusicArtist, MusicGenre, MusicYear, MusicFolder, TracksResult } from '../api/musicLibrary';
import {
  getMetadataForPaths,
  getAllMetadata,
  getSchemaValue,
  setSchemaValue,
  upsertMetadata,
  pruneRemovedTracks,
  clearLocalMetadata,
  cacheArtwork,
  type TrackMetadata,
} from './metadataDb';

export const isLocalPath = (path: string) =>
  path.startsWith('file://') || path.startsWith('content://');

export const isLocalFolderPath = (path: string) => path.startsWith('/');

export const requestPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;
  const { status } = await requestPermissionsAsync(false, ['audio']);
  return status === 'granted';
};

const extractDirectory = (uri: string): string => {
  if (!uri.startsWith('file://')) return '';
  const path = decodeURIComponent(uri.slice(7));
  const lastSlash = path.lastIndexOf('/');
  return lastSlash > 0 ? path.slice(0, lastSlash) : '';
};

// Derive the display filename from a stored path so the change-detection fast path can
// rebuild tracks from SQLite without calling asset.getFilename() per file.
const filenameFromUri = (uri: string): string => {
  const clean = uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
  return clean.split('/').pop() || clean;
};

// schema_info key for the persisted local-library signature (file count + newest mtime).
const LIBRARY_SIGNATURE_KEY = 'local_lib_signature';
const librarySignature = (count: number, latestMtime: number | null): string =>
  JSON.stringify({ c: count, m: latestMtime, imports: importedMusicDirectory().uri });

const metadataToMusicTrack = (uri: string, filename: string, meta: TrackMetadata): MusicTrack => ({
  path: uri,
  filename,
  directory: extractDirectory(uri),
  duration: meta.duration,
  title: meta.title ?? filename.replace(/\.[^.]+$/, ''),
  artist: meta.artist,
  albumArtist: meta.albumArtist,
  album: meta.album,
  year: meta.year,
  trackNumber: meta.trackNumber,
  discNumber: meta.discNumber,
  hasArtwork: meta.hasArtwork,
  coverPath: meta.artworkPath ?? null,
  genre: meta.genre,
  bpm: meta.bpm,
  key: meta.musicalKey,
  fileSize: meta.fileSize,
});

interface AssetBasics {
  asset?: Asset;
  uri: string;         // file:// path — used as DB cache key and for directory extraction
  contentUri: string;  // content://media/... URI — used for actual file reading (Android 13+ scoped storage)
  filename: string;
  durationSec: number | null;
  mtime: number | null;
}

const fetchAssetBasics = async (asset: Asset): Promise<AssetBasics | null> => {
  try {
    const [uri, filename, durationMs, mtime] = await Promise.all([
      asset.getUri(),
      asset.getFilename(),
      asset.getDuration(),
      asset.getModificationTime(),
    ]);
    const contentUri = asset.id;
    return {
      asset,
      uri,
      contentUri, // content URI for file reading (accessible via ContentResolver)
      filename,
      durationSec: durationMs != null ? durationMs / 1000 : null,
      mtime: mtime ?? null,
    };
  } catch {
    return null;
  }
};

// Falls back to filename convention when a file has no embedded artist/title tag at all — common
// for old rips that just number tracks ("01 Artist - Title.mp3"). Requires whitespace around the
// dash so it doesn't split a hyphenated word within an untagged single-part title.
const FILENAME_ARTIST_TITLE = /^\s*(?:\d+[\s.\-_]*)?(.+?)\s+-\s+(.+?)\s*$/;
function parseFilenameArtistTitle(filename: string): { artist: string | null; title: string | null } {
  const stem = filename.replace(/\.[^.]+$/, '');
  const m = stem.match(FILENAME_ARTIST_TITLE);
  return m ? { artist: m[1].trim() || null, title: m[2].trim() || null } : { artist: null, title: null };
}

const parseId3 = async (basics: AssetBasics): Promise<TrackMetadata> => {
  let title: string | null = null;
  let artist: string | null = null;
  let album: string | null = null;
  let genre: string | null = null;
  let year: number | null = null;
  let artworkPath: string | null = null;

  try {
    const tags = await readId3Tags(basics.uri, {
      title: true, artist: true, album: true, genre: true, year: true, picture: true,
    });
    title = tags.title;
    artist = tags.artist;
    album = tags.album;
    genre = tags.genre;
    year = tags.year;
    if (tags.picture) {
      const commaIdx = tags.picture.indexOf(',');
      const base64 = commaIdx >= 0 ? tags.picture.slice(commaIdx + 1) : tags.picture;
      try {
        artworkPath = await cacheArtwork(basics.uri, base64);
      } catch {
        // embedded artwork caching failed
      }
    }
  } catch {
    // ID3 parse failure — artist/title/album fall back below regardless of what failed above
  }

  // Filename/folder fallbacks apply whenever the tag read didn't supply a value — including
  // when the read failed outright, not only when it succeeded but simply omitted a field. This
  // must live outside the try block above: it used to sit inside it, so a thrown tag-read error
  // skipped straight past this too, silently leaving the file completely untitled/unattributed
  // instead of falling back to its filename.
  if (!artist || !title) {
    const fromName = parseFilenameArtistTitle(basics.filename);
    artist = artist ?? fromName.artist;
    title = title ?? fromName.title;
  }
  if (!album) {
    const dir = extractDirectory(basics.uri);
    album = basics.uri.startsWith(importedMusicDirectory().uri) ? 'Imported audio' : dir ? (dir.split('/').filter(Boolean).pop() ?? null) : null;
  }

  return {
    path: basics.uri,
    source: 'local',
    title,
    artist,
    albumArtist: null,
    album,
    year,
    genre,
    trackNumber: null,
    discNumber: null,
    duration: basics.durationSec,
    bpm: null,
    musicalKey: null,
    fileSize: null,
    hasArtwork: artworkPath !== null,
    artworkPath,
    fileMtime: basics.mtime,
    cachedAt: Date.now(),
  };
};

// Session-level cache — resets on app restart, avoids redundant scans within a session.
let _trackCache: MusicTrack[] | null = null;
let _trackCacheTime = 0;
let _backgroundScan: Promise<void> | null = null;
// Set by the app to react to each scan batch — bump libraryRevision and, since a full rescan
// (e.g. after a version-gated cache wipe) can take a while, drive a visible progress indicator.
// `progress` is null once the scan is idle/finished.
export type LocalScanProgress = { done: number; total: number } | null;
let _onScanProgress: ((progress: LocalScanProgress) => void) | null = null;

export const setScanProgressCallback = (cb: (progress: LocalScanProgress) => void) => { _onScanProgress = cb; };

export const invalidateLocalTracksCache = () => {
  _trackCache = null;
};

export const forceRescanLocalTracks = async (): Promise<void> => {
  _trackCache = null;
  _backgroundScan = null;
  // Clear the change-detection signature too, or the fast path would short-circuit the
  // rescan against the now-empty table on the next getAllLocalTracks() call.
  await setSchemaValue(LIBRARY_SIGNATURE_KEY, '').catch(() => {});
  await clearLocalMetadata();
};

// Cheap probe for the newest modification time in the audio library: a single sorted
// query capped to one row, so it's one native getter regardless of library size.
const probeLatestMtime = async (): Promise<number | null> => {
  try {
    const newest = await new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
      .orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false })
      .limit(1)
      .exe();
    return newest.length > 0 ? await newest[0].getModificationTime() : null;
  } catch {
    return null;
  }
};

export const getAllLocalTracks = async (): Promise<MusicTrack[]> => {
  const now = Date.now();
  if (_trackCache && now - _trackCacheTime < 5 * 60_000) return _trackCache;

  const imported = importedMusicFiles();
  const canScanDevice = Platform.OS === 'android' && await requestPermissions();

  // Enumerate asset HANDLES only — cheap, no per-asset field reads yet.
  const tEnum = Date.now();
  const assets = canScanDevice ? await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
    .exe() : [];
  notePerfBlock('local:enumerate', tEnum);

  // Change-detection fast path: if the file count + newest mtime match what we persisted
  // after the last fully-reconciled scan, the on-device library is unchanged. Rebuild the
  // track list straight from SQLite — no per-asset enumeration (thousands of native calls)
  // and no re-parse. This is what makes the library survive app/phone restarts and only
  // rebuild when the local files actually change.
  const nativeMtime = canScanDevice ? await probeLatestMtime() : null;
  const latestMtime = imported.reduce((latest, file) => Math.max(latest ?? 0, file.modificationTime ?? 0), nativeMtime);
  const count = assets.length + imported.length;
  const signature = librarySignature(count, latestMtime);
  const storedSignature = await getSchemaValue(LIBRARY_SIGNATURE_KEY).catch(() => null);

  if (storedSignature && storedSignature === signature) {
    const tRows = Date.now();
    const rows = await getAllMetadata('local');
    notePerfBlock(`local:readMeta(${rows.length})`, tRows);
    // Require the cache to cover every known file, not just "some" — a scan interrupted mid-way
    // (app killed, battery died, force-stopped) leaves a signature that still matches (file count/
    // mtime on disk didn't change) but a table that's only partially repopulated. `rows.length > 0`
    // let that partial cache satisfy the fast path forever, since nothing about the signature check
    // ever changes again. Falling through to the slow path re-detects the missing files as stale
    // and finishes the interrupted scan instead of silently serving it as "done".
    if (rows.length === count) {
      const tMap = Date.now();
      _trackCache = rows.map(m => metadataToMusicTrack(m.path, filenameFromUri(m.path), m));
      notePerfBlock(`local:mapTracks(${rows.length})`, tMap);
      _trackCacheTime = now;
      dbg(`[local-scan] unchanged (signature hit) — ${rows.length} tracks from cache, no enumeration`);
      return _trackCache;
    }
  }

  // Slow path: the file set changed (or first ever run). Read per-asset basics and diff
  // against the cached metadata; only genuinely new/modified files get re-parsed.
  const tBasics = Date.now();
  const basics: AssetBasics[] = [
    ...(await Promise.all(assets.map(fetchAssetBasics))).filter((b): b is AssetBasics => b !== null),
    ...imported.map(file => ({ uri: file.uri, contentUri: file.uri, filename: file.name, durationSec: null, mtime: file.modificationTime })),
  ];
  notePerfBlock(`local:assetBasics(${assets.length})`, tBasics);

  const uris = basics.map(b => b.uri);
  const cached = await getMetadataForPaths(uris);

  const stale = basics.filter(b => {
    const c = cached.get(b.uri);
    return !c || c.fileMtime !== b.mtime;
  });

  const buildTrackList = (): MusicTrack[] =>
    basics.map(b => {
      const meta = cached.get(b.uri) ?? {
        path: b.uri, source: 'local' as const,
        title: null, artist: null, albumArtist: null, album: null,
        year: null, genre: null, trackNumber: null, discNumber: null,
        duration: b.durationSec, bpm: null, musicalKey: null, fileSize: null,
        hasArtwork: false, artworkPath: null, fileMtime: b.mtime, cachedAt: Date.now(),
      };
      return metadataToMusicTrack(b.uri, b.filename, {
        ...meta, duration: meta.duration ?? b.durationSec,
      });
    });

  // Return whatever we have immediately so the UI is not blocked.
  _trackCache = buildTrackList();
  _trackCacheTime = now;

  // Persist the signature only once the DB fully reflects the current file set, so the fast
  // path can never serve a half-scanned library. `probeLatestMtime` may have missed a file
  // added between the two queries, so pin the signature to the max mtime actually seen here.
  const maxMtime = basics.reduce<number | null>(
    (mx, b) => (b.mtime != null && (mx == null || b.mtime > mx) ? b.mtime : mx), null);
  const finalSignature = librarySignature(count, maxMtime ?? latestMtime);
  const persistSignature = () => setSchemaValue(LIBRARY_SIGNATURE_KEY, finalSignature).catch(() => {});

  if (stale.length === 0) {
    // Only membership changed (e.g. deletions) — reconcile removals, then pin the signature
    // (await the prune first so a deletion can't be recorded as "current" before it lands).
    (async () => {
      await pruneRemovedTracks(uris, 'local').catch(() => {});
      persistSignature();
    })();
  } else if (!_backgroundScan) {
    _backgroundScan = (async () => {
      const BATCH = 32;
      const total = stale.length;
      const tScan = Date.now();
      let skipped = 0;
      dbg(`[local-scan] starting — ${total} stale of ${assets.length} total`);
      _onScanProgress?.({ done: 0, total });
      try {
        for (let i = 0; i < stale.length; i += BATCH) {
          try {
            const parsed = await Promise.all(stale.slice(i, i + BATCH).map(parseId3));
            await upsertMetadata(parsed);
            for (const e of parsed) cached.set(e.path, e);
            _trackCache = buildTrackList();
            _trackCacheTime = Date.now();
          } catch (e) {
            // One batch failed — most likely a contended SQLite write (upsertMetadata)
            // while another screen touched the DB. Skip it and keep scanning the rest
            // instead of stranding the whole retrieval; the skipped files stay `stale`
            // and get retried on the next scan.
            skipped += 1;
            dbg(`[local-scan] batch @${i} failed, skipping: ${String((e as Error)?.message ?? e)}`);
          }
          // Fire progress even after a skipped batch so the UI keeps reconciling.
          _onScanProgress?.({ done: Math.min(i + BATCH, total), total });
        }
        await pruneRemovedTracks(uris, 'local').catch(() => {});
        // Only pin the signature when every file parsed cleanly — otherwise leave it stale
        // so the next entry re-runs this path and retries the skipped files (self-healing).
        if (skipped === 0) persistSignature();
        dbg(`[local-scan] finished — ${total} files in ${Date.now() - tScan}ms, ${skipped} batches skipped`);
      } finally {
        // Always clear, even on an unexpected throw, so a failed scan can restart on the
        // next getAllLocalTracks() call — a stuck non-null promise would otherwise make
        // the `!_backgroundScan` guard block every future scan permanently.
        _backgroundScan = null;
        _onScanProgress?.(null);
      }
    })();
  }

  return _trackCache;
};

export const getLocalTracks = async (offset = 0, limit = 50): Promise<TracksResult> => {
  const all = await getAllLocalTracks();
  return { total: all.length, offset, limit, tracks: all.slice(offset, offset + limit) };
};

// Groups tracks into albums by their (album, artist) tag pair, same as the server does, instead
// of asking Android's own on-device MediaStore album index — which has no artist/year exposed
// per album at all. Falls back to grouping by folder when the artist tag is missing, so a batch
// of untagged files doesn't all collapse into one "album" bucket just for sharing an album title.
// ponytail: exact-string grouping, no fuzzy artist matching — same ceiling as Genres/Years.
const albumGroupKey = (t: MusicTrack): string => t.artist || t.directory || '';

export const getLocalAlbums = async (): Promise<MusicAlbum[]> => {
  const tracks = await getAllLocalTracks();
  interface Agg {
    artist: string; albumArtist: string | null; year: number | null; trackCount: number;
    totalDuration: number; coverPath: string | null; hasArtwork: boolean; directory: string | null;
  }
  const map = new Map<string, Agg>();
  for (const t of tracks) {
    const album = t.album?.trim();
    if (!album) continue;
    const key = `${album}\u0000${albumGroupKey(t)}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        artist: t.artist ?? '', albumArtist: t.albumArtist, year: t.year, trackCount: 0,
        totalDuration: 0, coverPath: null, hasArtwork: false, directory: t.directory ?? null,
      };
      map.set(key, entry);
    }
    entry.trackCount++;
    if (t.duration) entry.totalDuration += t.duration;
    if (!entry.coverPath && t.coverPath) { entry.coverPath = t.coverPath; entry.hasArtwork = t.hasArtwork; }
    if (entry.year == null && t.year != null) entry.year = t.year;
  }
  return Array.from(map.entries()).map(([key, e]) => ({
    album: key.slice(0, key.indexOf('\u0000')),
    artist: e.artist,
    albumArtist: e.albumArtist,
    year: e.year,
    trackCount: e.trackCount,
    totalDuration: e.totalDuration || null,
    coverPath: e.coverPath,
    hasArtwork: e.hasArtwork,
    directory: e.directory,
  }));
};

// Title-only lookup — used by Android Auto's browse tree, which only round-trips the album title
// (not the artist) in its media IDs. Ambiguous same-titled albums by different artists collapse
// here, same as they already do in the AA tree itself; the in-app AlbumDetail screen uses
// getLocalAlbumTracksFor() below instead, which disambiguates by artist/folder.
export const getLocalAlbumTracks = async (albumTitle: string): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  return tracks.filter(t => t.album === albumTitle);
};

export const getLocalAlbumTracksFor = async (album: MusicAlbum): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  const key = album.artist || album.directory || '';
  return tracks.filter(t => t.album === album.album && albumGroupKey(t) === key);
};

export const getLocalFolders = async (): Promise<MusicFolder[]> => {
  const tracks = await getAllLocalTracks();
  const folderMap = new Map<string, MusicFolder>();
  for (const track of tracks) {
    const dir = track.directory;
    if (!dir) continue;
    const name = dir.split('/').filter(Boolean).pop() ?? dir;
    const existing = folderMap.get(dir);
    if (existing) {
      existing.trackCount++;
      if (!existing.coverPath && track.coverPath) {
        existing.coverPath = track.coverPath;
        existing.hasArtwork = true;
      }
    } else {
      folderMap.set(dir, {
        name, path: dir, trackCount: 1,
        coverPath: track.coverPath ?? null,
        hasArtwork: track.hasArtwork,
      });
    }
  }
  return Array.from(folderMap.values());
};

// A folder's running order, matching the server's `track` sort: album, then disc (untagged = 1),
// then track number (untagged last), then path so "01 - …" filenames order untagged rips.
export function sortTrackOrder(list: MusicTrack[]): MusicTrack[] {
  const key = (s: string | null | undefined) => (s ?? '').toLowerCase();
  return [...list].sort((a, b) => {
    const album = key(a.album) < key(b.album) ? -1 : key(a.album) > key(b.album) ? 1 : 0;
    if (album) return album;
    const disc = (a.discNumber ?? 1) - (b.discNumber ?? 1);
    if (disc) return disc;
    const track = (a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER);
    if (track) return track;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

export const getLocalFolderTracks = async (dirPath: string): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  return sortTrackOrder(tracks.filter(t => t.directory === dirPath));
};

export const getLocalArtists = async (): Promise<MusicArtist[]> => {
  const tracks = await getAllLocalTracks();
  interface Agg { albums: Set<string>; trackCount: number; coverPath: string | null; hasArtwork: boolean; }
  const map = new Map<string, Agg>();
  for (const t of tracks) {
    const name = t.artist;
    if (!name) continue;
    let entry = map.get(name);
    if (!entry) { entry = { albums: new Set(), trackCount: 0, coverPath: null, hasArtwork: false }; map.set(name, entry); }
    entry.trackCount++;
    if (t.album) entry.albums.add(t.album);
    if (!entry.coverPath && t.coverPath) { entry.coverPath = t.coverPath; entry.hasArtwork = t.hasArtwork; }
  }
  return Array.from(map.entries()).map(([artist, e]) => ({
    artist, albumCount: e.albums.size, trackCount: e.trackCount,
    coverPath: e.coverPath, hasArtwork: e.hasArtwork,
  }));
};

export const getLocalArtistTracks = async (artistName: string): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  return tracks.filter(t => t.artist === artistName);
};

export const getLocalArtistAlbums = async (artistName: string): Promise<MusicAlbum[]> => {
  const albums = await getLocalAlbums();
  return albums.filter(a => a.artist === artistName);
};

export const getLocalGenres = async (): Promise<MusicGenre[]> => {
  const tracks = await getAllLocalTracks();
  const map = new Map<string, number>();
  for (const t of tracks) {
    const g = t.genre;
    if (!g) continue;
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([genre, trackCount]) => ({ genre, trackCount }));
};

export const getLocalGenreTracks = async (genre: string): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  return tracks.filter(t => t.genre === genre);
};

export const getLocalYears = async (): Promise<MusicYear[]> => {
  const tracks = await getAllLocalTracks();
  interface Agg { trackCount: number; albums: Set<string>; }
  const map = new Map<number, Agg>();
  for (const t of tracks) {
    if (t.year == null) continue;
    let entry = map.get(t.year);
    if (!entry) { entry = { trackCount: 0, albums: new Set() }; map.set(t.year, entry); }
    entry.trackCount++;
    if (t.album) entry.albums.add(t.album);
  }
  return Array.from(map.entries()).map(([year, e]) => ({
    year, trackCount: e.trackCount, albumCount: e.albums.size,
  }));
};

export const getLocalYearTracks = async (year: number): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  return tracks.filter(t => t.year === year);
};
