import { create } from 'zustand';
import * as api from '../api/transfers';
import type { Transfer, TransferDir } from '../api/transfers';

interface TransferStore {
  downloads: Transfer[];
  uploads: Transfer[];
  downloadsLoaded: boolean;
  uploadsLoaded: boolean;

  loadDownloads: () => Promise<void>;
  loadUploads: () => Promise<void>;
  cancel: (dir: TransferDir, username: string, id: string, remove?: boolean) => Promise<void>;
  clearCompleted: (dir: TransferDir) => Promise<void>;
}

// Reuse existing Transfer objects for items that haven't changed so React.memo
// comparators can short-circuit without re-rendering unchanged rows.
function reconcile(prev: Transfer[], next: Transfer[]): Transfer[] {
  const prevById = new Map(prev.map(t => [t.id, t]));
  let changed = prev.length !== next.length;
  const result = next.map(n => {
    const p = prevById.get(n.id);
    if (
      p &&
      p.stateDescription === n.stateDescription &&
      p.bytesTransferred  === n.bytesTransferred &&
      p.averageSpeed      === n.averageSpeed &&
      p.placeInQueue      === n.placeInQueue
    ) return p;
    changed = true;
    return n;
  });
  return changed ? result : prev;
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  downloads: [],
  uploads: [],
  downloadsLoaded: false,
  uploadsLoaded: false,

  loadDownloads: async () => {
    try {
      const fresh = await api.getAll('download');
      const prev = get();
      const downloads = reconcile(prev.downloads, fresh);
      if (downloads === prev.downloads && prev.downloadsLoaded) return;
      set({ downloads, downloadsLoaded: true });
    } catch {}
  },

  loadUploads: async () => {
    try {
      const fresh = await api.getAll('upload');
      const prev = get();
      const uploads = reconcile(prev.uploads, fresh);
      if (uploads === prev.uploads && prev.uploadsLoaded) return;
      set({ uploads, uploadsLoaded: true });
    } catch {}
  },

  cancel: async (dir, username, id, remove = false) => {
    await api.cancelTransfer(dir, username, id, remove);
    if (dir === 'download') get().loadDownloads();
    else get().loadUploads();
  },

  clearCompleted: async (dir) => {
    await api.clearCompleted(dir);
    if (dir === 'download') get().loadDownloads();
    else get().loadUploads();
  },
}));
