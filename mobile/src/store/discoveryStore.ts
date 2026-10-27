import { isAxiosError } from 'axios';
import { create } from 'zustand';
import { File, Directory, Paths } from 'expo-file-system';
import * as api from '../api/discovery';
import { getSessionScope, onSessionReset, sessionGuard } from '../lib/sessionScope';

interface DiscoveryState {
  notes: Record<string, api.TrackPreparation>;
  pending: Record<string, api.TrackPreparation>;
  conflicts: Record<string, api.TrackPreparation>;
  resolveConflict: (path: string, keepLocal: boolean) => Promise<void>;
  wishes: api.DiggingWish[];
  dismissed: string[];
  error: string | null;
  hydrate: () => void;
  sync: () => Promise<void>;
  save: (note: api.TrackPreparation) => Promise<void>;
  dismiss: (path: string) => void;
}
function storage() {
  const scope = getSessionScope();
  if (!scope) return null;
  const dir = new Directory(Paths.document, 'discovery'); dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${encodeURIComponent(scope)}.json`);
}
function persist() {
  const { notes, pending, dismissed, wishes } = useDiscoveryStore.getState();
  storage()?.write(JSON.stringify({ notes, pending, dismissed, wishes }));
}
let syncing: Promise<void> | null = null;
export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  notes: {}, pending: {}, conflicts: {}, wishes: [], dismissed: [], error: null,
  hydrate: () => {
    try { const file = storage(); if (file?.exists) { const data = JSON.parse(file.textSync()); set({ notes: data.notes ?? {}, pending: data.pending ?? {}, dismissed: data.dismissed ?? [], wishes: data.wishes ?? [] }); } }
    catch { set({ error: 'Could not read saved preparation notes.' }); }
  },
  sync: () => {
    if (syncing) return syncing;
    const current = sessionGuard();
    syncing = (async () => {
      try {
        const conflicted: string[] = [];
        for (const [path, note] of Object.entries(get().pending)) {
          if (!current()) return;
          let saved: api.TrackPreparation;
          try { saved = await api.saveNotes(note); }
          catch (error) {
            if (isAxiosError(error) && error.response?.status === 409) { conflicted.push(path); continue; }
            throw error;
          }
          if (!current()) return;
          // A newer edit made during this request stays queued using the new revision.
          const latest = get().pending[path];
          const pending = { ...get().pending };
          if (latest === note) delete pending[path];
          else if (latest) pending[path] = { ...latest, revision: saved.revision };
          set({ pending, notes: { ...get().notes, [path]: latest === note ? saved : { ...latest, revision: saved.revision } } }); persist();
        }
        const [notes, wishes] = await Promise.all([api.getNotes(), api.getWishes()]);
        if (!current()) return;
        const conflicts = Object.fromEntries(notes.filter(note => conflicted.includes(note.path)).map(note => [note.path, note]));
        set({ notes: { ...Object.fromEntries(notes.map(note => [note.path, note])), ...get().pending }, conflicts, wishes,
          error: conflicted.length ? 'Notes changed on another device. Review the conflicts in Prepare.' : null }); persist();
      } catch (error) { if (current()) set({ error: `Sync paused: ${(error as Error).message}. Pending notes remain on this device. Conflicts require refreshing and reconciling the desktop edit.` }); }
    })().finally(() => { if (current()) syncing = null; });
    return syncing;
  },
  resolveConflict: async (path, keepLocal) => {
    const remote = get().conflicts[path];
    const local = get().pending[path];
    if (!remote || !local) return;
    const pending = { ...get().pending }; const conflicts = { ...get().conflicts };
    delete conflicts[path];
    if (keepLocal) pending[path] = { ...local, revision: remote.revision };
    else delete pending[path];
    set({ pending, conflicts, notes: { ...get().notes, [path]: keepLocal ? pending[path] : remote } });
    persist(); await get().sync();
  },
  save: async note => {
    set({ notes: { ...get().notes, [note.path]: note }, pending: { ...get().pending, [note.path]: note } });
    persist(); await get().sync();
  },
  dismiss: path => { set({ dismissed: [...get().dismissed, path] }); persist(); },
}));
onSessionReset(() => { syncing = null; useDiscoveryStore.setState(useDiscoveryStore.getInitialState(), true); });
