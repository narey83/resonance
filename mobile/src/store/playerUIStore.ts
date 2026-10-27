// <copyright file="playerUIStore.ts" company="John Narey">
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

import { onSessionReset } from '../lib/sessionScope';
import { create } from 'zustand';

// On-screen square the full player should morph out of / back into. Set by the
// floating bubble at the moment of tap so PlayerOverlay can grow its hero artwork
// from exactly where the bubble sits; null means "no bubble origin" → the overlay
// uses its classic slide-up-from-bottom entrance (mini-bar mode).
export interface MorphRect {
  x:    number;
  y:    number;
  size: number;
}

interface PlayerUIState {
  expanded: boolean;
  // Whether a track is currently loaded (mini bar visible). Synced from PlayerContext.
  hasTrack: boolean;
  morphFrom: MorphRect | null;
  expand: (from?: MorphRect) => void;
  collapse: () => void;
  setHasTrack: (v: boolean) => void;
}

export const usePlayerUI = create<PlayerUIState>((set) => ({
  expanded: false,
  hasTrack: false,
  morphFrom: null,
  expand:   (from) => set({ expanded: true, morphFrom: from ?? null }),
  collapse: () => set({ expanded: false }),
  setHasTrack: (v) => set({ hasTrack: v }),
}));

onSessionReset(() => {
  usePlayerUI.setState(usePlayerUI.getInitialState(), true);
});
