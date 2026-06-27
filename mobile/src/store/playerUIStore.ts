import { create } from 'zustand';

interface PlayerUIState {
  expanded: boolean;
  // Whether a track is currently loaded (mini bar visible). Synced from PlayerContext.
  hasTrack: boolean;
  expand: () => void;
  collapse: () => void;
  setHasTrack: (v: boolean) => void;
  // Expand only when nothing is playing yet (a fresh start). If a track is already loaded the
  // mini bar is up and the user may have deliberately minimised it — starting another track or
  // album should keep it minimised rather than yanking the full player back into view.
  expandForFreshPlayback: () => void;
}

export const usePlayerUI = create<PlayerUIState>((set, get) => ({
  expanded: false,
  hasTrack: false,
  expand:   () => set({ expanded: true }),
  collapse: () => set({ expanded: false }),
  setHasTrack: (v) => set({ hasTrack: v }),
  expandForFreshPlayback: () => { if (!get().hasTrack) set({ expanded: true }); },
}));
