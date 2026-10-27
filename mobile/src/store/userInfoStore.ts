// <copyright file="userInfoStore.ts" company="John Narey">
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

// Peer profiles (picture + tagline) for chat avatars and headers.
//
// GET /users/{u}/info is a live round trip to that user's own client — there is
// no backend cache, it takes as long as the peer takes, and it simply fails
// when they're offline. So it can't be fetched eagerly for a whole list: each
// profile is requested lazily by whatever row renders first, deduped, and
// capped at a few in flight, so scrolling a long conversation list can't fan
// out into fifty simultaneous peer requests.

import { onSessionReset } from '../lib/sessionScope';
import { create } from 'zustand';
import { getUserInfo } from '../api/users';

export interface UserProfile {
  picture:     string | null;  // base64 JPEG exactly as the peer sent it
  description: string | null;
}

interface UserInfoStore {
  // undefined = not asked yet, null = asked and the peer gave us nothing.
  profiles: Record<string, UserProfile | null>;
  load:  (username: string) => void;
  reset: () => void;
}

const MAX_IN_FLIGHT = 4;

const requested = new Set<string>();
const queue: string[] = [];
let inFlight = 0;
let generation = 0;

export const useUserInfoStore = create<UserInfoStore>((set) => {
  const record = (username: string, profile: UserProfile | null) =>
    set((s) => ({ profiles: { ...s.profiles, [username]: profile } }));

  const pump = () => {
    while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
      const username = queue.shift() as string;
      const started = generation;
      inFlight += 1;
      getUserInfo(username)
        .then((info) => {
          if (started !== generation) return;
          record(username, {
            picture: info.hasPicture ? info.picture : null,
            description: info.description?.trim() || null,
          });
        })
        // Offline, no response, or blocked — fall back to the initial avatar.
        .catch(() => { if (started === generation) record(username, null); })
        .finally(() => { inFlight -= 1; pump(); });
    }
  };

  return {
    profiles: {},

    load: (username) => {
      // ponytail: unbounded, session-lifetime cache. Pictures are a few KB of
      // base64 each and it's cleared on refresh; add an LRU if a user ever ends
      // up with thousands of conversations open.
      if (!username || requested.has(username)) return;
      requested.add(username);
      queue.push(username);
      pump();
    },

    // A failed lookup is remembered too (offline peers are the common case and
    // must not be retried on every re-render), so pull-to-refresh needs a way to
    // ask again.
    reset: () => {
      generation += 1;
      requested.clear();
      queue.length = 0;
      set({ profiles: {} });
    },
  };
});

onSessionReset(() => { useUserInfoStore.getState().reset(); });
