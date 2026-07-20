// <copyright file="useDeferredEffect.ts" company="John Narey">
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

// Effects that defer their work until after the in-flight navigation transition
// completes. On a fast (LAN) backend a fetch kicked off during a native-stack push
// resolves mid-slide, and rendering the resulting list/dashboard on the JS thread
// stutters the animation — the classic "tap → pause → screen" feel. Scheduling the
// initial load with requestIdleCallback lets the slide finish first, then paints the
// data during the next idle window. The `timeout` is a safety net: if the JS thread
// never goes idle, the callback still fires by then so a screen can't be left blank.
//
// (Migrated off the now-deprecated InteractionManager.runAfterInteractions, which
// RN 0.85 flags for removal in favour of requestIdleCallback.)

import { useCallback, useEffect } from 'react';
import type { DependencyList } from 'react';
import { useFocusEffect } from '@react-navigation/native';

// Fire the deferred callback by this deadline even if the JS thread never idles.
const IDLE_TIMEOUT_MS = 500;

// useEffect variant: runs `effect` after interactions whenever `deps` change
// (including the initial mount). `effect` may return a cleanup function.
export function useAfterInteractions(
  effect: () => void | (() => void),
  deps: DependencyList,
) {
  useEffect(() => {
    let cleanup: void | (() => void);
    const handle = requestIdleCallback(
      () => {
        cleanup = effect();
      },
      { timeout: IDLE_TIMEOUT_MS },
    );
    return () => {
      cancelIdleCallback(handle);
      if (typeof cleanup === 'function') cleanup();
    };
    // `deps` is the caller's dependency surface, mirroring useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// useFocusEffect variant: runs `effect` after interactions each time the screen
// gains focus. `effect` may return a cleanup function, same as useFocusEffect.
// Pass the effect memoized with useCallback so it is stable across renders.
export function useDeferredFocusEffect(effect: () => void | (() => void)) {
  useFocusEffect(
    useCallback(() => {
      let cleanup: void | (() => void);
      const handle = requestIdleCallback(
        () => {
          cleanup = effect();
        },
        { timeout: IDLE_TIMEOUT_MS },
      );
      return () => {
        cancelIdleCallback(handle);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [effect]),
  );
}
