// <copyright file="musicLibrary.ts" company="John Narey">
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

import { apiClient } from './client';
import { useAuthStore } from '../store/auth';
import { useAppSettings } from '../store/appSettingsStore';
import { useConnectionStore } from '../services/connectionMonitor';
import { seedSignatures, signedQuery } from './streamSignatures';

// Server-embedded path signature (see backend StreamUrlSigner). Lets us build signed artwork/
// stream URLs without a separate POST /sign round-trip — list fetchers seed the signature cache
// from these fields. Optional so older payloads / other callers still typecheck.
interface Signed {
  sig?: string | null;
  exp?: number | null;
}

export interface MusicArtist extends Signed {
  artist: string;
  albumCount: number;
  trackCount: number;
  coverPath: string | null;
  hasArtwork: boolean;
}

export interface MusicAlbum extends Signed {
  album: string;
  artist: string;
  albumArtist: string | null;
  year: number | null;
  trackCount: number;
  totalDuration: number | null;
  coverPath: string | null;
  hasArtwork: boolean;
  // Source directory of the grouped album. Used to scope the track fetch by folder rather
  // than artist — essential for Various-Artists albums where `artist` is the literal
  // "Various Artists" and matches no individual track. Mirrors the web album track params.
  directory?: string | null;
}

export interface MusicTrack extends Signed {
  path: string;
  filename: string;
  directory: string;
  duration: number | null;
  title: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  year: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  hasArtwork: boolean;
  coverPath: string | null;
  genre: string | null;
  bpm: number | null;
  key: string | null;
  /** Integrated loudness (LUFS) from analysis; null until the track has been analysed. */
  lufs?: number | null;
  fileSize: number | null;
}

export interface MusicGenre {
  genre: string;
  trackCount: number;
}

export interface MusicYear {
  year: number;
  trackCount: number;
  albumCount: number;
}

export interface MusicFolder extends Signed {
  path: string;
  name: string;
  trackCount: number;
  coverPath: string | null;
  hasArtwork: boolean;
}

export interface TracksResult {
  total: number;
  offset: number;
  limit: number;
  tracks: MusicTrack[];
}

// Backend music-library scan state (BPM/key/metadata indexing on the server). Distinct from the
// on-device cache sync in librarySyncStore — this reflects whether the *server* is scanning.
export interface MusicLibrarySyncState {
  running: boolean;
  completed: boolean;
  lastSyncAt: number | null;
  totalTracks: number;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  failed: number;
  progress: number;
}

export const getSyncState = async (): Promise<MusicLibrarySyncState> =>
  (await apiClient.get('/musiclibrary/sync')).data;

export const cancelSync = async (): Promise<void> => {
  await apiClient.post('/musiclibrary/sync/cancel');
};

// Artwork covers (artists/albums/folders) are signed by their coverPath; tracks by their path.
// Exported so the on-device list cache can re-seed signatures when painting cached rows.
export const seedCoverSignatures = (
  rows: { coverPath: string | null; sig?: string | null; exp?: number | null }[],
) => seedSignatures(rows.map((r) => ({ path: r.coverPath, sig: r.sig, exp: r.exp })));

export const seedTrackSignatures = (
  rows: { path: string; sig?: string | null; exp?: number | null }[],
) => seedSignatures(rows);

const seedCover = seedCoverSignatures;

export const getArtists = async (): Promise<MusicArtist[]> => {
  const data: MusicArtist[] = (await apiClient.get('/musiclibrary/artists')).data;
  seedCover(data);
  return data;
};

export const getAlbums = async (artist?: string): Promise<MusicAlbum[]> => {
  const data: MusicAlbum[] = (await apiClient.get('/musiclibrary/albums', { params: artist ? { artist } : {} })).data;
  seedCover(data);
  return data;
};

export const getTracks = async (params: Record<string, string | number>): Promise<TracksResult> => {
  const data: TracksResult = (await apiClient.get('/musiclibrary/tracks', { params })).data;
  seedSignatures(data.tracks);
  return data;
};

// Full track records for the user's loved paths only — resolved server-side against the library.
// Avoids downloading the entire library (20k+ tracks) just to show a handful of loved tracks.
export const getLovedTracks = async (): Promise<MusicTrack[]> => {
  const data: MusicTrack[] = (await apiClient.get('/musiclibrary/loved/tracks')).data;
  seedSignatures(data);
  return data;
};

export const getGenres = async (): Promise<MusicGenre[]> =>
  (await apiClient.get('/musiclibrary/genres')).data;

export const getYears = async (): Promise<MusicYear[]> =>
  (await apiClient.get('/musiclibrary/years')).data;

export const getFolders = async (): Promise<MusicFolder[]> => {
  const data: MusicFolder[] = (await apiClient.get('/musiclibrary/folders')).data;
  seedCover(data);
  return data;
};

export const getRecentlyAdded = async (limit = 20): Promise<MusicAlbum[]> => {
  const data: MusicAlbum[] = (await apiClient.get('/musiclibrary/recentlyadded', { params: { limit } })).data;
  seedCover(data);
  return data;
};

// Build an artwork URL signed with the path's cached HMAC signature (see streamSignatures).
// The path must already be signed (the list fetchers warm the cache); an unsigned path yields
// a URL the server will reject with 401.
// Pass size to request a resized JPEG thumbnail (e.g. 96 for small UI cells, 512 for the player).
export const getArtworkUrl = (path: string | null, size?: number): string | null => {
  if (!path) return null;
  const { serverUrl } = useAuthStore.getState();
  if (!serverUrl) return null;
  const sizeParam = size ? `&size=${size}` : '';
  return `${serverUrl}/api/v0/musiclibrary/artwork?path=${encodeURIComponent(path)}${sizeParam}${signedQuery(path)}`;
};

// Returns the path to pass to ArtworkBox for a track.
// For local tracks the artwork lives in coverPath (a file:// URI); for server tracks
// the track path itself is used by the backend artwork endpoint.
export const getTrackArtworkPath = (track: MusicTrack): string | null => {
  if (!track.hasArtwork) return null;
  const isLocal = track.path.startsWith('file://') || track.path.startsWith('content://');
  return isLocal ? track.coverPath : track.path;
};

// Decide, at queue-build time, whether to request a transcoded low-bitrate stream.
// Auto = transcode on cellular or when the connection monitor reports a slow link.
const resolveStreamQuality = (): 'low' | null => {
  const { streamQuality } = useAppSettings.getState();
  if (streamQuality === 'original') return null;
  if (streamQuality === 'saver') return 'low';
  const { isCellular, status } = useConnectionStore.getState();
  return isCellular || status === 'slow' ? 'low' : null;
};

/** Which stream flavour the next queue build will ask for — surfaced in playback-error logs,
 *  since the transcoded (cellular/saver) path and the original-file path fail differently. */
export const currentStreamQuality = (): string => resolveStreamQuality() ?? 'original';

export const getStreamUrl = (path: string): string => {
  const { serverUrl, accessToken } = useAuthStore.getState();
  const token = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : '';
  if (path.startsWith('soulseek://')) {
    // Format: soulseek://encodedUsername/encodedFilename[?size=N]
    const withoutProto = path.slice('soulseek://'.length);
    const slashIdx    = withoutProto.indexOf('/');
    const username    = decodeURIComponent(withoutProto.slice(0, slashIdx));
    const rest        = withoutProto.slice(slashIdx + 1);
    const qIdx        = rest.indexOf('?');
    const filename    = decodeURIComponent(qIdx >= 0 ? rest.slice(0, qIdx) : rest);
    const sizeParam   = qIdx >= 0 ? `&${rest.slice(qIdx + 1)}` : '';
    return `${serverUrl}/api/v0/streams/${encodeURIComponent(username)}?filename=${encodeURIComponent(filename)}${sizeParam}${token}`;
  }
  const quality = resolveStreamQuality();
  const qualityParam = quality ? `&quality=${quality}` : '';
  return `${serverUrl}/api/v0/musiclibrary/stream?path=${encodeURIComponent(path)}${qualityParam}${signedQuery(path)}`;
};

export const renameFolder = async (path: string, newName: string): Promise<void> =>
  apiClient.patch('/musiclibrary/folders', { path, newName });

export const renameTrack = async (path: string, newFilename: string): Promise<void> =>
  apiClient.patch('/musiclibrary/tracks', { path, newFilename });

// An analysis always measures all four -- they come from one decode of the file.
const ALL_METRICS = 'Bpm, Key, Waveform, Loudness';

/**
 * Queues analysis of the given library tracks: the same scan the web Analysis page starts, limited
 * to these paths. By default only what each track is missing is measured; `reset` clears all four
 * and measures them again. There is one analysis queue for the whole server, so this rejects with
 * a 409 while another analysis is running. An empty list is refused here rather than sent -- the
 * server reads a missing selection as "the whole library".
 */
export const analyseTracks = async (paths: string[], { reset = false } = {}): Promise<void> => {
  if (paths.length === 0) throw new Error('No tracks to analyse.');
  await apiClient.post('/analysis/scan', {
    metrics: ALL_METRICS,
    skipAnalysed: !reset,
    resetAll: reset,
    onlyPaths: paths,
  });
};

/** The server's analysis scan status (GET /analysis/scan). */
export interface AnalysisScanState {
  scanning: boolean;
  completed: boolean;
  cancelled: boolean;
  total: number;
  analysed: number;
  skipped: number;
  failed: number;
  progress: number;
  /** Absolute paths being decoded right now -- the same form as MusicTrack.path. */
  inFlightPaths?: string[] | null;
}

export const getScanState = async (): Promise<AnalysisScanState> =>
  (await apiClient.get<AnalysisScanState>('/analysis/scan')).data;

/** The subset of the analysis waveform response the player draws. */
export interface TrackWaveform {
  numBars: number;
  overallPeaks: number[];
}

// Stored waveforms run to ~75k bars a track (megabytes of JSON). The seek bar draws ~130, so the
// server resamples to this many first: enough headroom to resample again on the phone, at ~10 KB.
const WAVEFORM_BARS = 1024;

/**
 * A track's cached waveform peaks, or null if it hasn't been analysed yet. Read-only: this never
 * starts an analysis, so it is cheap to ask for any track. Other failures are thrown, so callers
 * can tell "no waveform" from "couldn't ask".
 */
export const getWaveform = async (path: string): Promise<TrackWaveform | null> => {
  try {
    const res = await apiClient.get<TrackWaveform>('/analysis/waveform', {
      params: { path, cachedOnly: true, bars: WAVEFORM_BARS },
    });
    return res.data;
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
};

export const deleteFolder = async (path: string): Promise<void> =>
  apiClient.delete('/musiclibrary/folders', { params: { path: btoa(path) } });

export const getTrackTitle = (track: MusicTrack): string =>
  track.title ||
  track.filename.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ||
  '(Unknown)';
