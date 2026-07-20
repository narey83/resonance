// <copyright file="bubbleStore.ts" company="John Narey">
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

import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

// Persisted resting spot for the floating bubble player. Only the edge it's
// docked to and its vertical offset are remembered — the exact x is always
// derived from `side` so the bubble stays flush to the current screen width.
const STORE_KEY = 'bubble_pos_v1';

export type BubbleSide = 'left' | 'right';

interface BubblePosState {
  side:   BubbleSide;
  /** Absolute top offset (px) of the bubble's top-left corner. */
  y:      number;
  loaded: boolean;
  load:   () => Promise<void>;
  save:   (side: BubbleSide, y: number) => void;
}

export const useBubblePos = create<BubblePosState>((set, get) => ({
  side:   'right',
  y:      0,        // 0 means "not yet placed" — the bubble seeds a sensible default on first mount
  loaded: false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      set({
        side:   parsed.side === 'left' ? 'left' : 'right',
        y:      typeof parsed.y === 'number' ? parsed.y : 0,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  // Fire-and-forget: the in-memory value updates immediately; disk write is best-effort.
  save: (side, y) => {
    set({ side, y });
    void persist(side, y);
  },
}));

async function persist(side: BubbleSide, y: number) {
  try {
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ side, y }));
  } catch {}
}
