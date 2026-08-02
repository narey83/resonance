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
import { ALL_METRICS, analyzeTrack } from '../../lib/musicLibrary';
import { drawWaveform, toPeaks } from '../../lib/waveform';
import { Loader2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

// Waveforms are immutable per file and a virtualised list mounts the same row
// repeatedly while scrolling, so results are held for the session. Nulls are
// cached too — a track with no cached waveform must not be re-asked on every
// pass over it.
const cache = new Map();
const inFlight = new Map();

// Analysis is queued, not synchronous, so a click watches the cached-only
// endpoint until the peaks appear. ponytail: a fixed poll — worth replacing if
// the analysis service ever pushes per-track progress over the hub.
const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 90;

const waitForPeaks = async (path) => {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });

    // eslint-disable-next-line no-await-in-loop
    const data = await analysisApi
      .getWaveform(path, { cachedOnly: true })
      .catch(() => null);

    if (data) {
      const peaks = toPeaks(data);
      cache.set(path, peaks);
      return peaks;
    }
  }

  return null;
};

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
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState(null);

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

  // One decode yields all four metrics, so the click runs the library's analyse
  // service rather than the waveform-only endpoint, asking for everything with
  // skipAnalysed so a track that already has its key and BPM only gets the parts
  // it is missing. Writing the tags at the end pushes LIBRARY_UPDATED, which is
  // what refreshes the Key and BPM cells in the row.
  const analyse = async (event) => {
    event.stopPropagation();
    setAnalysing(true);
    setError(null);

    try {
      await analyzeTrack([path], { metrics: ALL_METRICS, skipAnalysed: true });
    } catch (requestError) {
      setError(
        requestError?.response?.status === 409
          ? 'An analysis scan is already running — try again once it finishes'
          : 'Could not start the analysis — click to retry',
      );
      setAnalysing(false);
      return;
    }

    const result = await waitForPeaks(path);
    setPeaks(result);
    setError(result ? null : 'Analysis did not finish — click to retry');
    setAnalysing(false);
  };

  if (!peaks) {
    return (
      <button
        className="jb-wave-analyse"
        disabled={analysing}
        onClick={analyse}
        onDoubleClick={(event) => event.stopPropagation()}
        ref={holderRef}
        style={{ height, width }}
        title={
          analysing
            ? 'Analysing — key, BPM, waveform and loudness…'
            : error ?? 'Not analysed yet — click to analyse'
        }
        type="button"
      >
        {analysing ? (
          <Loader2
            className="jb-spin"
            size={12}
          />
        ) : (
          <span
            className={`jb-wave-empty${error ? ' jb-wave-empty--failed' : ''}`}
          />
        )}
      </button>
    );
  }

  return (
    <span
      className="jb-wave-preview"
      ref={holderRef}
      style={{ height, width }}
    >
      <canvas ref={canvasRef} />
    </span>
  );
};

export default WaveformPreview;
