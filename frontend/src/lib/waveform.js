// <copyright file="waveform.js" company="John Narey">
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

// Shared waveform rendering, so the library preview, the analysis row viewer and
// the player's seek bar all draw a track the same way.
export const BAND_COLOURS = { high: '#f5f5f5', low: '#2f6fed', mid: '#ff8a3d' };

const peakOf = (array) => {
  let max = 0;
  for (const v of array) if (v > max) max = v;
  return max || 1;
};

/**
 * Converts an API waveform response into typed arrays ready to draw.
 * @param {object} data the /analysis/waveform response.
 * @returns {object|null} the four bands, or null if the response carried no peaks.
 */
export const toPeaks = (data) => {
  if (!data?.overallPeaks?.length) return null;
  return {
    high: new Float32Array(data.highPeaks),
    low: new Float32Array(data.lowPeaks),
    mid: new Float32Array(data.midPeaks),
    overall: new Float32Array(data.overallPeaks),
  };
};

/**
 * Draws banded peaks onto a canvas, sizing it for the device pixel ratio.
 * @param {HTMLCanvasElement} canvas the target canvas.
 * @param {object} peaks the bands from toPeaks.
 * @param {object} options width/height in CSS pixels, bar geometry, and whether
 *   to colour by frequency band or draw a flat monochrome envelope.
 */
export const drawWaveform = (canvas, peaks, options) => {
  const {
    barWidth = 2,
    gap = 1,
    height,
    mono = false,
    monoColour = '#7d8590',
    width,
  } = options;
  if (!canvas || !peaks || width <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const { high, low, mid, overall } = peaks;
  const halfH = height / 2;
  const slots = Math.max(1, Math.floor(width / (barWidth + gap)));
  const perSlot = overall.length / slots;

  const max = peakOf(overall);
  const lowMax = peakOf(low);
  const midMax = peakOf(mid);
  const highMax = peakOf(high);

  // Each slot takes the loudest sample in its span rather than the mean —
  // averaging buries the transients that make a waveform readable at a glance.
  for (let slot = 0; slot < slots; slot++) {
    const start = Math.floor(slot * perSlot);
    const end = Math.max(start + 1, Math.floor((slot + 1) * perSlot));
    let o = 0;
    let l = 0;
    let m = 0;
    let h = 0;
    for (let i = start; i < end && i < overall.length; i++) {
      if (overall[i] > o) o = overall[i];
      if (low[i] > l) l = low[i];
      if (mid[i] > m) m = mid[i];
      if (high[i] > h) h = high[i];
    }

    const totalH = Math.max(1, (o / max) * halfH);
    const x = slot * (barWidth + gap);

    if (mono) {
      context.fillStyle = monoColour;
      context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
      continue;
    }

    // Alpha per band rather than stacked slices: a kick-heavy instant reads
    // solid blue, a hat-heavy one white, a full mix blends toward grey. The
    // 1.4/0.9 weights keep bass and highs perceptually level against mids.
    context.globalAlpha = Math.min(1, (l / lowMax) * 1.4);
    context.fillStyle = BAND_COLOURS.low;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

    context.globalAlpha = Math.min(1, m / midMax);
    context.fillStyle = BAND_COLOURS.mid;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

    context.globalAlpha = Math.min(1, (h / highMax) * 0.9);
    context.fillStyle = BAND_COLOURS.high;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
  }

  context.globalAlpha = 1;
};
