import { Directory, File, Paths } from 'expo-file-system';
import * as FS from 'expo-file-system/legacy';
import { create } from 'zustand';
import { ensureSigned, signedQuery } from '../api/streamSignatures';
import { getValidToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import type { MusicTrack } from '../api/musicLibrary';
import { getSessionScope, onSessionReset, sessionGuard } from '../lib/sessionScope';
import { haptics } from '../lib/haptics';

export interface OfflineCrate { id: string; name: string; tracks: MusicTrack[]; downloadedAt: number; bytes: number }
interface OfflineState { crates: OfflineCrate[]; busy: string | null; progress: number; error: string | null; hydrate: () => void; download: (id: string, name: string, tracks: MusicTrack[]) => Promise<void>; remove: (id: string) => void; cancel: () => void }
function root() {
  const scope = getSessionScope();
  if (!scope) throw new Error('Sign in to manage offline crates.');
  const dir = new Directory(Paths.document, 'offline-crates', encodeURIComponent(scope));
  dir.create({ intermediates: true, idempotent: true }); return dir;
}
function persist(crates: OfflineCrate[]) { new File(root(), 'manifest.json').write(JSON.stringify(crates)); }
let active: FS.DownloadResumable | null = null;
let cancelled = false;
export const useOfflineCrates = create<OfflineState>((set, get) => ({
  crates: [], busy: null, progress: 0, error: null,
  hydrate: () => {
    try { const manifest = new File(root(), 'manifest.json'); if (manifest.exists) set({ crates: JSON.parse(manifest.textSync()).map((crate: OfflineCrate) => ({ ...crate, tracks: crate.tracks.filter(track => !!track.offlineUri && new File(track.offlineUri).exists) })) }); }
    catch { set({ error: 'Could not read offline downloads.' }); }
  },
  cancel: () => { cancelled = true; void active?.cancelAsync().catch(() => {}); },
  download: async (id, name, tracks) => {
    if (get().busy) { set({ error: 'Wait for the current crate to finish.' }); return; }
    if (!tracks.length) { set({ error: 'This playlist is empty.' }); return; }
    const current = sessionGuard(); cancelled = false;
    let folder: Directory | null = null;
    set({ busy: id, progress: 0, error: null });
    const downloaded: MusicTrack[] = []; let bytes = 0;
    try {
      folder = new Directory(root(), `${encodeURIComponent(id)}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      folder.create({ intermediates: true, idempotent: true });
      for (let index = 0; index < tracks.length; index++) {
        if (cancelled || !current()) throw new Error('Download cancelled.');
        const track = tracks[index];
        const extension = track.path.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'audio';
        const destination = new File(folder, `${index}.${extension}`);
        const token = await getValidToken();
        await ensureSigned([track.path]);
        if (!current()) throw new Error('Session changed.');
        const serverUrl = useAuthStore.getState().serverUrl;
        // Always download original bytes, independent of the streaming quality preference.
        const url = `${serverUrl}/api/v0/musiclibrary/stream?path=${encodeURIComponent(track.path)}${signedQuery(track.path)}`;
        active = FS.createDownloadResumable(url, destination.uri, { headers: { Authorization: `Bearer ${token}` } }, status => {
          if (current()) set({ progress: (index + (status.totalBytesExpectedToWrite > 0 ? status.totalBytesWritten / status.totalBytesExpectedToWrite : 0)) / tracks.length });
        });
        const response = await active.downloadAsync();
        if (!response || response.status !== 200 || !destination.exists || destination.size === 0) throw new Error(`Could not download ${track.title ?? track.filename}.`);
        bytes += destination.size;
        downloaded.push({ ...track, offlineUri: destination.uri });
      }
      if (cancelled || !current()) throw new Error('Download cancelled.');
      const previous = get().crates.find(crate => crate.id === id);
      const crates = [...get().crates.filter(crate => crate.id !== id), { id, name, tracks: downloaded, bytes, downloadedAt: Date.now() }];
      persist(crates);
      set({ crates });
      try { if (previous?.tracks[0]?.offlineUri) new File(previous.tracks[0].offlineUri).parentDirectory.delete(); } catch { /* Older audio can be cleaned on the next launch. */ }
      haptics.skip();
    } catch (error) {
      try { if (folder?.exists) folder.delete(); } catch { /* Keep the original download error. */ }
      if (current()) set({ error: (error as Error).message });
    } finally { if (current()) { active = null; set({ busy: null, progress: 0 }); } }
  },
  remove: id => {
    if (get().busy === id) return;
    const crate = get().crates.find(item => item.id === id);
    const crates = get().crates.filter(item => item.id !== id);
    try { persist(crates); } catch { set({ error: 'Could not update device storage. The crate has been kept.' }); return; }
    set({ crates });
    try { if (crate?.tracks[0]?.offlineUri) { const folder = new File(crate.tracks[0].offlineUri).parentDirectory; if (folder.exists) folder.delete(); } } catch { set({ error: 'Audio could not be fully removed from device storage.' }); }
  },
}));
export function offlineUriFor(path: string): string | undefined {
  const uri = useOfflineCrates.getState().crates.flatMap(crate => crate.tracks).find(track => track.path === path)?.offlineUri;
  return uri && new File(uri).exists ? uri : undefined;
}
onSessionReset(() => { cancelled = true; void active?.cancelAsync().catch(() => {}); active = null; useOfflineCrates.setState(useOfflineCrates.getInitialState(), true); });
