import { apiClient } from './client';
import { useAuthStore } from '../store/auth';
import { useAppSettings } from '../store/appSettingsStore';
import { useConnectionStore } from '../services/connectionMonitor';

export interface MusicArtist {
  artist: string;
  albumCount: number;
  trackCount: number;
  coverPath: string | null;
  hasArtwork: boolean;
}

export interface MusicAlbum {
  album: string;
  artist: string;
  albumArtist: string | null;
  year: number | null;
  trackCount: number;
  totalDuration: number | null;
  coverPath: string | null;
  hasArtwork: boolean;
}

export interface MusicTrack {
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

export interface MusicFolder {
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

export const getArtists = async (): Promise<MusicArtist[]> =>
  (await apiClient.get('/musiclibrary/artists')).data;

export const getAlbums = async (artist?: string): Promise<MusicAlbum[]> =>
  (await apiClient.get('/musiclibrary/albums', { params: artist ? { artist } : {} })).data;

export const getTracks = async (params: Record<string, string | number>): Promise<TracksResult> =>
  (await apiClient.get('/musiclibrary/tracks', { params })).data;

export const getGenres = async (): Promise<MusicGenre[]> =>
  (await apiClient.get('/musiclibrary/genres')).data;

export const getYears = async (): Promise<MusicYear[]> =>
  (await apiClient.get('/musiclibrary/years')).data;

export const getFolders = async (): Promise<MusicFolder[]> =>
  (await apiClient.get('/musiclibrary/folders')).data;

export const getRecentlyAdded = async (limit = 20): Promise<MusicAlbum[]> =>
  (await apiClient.get('/musiclibrary/recentlyadded', { params: { limit } })).data;

// Build a URL with the access_token query param for use in Image/Audio sources.
// Pass size to request a resized JPEG thumbnail (e.g. 96 for small UI cells, 512 for the player).
export const getArtworkUrl = (path: string | null, size?: number): string | null => {
  if (!path) return null;
  const { serverUrl, accessToken } = useAuthStore.getState();
  if (!serverUrl) return null;
  const token = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : '';
  const sizeParam = size ? `&size=${size}` : '';
  return `${serverUrl}/api/v0/musiclibrary/artwork?path=${encodeURIComponent(path)}${sizeParam}${token}`;
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
  return `${serverUrl}/api/v0/musiclibrary/stream?path=${encodeURIComponent(path)}${qualityParam}${token}`;
};

export const renameFolder = async (path: string, newName: string): Promise<void> =>
  apiClient.patch('/musiclibrary/folders', { path, newName });

export const renameTrack = async (path: string, newFilename: string): Promise<void> =>
  apiClient.patch('/musiclibrary/tracks', { path, newFilename });

export const analyzeFolder = async (path: string, { key = true, bpm = true } = {}): Promise<void> =>
  apiClient.post('/musiclibrary/folders/analyze', { path, analyzeKey: key, analyzeBpm: bpm });

export const deleteFolder = async (path: string): Promise<void> =>
  apiClient.delete('/musiclibrary/folders', { params: { path: btoa(path) } });

export const getTrackTitle = (track: MusicTrack): string =>
  track.title ||
  track.filename.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ||
  '(Unknown)';
