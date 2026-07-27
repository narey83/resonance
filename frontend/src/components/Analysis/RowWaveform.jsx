// <copyright file="RowWaveform.jsx" company="John Narey">
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

import * as analysisApi from '../../lib/analysis';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

// Same palette and per-band alpha as the player's seek bar, so a track looks
// like itself in both places.
const BAND_COLOURS = { high: '#f5f5f5', low: '#2f6fed', mid: '#ff8a3d' };
const ZOOM_LEVELS = [1, 2, 4, 8, 16];
const HEIGHT = 132;

const peakOf = (array) => {
  let max = 0;
  for (const v of array) if (v > max) max = v;
  return max || 1;
};

const RowWaveform = ({ track }) => {
  const canvasRef = useRef(null);
  const scrollRef = useRef(null);
  const peaksRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    peaksRef.current = null;

    analysisApi
      .getWaveform(track.originalFilename)
      .then((data) => {
        if (cancelled) return;
        if (!data?.overallPeaks?.length) {
          setState('empty');
          return;
        }

        peaksRef.current = {
          high: new Float32Array(data.highPeaks),
          low: new Float32Array(data.lowPeaks),
          mid: new Float32Array(data.midPeaks),
          overall: new Float32Array(data.overallPeaks),
        };
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [track.originalFilename]);

  useEffect(() => {
    if (state !== 'ready') return;
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !scroller || !peaks) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, scroller.clientWidth) * zoom;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${HEIGHT}px`;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(HEIGHT * dpr);

    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, HEIGHT);

    const { high, low, mid, overall } = peaks;
    const halfH = HEIGHT / 2;
    const barWidth = 2;
    const gap = 1;
    const slots = Math.max(1, Math.floor(cssWidth / (barWidth + gap)));
    const perSlot = overall.length / slots;

    const max = peakOf(overall);
    const lowMax = peakOf(low);
    const midMax = peakOf(mid);
    const highMax = peakOf(high);

    // Each slot is the loudest sample in its span, not an average — averaging
    // buries the transients that make a waveform readable at a glance.
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

      // Alpha per band rather than stacked slices: a kick-heavy instant reads
      // solid blue, a hat-heavy one white, a full mix blends toward grey.
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
  }, [state, zoom]);

  if (state === 'loading') {
    return (
      <div className="ka-rowwave ka-rowwave--msg">
        <Loader2
          className="ka-spin-icon"
          size={14}
        />
        Analysing…
      </div>
    );
  }

  if (state !== 'ready') {
    return (
      <div className="ka-rowwave ka-rowwave--msg">
        {state === 'empty'
          ? 'No waveform for this track.'
          : 'Could not load the waveform.'}
      </div>
    );
  }

  return (
    <div className="ka-rowwave">
      <div className="ka-rowwave-tools">
        <button
          className="ka-icon-btn"
          disabled={zoom === ZOOM_LEVELS[0]}
          onClick={() =>
            setZoom((z) => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)])
          }
          title="Zoom out"
          type="button"
        >
          <ZoomOut size={13} />
        </button>
        <span className="ka-rowwave-zoom">{zoom}×</span>
        <button
          className="ka-icon-btn"
          disabled={zoom === ZOOM_LEVELS.at(-1)}
          onClick={() =>
            setZoom(
              (z) =>
                ZOOM_LEVELS[
                  Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)
                ],
            )
          }
          title="Zoom in"
          type="button"
        >
          <ZoomIn size={13} />
        </button>
      </div>
      <div
        className="ka-rowwave-scroll"
        ref={scrollRef}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

export default RowWaveform;
