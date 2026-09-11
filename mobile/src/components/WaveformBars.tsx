// <copyright file="WaveformBars.tsx" company="John Narey">
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

import React, { memo, useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';

const BAR_WIDTH = 2;
const BAR_GAP = 1;

// Mirrors the web player's resampling (frontend/src/lib/waveform.js) so both draw the same
// shape. Once a bar spans several stored peaks, the maximum lands near the track's loudest
// moment almost every time and the whole waveform reads as a solid block; RMS over the span
// keeps an intro, a breakdown and a drop distinguishable.
const RMS_ABOVE = 4;

const resamplePeaks = (data: Float32Array, slots: number): Float32Array => {
  const out = new Float32Array(slots);
  const useRms = data.length / slots >= RMS_ABOVE;

  for (let slot = 0; slot < slots; slot++) {
    const start = Math.floor((slot / slots) * data.length);
    const end = Math.min(data.length, Math.max(start + 1, Math.floor(((slot + 1) / slots) * data.length)));
    if (end <= start) continue;

    if (useRms) {
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i] * data[i];
      out[slot] = Math.sqrt(sum / (end - start));
    } else {
      let peak = 0;
      for (let i = start; i < end; i++) if (data[i] > peak) peak = data[i];
      out[slot] = peak;
    }
  }

  return out;
};

// One path of mirrored bars rather than one element per bar: a phone-width waveform is well
// over a hundred bars, and a single path keeps it to one native view to lay out and draw.
const buildPath = (peaks: Float32Array, width: number, height: number): string => {
  const slots = Math.max(1, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
  const values = resamplePeaks(peaks, slots);

  // Scaled by the largest bar actually drawn, so quiet masters still use the full height.
  let max = 0;
  for (const v of values) if (v > max) max = v;
  max = max || 1;

  const mid = height / 2;
  let d = '';
  for (let slot = 0; slot < slots; slot++) {
    const half = Math.max(0.5, (values[slot] / max) * mid);
    const x = slot * (BAR_WIDTH + BAR_GAP);
    d += `M${x} ${(mid - half).toFixed(1)}h${BAR_WIDTH}v${(half * 2).toFixed(1)}h${-BAR_WIDTH}Z`;
  }
  return d;
};

/** A track's waveform as mirrored bars, filling `width` × `height` in a single colour. */
export const WaveformBars = memo(function WaveformBars({ peaks, width, height, color }: {
  peaks: Float32Array; width: number; height: number; color: string;
}) {
  const d = useMemo(() => buildPath(peaks, width, height), [peaks, width, height]);
  return (
    <Svg height={height} width={width}>
      <Path d={d} fill={color} />
    </Svg>
  );
});
