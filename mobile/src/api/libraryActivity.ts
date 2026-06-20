import { apiClient } from './client';

export interface PlayStat {
  path: string;
  playCount: number;
  lastPlayedAt: number | null;
}

export interface PlayRecord {
  id: string;
  path: string;
  playedAt: number;
  title: string;
  artist: string;
  folder: string;
  source: string;
}

export interface LibraryActivitySnapshot {
  lovedPaths: string[];
  playStats: PlayStat[];
}

export const getLoved = async (): Promise<string[]> =>
  (await apiClient.get('/musiclibrary/loved')).data;

export const loveTrack = async (path: string): Promise<void> =>
  apiClient.put('/musiclibrary/loved', { path });

export const unloveTrack = async (path: string): Promise<void> =>
  apiClient.delete('/musiclibrary/loved', { params: { path } });

export const clearAllLoved = async (): Promise<void> =>
  apiClient.delete('/musiclibrary/loved/all');

export const recordPlay = async (
  path: string,
  meta?: { title?: string | null; artist?: string | null; folder?: string | null; source?: string },
): Promise<PlayStat> =>
  (await apiClient.post('/musiclibrary/plays', { path, ...meta })).data;

export const getPlayHistory = async (limit = 100, offset = 0): Promise<PlayRecord[]> =>
  (await apiClient.get('/musiclibrary/plays', { params: { limit, offset } })).data;

export const deletePlay = async (id: string): Promise<void> =>
  apiClient.delete(`/musiclibrary/plays/${encodeURIComponent(id)}`);

export const clearHistory = async (): Promise<void> =>
  apiClient.delete('/musiclibrary/plays');

export const getPlayStats = async (paths?: string[]): Promise<PlayStat[]> =>
  (await apiClient.get('/musiclibrary/plays/stats', paths ? { params: { paths } } : {})).data;
