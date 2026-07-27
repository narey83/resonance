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

// A drawn bar spanning more than a handful of stored bars is an overview, and
// there peak is the wrong summary: taking the maximum of ~1000 stored peaks lands
// near the track's loudest moment nearly every time, so every bar draws full
// height and the whole thing reads as a solid block. RMS over the span tracks how
// much energy is actually there, which is what makes an intro, a breakdown and a
// drop distinguishable. Peak still wins once a bar covers only a few milliseconds,
// where an individual transient is the thing worth seeing.
const RMS_ABOVE = 4;

const aggregate = (data, slots, perSlot) => {
  const out = new Float32Array(slots);
  const useRms = perSlot >= RMS_ABOVE;

  for (let slot = 0; slot < slots; slot++) {
    const start = Math.floor(slot * perSlot);
    const end = Math.min(
      data.length,
      Math.max(start + 1, Math.floor((slot + 1) * perSlot)),
    );
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

// Normalising against the raw global peak leaves every RMS bar tiny, and against a
// track's loudest instant leaves a limited master flat. Each band is scaled by the
// largest value actually being drawn, so the picture uses its full height whatever
// the source material.
const maxOf = (array) => {
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

  const o = aggregate(overall, slots, perSlot);
  const l = aggregate(low, slots, perSlot);
  const m = aggregate(mid, slots, perSlot);
  const h = aggregate(high, slots, perSlot);

  const max = maxOf(o);
  const lowMax = maxOf(l);
  const midMax = maxOf(m);
  const highMax = maxOf(h);

  for (let slot = 0; slot < slots; slot++) {
    const totalH = Math.max(1, (o[slot] / max) * halfH);
    const x = slot * (barWidth + gap);

    if (mono) {
      context.fillStyle = monoColour;
      context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
      continue;
    }

    // Alpha per band rather than stacked slices: a kick-heavy instant reads
    // solid blue, a hat-heavy one white, a full mix blends toward grey. The
    // 1.4/0.9 weights keep bass and highs perceptually level against mids.
    context.globalAlpha = Math.min(1, (l[slot] / lowMax) * 1.4);
    context.fillStyle = BAND_COLOURS.low;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

    context.globalAlpha = Math.min(1, m[slot] / midMax);
    context.fillStyle = BAND_COLOURS.mid;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);

    context.globalAlpha = Math.min(1, (h[slot] / highMax) * 0.9);
    context.fillStyle = BAND_COLOURS.high;
    context.fillRect(x, halfH - totalH, barWidth, totalH * 2);
  }

  context.globalAlpha = 1;
};
