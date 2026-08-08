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

import { drawWaveform } from '../../lib/waveform';
import { analyseTrack, fetchPeaks } from '../Shared/WaveformPreview';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

const ZOOM_LEVELS = [1, 2, 4, 8, 16];
const HEIGHT = 132;

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

    (async () => {
      // Cheap check first — never triggers a decode, and covers the common case of a
      // track that's already fully analysed.
      let peaks = await fetchPeaks(track.path);
      let error = null;

      // Nothing cached: run the same full analysis (BPM, key, waveform, loudness) every
      // other "click to analyse" row uses, instead of the narrow waveform-only endpoint
      // this used to call directly — that endpoint never fills in BPM/key.
      if (!peaks) {
        ({ error, peaks } = await analyseTrack(track.path));
      }

      if (cancelled) return;
      if (!peaks) {
        setState(error ? 'error' : 'empty');
        return;
      }

      peaksRef.current = peaks;
      setState('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [track.path]);

  useEffect(() => {
    if (state !== 'ready') return;
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !scroller || !peaks) return;

    const cssWidth = Math.max(1, scroller.clientWidth) * zoom;
    drawWaveform(canvas, peaks, { height: HEIGHT, width: cssWidth });
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
