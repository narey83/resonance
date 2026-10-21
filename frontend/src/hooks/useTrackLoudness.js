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
import api from '../lib/api';
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
    const getCached = () =>
      api.get('/analysis/loudness', { params: { path: trackPath } });

    getCached()
      .then(({ data }) => {
        if (!cancelled) setLoudness({ path: trackPath, data });
      })
      .catch(async () => {
        if (!analyseMissing) return;
        await analyseTrack(trackPath);
        const { data } = await getCached();
        if (!cancelled) setLoudness({ path: trackPath, data });
      })
      .catch(() => {
        /* no cached loudness yet — consumers treat it as unknown */
      });

    return () => {
      cancelled = true;
    };
  }, [analyseMissing, trackPath]);

  return loudness && loudness.path === trackPath ? loudness.data : null;
};

export default useTrackLoudness;
