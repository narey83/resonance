// <copyright file="useTrackLoudness.js" company="John Narey">
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

import { analyseTrack } from '../components/Shared/WaveformPreview';
import { getLoudness } from '../lib/analysis';
import { useEffect, useState } from 'react';

// Fetches the current track's cached integrated-loudness analysis
// (integrated LUFS, loudness range, true peak), computed server-side by
// ffmpeg's ebur128 filter. Shared by the live loudness meter and
// Performance Mode's pre-gain stage so both react to the same reading and
// a track change only triggers one request, not one per consumer.
const useTrackLoudness = (trackPath, { analyseMissing = false } = {}) => {
  const [loudness, setLoudness] = useState(null);

  useEffect(() => {
    setLoudness(null);
    if (!trackPath) return undefined;

    let cancelled = false;
    // Read the cache first. Starting analysis here used to happen before the audio request and
    // made every play register an analysis queue, even when the backend ultimately found zero
    // missing metrics. A genuine miss is filled only after the player says audio has started.
    //
    // A miss arrives as a null, not a rejection: the endpoint answers 204 while a track is
    // still being analysed, so the "no reading yet" branch is taken on the value rather than
    // in a catch, which is now left to report only genuine failures.
    getLoudness(trackPath)
      .then(async (cached) => {
        if (cached || !analyseMissing) {
          if (!cancelled) setLoudness(cached);
          return;
        }

        await analyseTrack(trackPath);
        if (cancelled) return;

        const analysed = await getLoudness(trackPath);
        if (!cancelled) setLoudness(analysed);
      })
      .catch(() => {
        /* no cached loudness yet — consumers treat it as unknown */
      });

    return () => {
      cancelled = true;
    };
  }, [analyseMissing, trackPath]);

  return loudness;
};

export default useTrackLoudness;
