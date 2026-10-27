import { sessionGuard } from '../lib/sessionScope';
import { apiClient } from './client';
import { seedTrackSignatures, type MusicTrack } from './musicLibrary';

export interface CueBookmark { id: string; seconds: number; label: string }
export interface TrackPreparation { path: string; role: string; notes: string; bookmarks: CueBookmark[]; revision: number }
export interface DiggingWish { id: string; query: string; createdAt: number }
export const getNotes = async (): Promise<TrackPreparation[]> => (await apiClient.get('/musiclibrary/discovery/notes')).data;
export const saveNotes = async (note: TrackPreparation): Promise<TrackPreparation> => (await apiClient.put('/musiclibrary/discovery/notes', note)).data;
export const getWishes = async (): Promise<DiggingWish[]> => (await apiClient.get('/musiclibrary/discovery/wishes')).data;
export const addWish = async (query: string): Promise<DiggingWish> => (await apiClient.post('/musiclibrary/discovery/wishes', { query })).data;
export const removeWish = async (id: string): Promise<void> => { await apiClient.delete(`/musiclibrary/discovery/wishes/${encodeURIComponent(id)}`); };
export const resolveTracks = async (paths: string[]): Promise<MusicTrack[]> => {
  if (!paths.length) return [];
  const current = sessionGuard();
  const tracks: MusicTrack[] = [];
  for (let index = 0; index < paths.length; index += 200) {
    tracks.push(...(await apiClient.post<MusicTrack[]>('/musiclibrary/resolve', paths.slice(index, index + 200))).data);
    if (!current()) throw new Error('Session changed');
  }
  seedTrackSignatures(tracks);
  const byPath = new Map(tracks.map(track => [track.path, track]));
  return paths.map(path => byPath.get(path)).filter((track): track is MusicTrack => !!track);
};
