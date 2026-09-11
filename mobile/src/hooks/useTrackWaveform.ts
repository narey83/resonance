// <copyright file="useTrackWaveform.ts" company="John Narey">
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

import { useEffect, useRef, useState } from 'react';
import { getWaveform } from '../api/musicLibrary';
import { useLibraryActivityStore } from '../store/libraryActivityStore';

// A file's waveform never changes, so peaks are held for the session: the player remounts on
// every open and a queue revisits the same tracks. A track with no waveform is remembered too,
// but only for a few minutes, since it can be analysed at any time and the next play should
// pick that up. Failed requests aren't remembered at all -- the next mount just asks again.
const MISS_RETRY_MS = 5 * 60_000;
const MAX_ENTRIES = 100;

// The server announces every finished analysis (LIBRARY_UPDATED -> libraryRevision), at most once a
// second during a scan. A track still showing no waveform is asked about again once those settle.
const RECHECK_AFTER_UPDATE_MS = 1500;

const cache = new Map<string, { peaks: Float32Array | null; at: number }>();
const inFlight = new Map<string, Promise<Float32Array | null>>();

// Only server library files have analysis: peer streams (soulseek://) and on-device files
// (file://, content://) have nothing to look up.
const isLibraryPath = (path: string) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(path);

const cached = (path: string): Float32Array | null | undefined => {
  const hit = cache.get(path);
  if (!hit) return undefined;
  if (!hit.peaks && Date.now() - hit.at > MISS_RETRY_MS) return undefined;
  return hit.peaks;
};

const remember = (path: string, peaks: Float32Array | null) => {
  cache.delete(path);
  cache.set(path, { peaks, at: Date.now() });
  // Map iteration is insertion order, so the first key is the least recently stored.
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
};

const load = (path: string): Promise<Float32Array | null> => {
  const existing = inFlight.get(path);
  if (existing) return existing;

  const request = getWaveform(path)
    .then((data) => {
      const peaks = data?.overallPeaks?.length ? Float32Array.from(data.overallPeaks) : null;
      remember(path, peaks);
      return peaks;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(path));

  inFlight.set(path, request);
  return request;
};

/**
 * Drops remembered "no waveform" results for these tracks, so the next time one is shown the
 * player asks again. Called when an analysis is started for them.
 */
export const forgetWaveformMisses = (paths: string[]) => {
  for (const path of paths) {
    if (cache.get(path)?.peaks === null) cache.delete(path);
  }
};

/** The track's waveform peaks when it has been analysed; null otherwise (or while loading). */
export function useTrackWaveform(path: string | null | undefined): Float32Array | null {
  const [peaks, setPeaks] = useState<Float32Array | null>(() => (path ? cached(path) ?? null : null));
  const revision = useLibraryActivityStore((s) => s.libraryRevision);
  const seenRevision = useRef(revision);

  useEffect(() => {
    if (!path || !isLibraryPath(path)) {
      setPeaks(null);
      return undefined;
    }

    const hit = cached(path);
    if (hit !== undefined) {
      setPeaks(hit);
      return undefined;
    }

    setPeaks(null);
    let cancelled = false;
    load(path).then((result) => {
      if (!cancelled) setPeaks(result);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // An analysis finished somewhere: if this track still has no waveform, it may be the one that
  // just got one, so drop the remembered miss and ask again.
  useEffect(() => {
    if (revision === seenRevision.current) return undefined;
    seenRevision.current = revision;
    if (!path || !isLibraryPath(path) || peaks) return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cache.get(path)?.peaks === null) cache.delete(path);
      load(path).then((result) => {
        if (!cancelled && result) setPeaks(result);
      });
    }, RECHECK_AFTER_UPDATE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [revision, path, peaks]);

  return peaks;
}
