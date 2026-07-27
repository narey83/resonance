// <copyright file="WaveformPreview.jsx" company="John Narey">
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
import { drawWaveform, toPeaks } from '../../lib/waveform';
import React, { useEffect, useRef, useState } from 'react';

// Waveforms are immutable per file and a virtualised list mounts the same row
// repeatedly while scrolling, so results are held for the session. Nulls are
// cached too — a track with no cached waveform must not be re-asked on every
// pass over it.
const cache = new Map();
const inFlight = new Map();

const fetchPeaks = (path) => {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  if (inFlight.has(path)) return inFlight.get(path);

  // cachedOnly: never triggers an analysis. A library scrolling past thousands
  // of rows must not be able to queue a decode per row.
  const request = analysisApi
    .getWaveform(path, { cachedOnly: true })
    .then((data) => {
      const peaks = toPeaks(data);
      cache.set(path, peaks);
      return peaks;
    })
    .catch(() => {
      cache.set(path, null);
      return null;
    })
    .finally(() => inFlight.delete(path));

  inFlight.set(path, request);
  return request;
};

const WaveformPreview = ({ height = 22, mono = false, path, width = 132 }) => {
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const [peaks, setPeaks] = useState(() => cache.get(path) ?? null);

  // Only fetch once the row is actually on screen; the virtualiser mounts a
  // little beyond the viewport, and offscreen rows need not cost a request.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !path) return undefined;
    if (cache.has(path)) {
      setPeaks(cache.get(path));
      return undefined;
    }

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        fetchPeaks(path).then((result) => {
          if (!cancelled) setPeaks(result);
        });
      },
      { rootMargin: '200px' },
    );

    observer.observe(holder);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [path]);

  useEffect(() => {
    if (peaks) drawWaveform(canvasRef.current, peaks, { height, mono, width });
  }, [height, mono, peaks, width]);

  return (
    <span
      className="jb-wave-preview"
      ref={holderRef}
      style={{ height, width }}
      title={peaks ? undefined : 'No waveform analysed yet'}
    >
      {peaks ? <canvas ref={canvasRef} /> : <span className="jb-wave-empty" />}
    </span>
  );
};

export default WaveformPreview;
