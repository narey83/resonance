import { create } from 'zustand';

interface PlayerUIState {
  expanded: boolean;
  expand: () => void;
  collapse: () => void;
}

export const usePlayerUI = create<PlayerUIState>((set) => ({
  expanded: false,
  expand:   () => set({ expanded: true }),
  collapse: () => set({ expanded: false }),
}));
