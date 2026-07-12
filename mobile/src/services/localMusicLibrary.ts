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

import {
  requestPermissionsAsync,
  Asset,
  Album,
  Query,
  AssetField,
  MediaType,
} from 'expo-media-library';
import { readId3Tags } from './id3Reader';
import { dbg } from '../api/debugLog';
import { MusicTrack, MusicAlbum, MusicArtist, MusicFolder, TracksResult } from '../api/musicLibrary';
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
  JSON.stringify({ c: count, m: latestMtime });

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
  asset: Asset;
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

const parseId3 = async (basics: AssetBasics): Promise<TrackMetadata> => {
  let title: string | null = null;
  let artist: string | null = null;
  let album: string | null = null;
  let genre: string | null = null;
  let artworkPath: string | null = null;

  try {
    const tags = await readId3Tags(basics.uri, {
      title: true, artist: true, album: true, genre: true, picture: true,
    });
    title = tags.title;
    artist = tags.artist;
    album = tags.album;
    genre = tags.genre;
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
    // ID3 parse failure — title will fall back to filename
  }

  return {
    path: basics.uri,
    source: 'local',
    title,
    artist,
    albumArtist: null,
    album,
    year: null,
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
// Set by the app to bump libraryRevision whenever a scan batch completes.
let _onScanProgress: (() => void) | null = null;

export const setScanProgressCallback = (cb: () => void) => { _onScanProgress = cb; };

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

  if (!await requestPermissions()) return [];

  // Enumerate asset HANDLES only — cheap, no per-asset field reads yet.
  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
    .exe();

  // Change-detection fast path: if the file count + newest mtime match what we persisted
  // after the last fully-reconciled scan, the on-device library is unchanged. Rebuild the
  // track list straight from SQLite — no per-asset enumeration (thousands of native calls)
  // and no re-parse. This is what makes the library survive app/phone restarts and only
  // rebuild when the local files actually change.
  const latestMtime = await probeLatestMtime();
  const signature = librarySignature(assets.length, latestMtime);
  const storedSignature = await getSchemaValue(LIBRARY_SIGNATURE_KEY).catch(() => null);

  if (storedSignature && storedSignature === signature) {
    const rows = await getAllMetadata('local');
    if (rows.length > 0) {
      _trackCache = rows.map(m => metadataToMusicTrack(m.path, filenameFromUri(m.path), m));
      _trackCacheTime = now;
      dbg(`[local-scan] unchanged (signature hit) — ${rows.length} tracks from cache, no enumeration`);
      return _trackCache;
    }
  }

  // Slow path: the file set changed (or first ever run). Read per-asset basics and diff
  // against the cached metadata; only genuinely new/modified files get re-parsed.
  const basics = (await Promise.all(assets.map(fetchAssetBasics)))
    .filter((b): b is AssetBasics => b !== null);

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
  const finalSignature = librarySignature(assets.length, maxMtime ?? latestMtime);
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
      let skipped = 0;
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
          _onScanProgress?.();
        }
        await pruneRemovedTracks(uris, 'local').catch(() => {});
        // Only pin the signature when every file parsed cleanly — otherwise leave it stale
        // so the next entry re-runs this path and retries the skipped files (self-healing).
        if (skipped === 0) persistSignature();
      } finally {
        // Always clear, even on an unexpected throw, so a failed scan can restart on the
        // next getAllLocalTracks() call — a stuck non-null promise would otherwise make
        // the `!_backgroundScan` guard block every future scan permanently.
        _backgroundScan = null;
      }
    })();
  }

  return _trackCache;
};

export const getLocalTracks = async (offset = 0, limit = 50): Promise<TracksResult> => {
  const all = await getAllLocalTracks();
  return { total: all.length, offset, limit, tracks: all.slice(offset, offset + limit) };
};

export const getLocalAlbums = async (): Promise<MusicAlbum[]> => {
  if (!await requestPermissions()) return [];

  const albums = await Album.getAll();
  const albumData = await Promise.all(
    albums.map(async (album) => {
      const [title, audioAssets] = await Promise.all([
        album.getTitle(),
        new Query().eq(AssetField.MEDIA_TYPE, MediaType.AUDIO).album(album).exe(),
      ]);
      return { title, assetCount: audioAssets.length };
    })
  );

  return albumData
    .filter(a => a.assetCount > 0)
    .map(({ title, assetCount }) => ({
      album: title,
      artist: '',
      albumArtist: null,
      year: null,
      trackCount: assetCount,
      totalDuration: null,
      coverPath: null,
      hasArtwork: false,
    }));
};

export const getLocalAlbumTracks = async (albumTitle: string): Promise<MusicTrack[]> => {
  if (!await requestPermissions()) return [];

  const album = await Album.get(albumTitle);
  if (!album) return [];

  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
    .album(album)
    .exe();

  const basics = (await Promise.all(assets.map(fetchAssetBasics)))
    .filter((b): b is AssetBasics => b !== null);

  const uris = basics.map(b => b.uri);
  const cached = await getMetadataForPaths(uris);

  return basics.map(b => {
    const meta = cached.get(b.uri);
    if (!meta) {
      return {
        path: b.uri, filename: b.filename, directory: extractDirectory(b.uri),
        duration: b.durationSec, title: b.filename.replace(/\.[^.]+$/, ''),
        artist: null, albumArtist: null, album: albumTitle,
        year: null, trackNumber: null, discNumber: null,
        hasArtwork: false, coverPath: null, genre: null, bpm: null, key: null, fileSize: null,
      };
    }
    return metadataToMusicTrack(b.uri, b.filename, { ...meta, duration: meta.duration ?? b.durationSec });
  });
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

export const getLocalFolderTracks = async (dirPath: string): Promise<MusicTrack[]> => {
  const tracks = await getAllLocalTracks();
  return tracks.filter(t => t.directory === dirPath);
};

export const getLocalArtists = async (): Promise<MusicArtist[]> => {
  return [];
};
