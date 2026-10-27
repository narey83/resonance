import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { restoreImportedTrack } from '../lib/localTrackPaths';
import type { MusicTrack } from '../api/musicLibrary';

export interface LocalPlaylist {
  id: string;
  name: string;
  tracks: MusicTrack[];
  updatedAt: string;
}
const local = (track: MusicTrack) => track && typeof track.path === 'string' && /^(file|content):\/\//.test(track.path) && !track.offlineUri;
const storage = () => new File(Paths.document, 'local-playlists-v1.json');
interface LocalPlaylistStore {
  playlists: LocalPlaylist[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string) => Promise<LocalPlaylist>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addTracks: (id: string, tracks: MusicTrack[]) => Promise<void>;
  removeTrack: (id: string, path: string) => Promise<void>;
  moveTrack: (id: string, path: string, delta: number) => Promise<void>;
}
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(action: () => Promise<T>): Promise<T> {
  const next = pending.then(action);
  pending = next.catch(() => {});
  return next;
}
const cleanName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a playlist name.');
  return trimmed;
};
export const useLocalPlaylistStore = create<LocalPlaylistStore>((set, get) => {
  async function hydrate() {
    if (get().loaded) return;
    const file = storage();
    const rows: LocalPlaylist[] = file.exists ? JSON.parse(await file.text()) : [];
    if (!Array.isArray(rows) || rows.some(p => !p.id || typeof p.name !== 'string' || !Array.isArray(p.tracks))) {
      throw new Error('Could not read device playlists.');
    }
    set({ playlists: rows.map(p => ({ ...p, tracks: p.tracks.filter(local).map(restoreImportedTrack) })), loaded: true });
  }
  async function update(change: (rows: LocalPlaylist[]) => LocalPlaylist[]) {
    await hydrate();
    const playlists = change(get().playlists);
    // Commit to device storage before exposing the change. No session reset or server API.
    storage().write(JSON.stringify(playlists));
    set({ playlists });
  }
  const edit = (id: string, change: (row: LocalPlaylist) => LocalPlaylist) => update(rows => {
    if (!rows.some(p => p.id === id)) throw new Error('This device playlist no longer exists.');
    return rows.map(p => p.id === id ? { ...change(p), updatedAt: new Date().toISOString() } : p);
  });
  return {
    playlists: [], loaded: false,
    load: () => serial(hydrate),
    create: name => serial(async () => {
      const row: LocalPlaylist = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: cleanName(name), tracks: [], updatedAt: new Date().toISOString() };
      await update(rows => [...rows, row]);
      return row;
    }),
    rename: (id, name) => serial(() => edit(id, p => ({ ...p, name: cleanName(name) }))),
    remove: id => serial(() => update(rows => rows.filter(p => p.id !== id))),
    addTracks: (id, tracks) => serial(() => {
      if (tracks.some(t => !local(t) || t.offlineUri)) throw new Error('Device playlists accept only local music, not server tracks or downloads.');
      // Retain only device metadata; never persist server signatures or remote artwork.
      const safe = tracks.map(restoreImportedTrack).map(t => ({ ...t, sig: undefined, exp: undefined,
        coverPath: t.coverPath && /^(file|content):\/\//.test(t.coverPath) ? t.coverPath : null }));
      return edit(id, p => ({ ...p, tracks: [...new Map([...p.tracks, ...safe].map(t => [t.path, t])).values()] }));
    }),
    removeTrack: (id, path) => serial(() => edit(id, p => ({ ...p, tracks: p.tracks.filter(t => t.path !== path) }))),
    moveTrack: (id, path, delta) => serial(() => edit(id, p => {
      const tracks = [...p.tracks], from = tracks.findIndex(t => t.path === path), to = from + delta;
      if (from >= 0 && to >= 0 && to < tracks.length) [tracks[from], tracks[to]] = [tracks[to], tracks[from]];
      return { ...p, tracks };
    })),
  };
});
