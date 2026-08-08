// <copyright file="playback-service.ts" company="John Narey">
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

import TrackPlayer, { Event, State } from 'react-native-track-player';
import {
  buildAndroidAutoTree,
  handleAndroidAutoBrowse,
  playAndroidAutoMediaId,
  handleAndroidAutoLove,
} from './androidAuto';
import { ensurePlayerSetup } from './playerSetup';

// Runs in a background thread — handles remote control events from
// lock screen, notification, Android Auto, and Bluetooth controls.
export default async function () {
  // Ensure the player is initialised in the headless context (Android Auto can
  // fire remote-browse before the UI mounts and calls setupPlayer itself).
  await ensurePlayerSetup();

  TrackPlayer.addEventListener(Event.RemotePlay,     ()      => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause,    ()      => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext,     ()      => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, ()      => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek,     (event) => TrackPlayer.seekTo(event.position));
  TrackPlayer.addEventListener(Event.RemoteStop,     ()      => TrackPlayer.reset());

  // Android Auto: a track was selected in the car (mediaId === track path).
  TrackPlayer.addEventListener(Event.RemotePlayId, (event) => playAndroidAutoMediaId(event.id));
  // Android Auto: the car opened a not-yet-loaded browse node.
  (TrackPlayer.addEventListener as (e: string, cb: (event: { mediaId: string }) => void) => void)(
    'remote-browse',
    (event) => handleAndroidAutoBrowse(event.mediaId),
  );
  // Android Auto: the user tapped the heart/love button in the car.
  (TrackPlayer.addEventListener as (e: string, cb: () => void) => void)(
    'remote-love',
    () => handleAndroidAutoLove(),
  );

  // Build the car's menu now rather than waiting to be asked. The car requests the root the
  // instant it binds the service — measured 0.3s BEFORE this bundle finishes starting — so that
  // request lands with nothing listening, and nothing ever asks again: the menu stays empty for
  // the whole session. Publishing up front means the answer is ready when the request arrives.
  buildAndroidAutoTree().catch(() => { /* logged inside; the car retries on next connect */ });

  let wasPlayingBeforeDuck = false;

  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    if (event.permanent || event.paused) {
      const { state } = await TrackPlayer.getPlaybackState();
      wasPlayingBeforeDuck = state === State.Playing;
      await TrackPlayer.pause();
    } else if (wasPlayingBeforeDuck) {
      wasPlayingBeforeDuck = false;
      await TrackPlayer.play();
    }
  });
};
