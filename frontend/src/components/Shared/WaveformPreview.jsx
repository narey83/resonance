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

import { useLibraryActivity } from '../../context/LibraryActivityContext';
import useThemeRevision from '../../hooks/useThemeRevision';
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

// A row only needs roughly one peak per physical canvas pixel. Quantising the
// request keeps resized rows sharing cached responses instead of creating a new
// cache entry for every single-pixel width, while still staying sharp on HiDPI
// displays. The unqualified path key remains the full-resolution waveform used
// by the player and inspector.
const previewBars = (width) => {
  const required = Math.max(
    128,
    Math.ceil(width * (window.devicePixelRatio || 1)),
  );
  return Math.min(2 ** Math.ceil(Math.log2(required)), 2_048);
};

const cacheKey = (path, bars) => (bars ? `${path}\u0000${bars}` : path);

// Rows already on screen when peaks arrive from somewhere else — playing a track analyses it
// (via analyseTrack, same as every other trigger) — otherwise sat on their cached miss
// forever: the row is mounted, so it never re-reads the cache, and `hasWaveform: false` from
// the list fetch stops it asking again. Anything that learns a track's peaks calls
// primeWaveformCache and the mounted row for that path redraws.
const listeners = new Set();

export const primeWaveformCache = (path, data) => {
  if (!path || !data?.overallPeaks?.length) return;
  cache.set(path, toPeaks(data));
  for (const listener of listeners) listener(path);
};

// Separate from `listeners` above: that one fires when peaks *arrive*, this one fires when a
// path *starts or stops* being analysed — a row already on screen when a run starts elsewhere
// (its own mount-time `running.has(path)` check happened earlier and found nothing) would
// otherwise never learn one is now in flight and sit there showing its idle "not analysed"
// state throughout, instead of the same spinner a row that started the run itself gets.
const runningListeners = new Set();

// Analysis is queued, not synchronous, so a click watches the cached-only endpoint until the
// peaks appear. ponytail: a fixed poll — worth replacing if the analysis service ever pushes
// per-track progress over the hub.
const POLL_INTERVAL_MS = 2_000;

// The server announces each finished analysis (LIBRARY_UPDATED -> libraryRevision), at most once
// a second during a scan; a surface still showing no waveform asks again once those settle.
const RECHECK_AFTER_UPDATE_MS = 1_500;

// startAnalysis retries a 409 (queue busy) this many times before giving up — generous, since
// there is one analysis queue for the whole application and a large bulk scan can legitimately
// hold it for a while.
const START_POLL_ATTEMPTS = 300;

// waitForPeaks retries this many times once a scan has actually accepted the request. Shorter
// than the above on purpose: one track's own decode is seconds once it's actually being
// processed, so the only thing worth waiting out here is sitting behind a busy queue, not the
// same 10-minute ceiling startAnalysis budgets for queue contention. Keeping it short matters
// for a genuine per-file failure the backend can't fully rule out (e.g. a file staying locked
// by something else, like still being actively streamed for playback, for longer than its own
// retry-with-backoff covers) — that should surface as "not analysed, click to retry" in a
// reasonable time instead of leaving the caller's spinner running for the full 10 minutes.
const PEAKS_POLL_ATTEMPTS = 90;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// There is one analysis queue for the whole application, so requesting a second track while the
// first is decoding is rejected outright with a 409. Wait for the queue instead of leaving the
// caller to notice and ask again.
const startAnalysis = async (path) => {
  for (let attempt = 0; attempt < START_POLL_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await analyzeTrack([path], { metrics: ALL_METRICS, skipAnalysed: true });
      return null;
    } catch (error) {
      if (error?.response?.status !== 409) {
        return 'Could not start the analysis — click to retry';
      }

      // eslint-disable-next-line no-await-in-loop
      await delay(POLL_INTERVAL_MS);
    }
  }

  return 'The analysis queue stayed busy — click to retry';
};

const waitForPeaks = async (path) => {
  for (let attempt = 0; attempt < PEAKS_POLL_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await delay(POLL_INTERVAL_MS);

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

// An analysis outlives the row that started it: the list is virtualised, so
// scrolling the row out of view — or a library refresh re-rendering the list —
// unmounts it mid-run. Keyed by path so the row that comes back rejoins the run
// instead of sitting there empty until something else happens to refetch.
const running = new Map();

// The one trigger every "analyse this track" surface shares — the manual button on a row's
// waveform placeholder, the "now playing" waveform's own auto-analysis, RowWaveform on the
// Analysis page. Always the full 4-metric scan, never a narrower one: a track played before
// it was ever scanned used to top up just its BPM/key through a separate, narrower request,
// which (see AudioAnalyzer.AnalyseAsync on the backend) decodes only a short leading window
// instead of the whole file — fine for BPM's beat tracking, unreliable for key detection on
// anything with a long intro. Sharing this one path means every trigger gets the same decode.
export const analyseTrack = (path) => {
  if (running.has(path)) return running.get(path);

  // A click means "look again", so the miss cached on the way in must not
  // outlive it and leave a remounted row reading a stale null.
  cache.delete(path);

  const run = (async () => {
    const startError = await startAnalysis(path);
    if (startError) return { error: startError, peaks: null };

    const peaks = await waitForPeaks(path);
    return {
      error: peaks ? null : 'Analysis did not finish — click to retry',
      peaks,
    };
  })().finally(() => {
    running.delete(path);
    for (const listener of runningListeners) listener(path);
  });

  running.set(path, run);
  for (const listener of runningListeners) listener(path);
  return run;
};

// cachedOnly, never triggers a decode — the fast path for a track that's already analysed.
// Exported so other "show this track's waveform" surfaces (RowWaveform on the Analysis page)
// share this cache/in-flight bookkeeping instead of hand-rolling their own fetch.
export const fetchPeaks = (path, { bars } = {}) => {
  // A full-resolution response is always sufficient for a preview too.
  if (cache.has(path) && cache.get(path))
    return Promise.resolve(cache.get(path));

  const key = cacheKey(path, bars);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inFlight.has(key)) return inFlight.get(key);

  // cachedOnly: never triggers an analysis. A library scrolling past thousands
  // of rows must not be able to queue a decode per row.
  const request = analysisApi
    .getWaveform(path, { bars, cachedOnly: true })
    .then((data) => {
      const peaks = toPeaks(data);
      cache.set(key, peaks);
      return peaks;
    })
    .catch(() => {
      cache.set(key, null);
      return null;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
};

// `hasWaveform` is what the library list rows carry. Explicit false means the server already
// told us there are no cached peaks, so the row renders its analyse button without asking —
// scrolling a page of 200 rows used to fire 200 requests, ~98% of which came back empty after
// two stat() calls each on the music mount, starving the next page's fetch of a connection.
// undefined means "not stated" (the player, mixtapes, play history), which asks as before.
const WaveformPreview = ({
  hasWaveform,
  height = 22,
  mono = false,
  onAnalysingChange,
  onSeek,
  path,
  width = 132,
}) => {
  const bars = previewBars(width);
  const previewKey = cacheKey(path, bars);
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const [peaks, setPeaks] = useState(
    () => cache.get(path) ?? cache.get(previewKey) ?? null,
  );
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState(null);
  const themeRevision = useThemeRevision();
  const libraryRevision = useLibraryActivity()?.libraryRevision ?? 0;
  const seenRevision = useRef(libraryRevision);

  // Lets a row's other cells (key/BPM/LUFS) show the same spinner this one does, instead of
  // looking finished while the analysis this button started is still running. `onAnalysingChange`
  // is deliberately not a dependency: the caller passes a fresh inline closure every render, and
  // re-running this on every one of those would toggle it off and back on for no reason.
  useEffect(() => {
    onAnalysingChange?.(analysing);
    return () => {
      if (analysing) onAnalysingChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysing]);

  // Only fetch once the row is actually on screen; the virtualiser mounts a
  // little beyond the viewport, and offscreen rows need not cost a request.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !path) return undefined;

    let cancelled = false;

    // Rejoin an analysis this row started before it was unmounted, so the spinner
    // and the result survive scrolling and library refreshes.
    if (running.has(path)) {
      setAnalysing(true);
      running.get(path).then(({ error: runError, peaks: result }) => {
        if (cancelled) return;
        setPeaks(result);
        setError(runError);
        setAnalysing(false);
      });

      return () => {
        cancelled = true;
      };
    }

    // A remembered miss is stale once the list says the track has a waveform: it was analysed
    // after this row last asked (by another row, the Analysis page, the player or the phone app).
    if (hasWaveform === true && cache.get(previewKey) === null)
      cache.delete(previewKey);

    if (cache.has(path) || cache.has(previewKey)) {
      setPeaks(cache.get(path) ?? cache.get(previewKey));
      return undefined;
    }

    // The list already told us there is nothing cached — don't spend a request finding out.
    if (hasWaveform === false) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        fetchPeaks(path, { bars }).then((result) => {
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
  }, [bars, hasWaveform, path, previewKey]);

  useEffect(() => {
    const listener = (changed) => {
      if (changed === path) setPeaks(cache.get(path));
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [path]);

  // Catches a run that starts *after* this row already mounted (e.g. the row was sitting idle
  // and the "now playing" waveform then started analysing the same path) — the mount-time check
  // above only catches a run already in flight when the row first appears.
  useEffect(() => {
    let cancelled = false;
    const listener = (changed) => {
      if (changed !== path || !running.has(path)) return;
      setAnalysing(true);
      running.get(path).then(({ error: runError, peaks: result }) => {
        if (cancelled) return;
        setPeaks(result);
        setError(runError);
        setAnalysing(false);
      });
    };

    runningListeners.add(listener);
    return () => {
      cancelled = true;
      runningListeners.delete(listener);
    };
  }, [path]);

  // Surfaces without a list's `hasWaveform` (the player, mixtapes, play history) have no other way
  // to hear about an analysis that finished elsewhere, so one still showing nothing asks again
  // after the library changes. List rows are left to `hasWaveform` above, so a scan's steady
  // stream of updates can't turn into a request per visible row.
  useEffect(() => {
    if (libraryRevision === seenRevision.current) return undefined;
    seenRevision.current = libraryRevision;
    if (hasWaveform !== undefined || peaks || analysing || !path)
      return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cache.get(path) === null) cache.delete(path);
      fetchPeaks(path).then((result) => {
        if (!cancelled && result) setPeaks(result);
      });
    }, RECHECK_AFTER_UPDATE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [analysing, hasWaveform, libraryRevision, path, peaks]);

  useEffect(() => {
    if (peaks) drawWaveform(canvasRef.current, peaks, { height, mono, width });
  }, [height, mono, peaks, themeRevision, width]);

  // One decode yields all four metrics, so the click runs the library's analyse
  // service rather than the waveform-only endpoint, asking for everything with
  // skipAnalysed so a track that already has its key and BPM only gets the parts
  // it is missing. Writing the tags at the end pushes LIBRARY_UPDATED, which is
  // what refreshes the Key and BPM cells in the row.
  const analyse = async (event) => {
    event.stopPropagation();
    setAnalysing(true);
    setError(null);

    const { error: runError, peaks: result } = await analyseTrack(path);
    setPeaks(result);
    setError(runError);
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

  const seek = (event) => {
    if (!onSeek) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  };

  return (
    <span
      className="jb-wave-preview"
      onClick={seek}
      onDoubleClick={(event) => event.stopPropagation()}
      ref={holderRef}
      style={{ cursor: onSeek ? 'pointer' : undefined, height, width }}
    >
      <canvas ref={canvasRef} />
    </span>
  );
};

export default WaveformPreview;
