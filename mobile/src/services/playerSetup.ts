// <copyright file="playerSetup.ts" company="John Narey">
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

import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
} from 'react-native-track-player';

// Single shared, idempotent player initialisation.
//
// `setupPlayer()` is async, so anything that touches TrackPlayer before it
// resolves throws "The player is not initialized. Call setupPlayer first."
// Both the UI (PlayerContext) and the headless playback service can be the
// first to reach the player — on a cold Android Auto launch the service runs
// before the UI mounts — so initialisation is memoised here and every early
// caller awaits the same promise.
let setupPromise: Promise<void> | null = null;

export function ensurePlayerSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      try {
        await TrackPlayer.setupPlayer({
          maxCacheSize: 1024 * 256, // 256 MB on-disk cache — fewer re-downloads on repeat plays
          // Buffer generously so brief bandwidth dips (tunnels, weak cellular) don't stall:
          minBuffer:  30,  // keep ≥30 s buffered ahead
          maxBuffer:  120, // read up to 2 min ahead when bandwidth allows
          playBuffer: 5,   // wait for 5 s buffered before (re)starting playback
          backBuffer: 30,  // retain 30 s behind for instant back-seek
        });
      } catch {
        // Already set up (e.g. the headless service initialised it first).
      }
      await TrackPlayer.updateOptions(buildPlayerOptions(false));
    })();
  }
  return setupPromise;
}

// Full options object for TrackPlayer.updateOptions. RNTP's updateOptions is a *full replace* —
// every call rebuilds the notification/media-session config from scratch, so any call that omits
// `capabilities`/`notificationCapabilities` wipes the transport controls (no play/pause/skip on the
// lock screen or shade). Always pass this complete object, toggling only the like state, so the
// controls survive Love-button updates.
export function buildPlayerOptions(isLoved: boolean) {
  return {
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.SetRating,
      // Shade/lock-screen "close": RemoteStop is handled in playback-service.ts with reset(),
      // which stops playback, clears the queue and takes the notification and the media
      // foreground service down with it. Since appKilledPlaybackBehavior is ContinuePlayback,
      // this is the only way to shut the player down without force-stopping the app.
      Capability.Stop,
    ],
    notificationCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SetRating,
      Capability.Stop,
    ],
    likeOptions: { isActive: isLoved, title: isLoved ? 'Unlove' : 'Love' },
    android: {
      // Keep playing when the app leaves the foreground or is swiped out of recents. RNTP's
      // StopPlaybackAndRemoveNotification tears the service down in onTaskRemoved and ends with
      // exitProcess(0) — it kills the whole process, taking playback and the floating bubble with
      // it. This has nothing to do with the notification controls (those come from the
      // capabilities above), so it must stay ContinuePlayback.
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
    },
  };
}
