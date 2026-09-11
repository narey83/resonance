// <copyright file="useLiveTrack.ts" company="John Narey">
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { MusicTrack, getTracks } from '../api/musicLibrary';
import { useLibraryActivityStore } from '../store/libraryActivityStore';

// The server announces library changes (LIBRARY_UPDATED -> libraryRevision), including an analysis
// writing a track's BPM and key, at most once a second during a scan. Wait for them to settle.
const REFRESH_AFTER_UPDATE_MS = 1500;

// Only server library tracks can change underneath the player: peer streams and on-device files
// (soulseek://, file://, content://) have no server record to re-read.
const isLibraryPath = (path: string) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(path);

/**
 * The playing track as the server currently has it. The player holds the track it was handed when
 * playback started, so an analysis that writes new BPM/key tags would otherwise stay invisible
 * until the next track; this re-reads the track whenever the library changes.
 */
export function useLiveTrack(track: MusicTrack | null): MusicTrack | null {
  const revision = useLibraryActivityStore((s) => s.libraryRevision);
  const [fresh, setFresh] = useState<MusicTrack | null>(null);
  const path = track?.path ?? null;
  const directory = track?.directory ?? null;

  // Only changes made after this track started showing matter; its own data is current until then.
  const baseline = useRef(revision);
  const baselinePath = useRef(path);
  if (baselinePath.current !== path) {
    baselinePath.current = path;
    baseline.current = revision;
  }

  useEffect(() => {
    if (!path || !directory || !isLibraryPath(path) || revision === baseline.current) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await getTracks({ folder: directory, limit: 5000 });
        const match = result.tracks?.find((t) => t.path === path);
        if (!cancelled && match) setFresh(match);
      } catch {
        // keep showing what we have; the next library change tries again
      }
    }, REFRESH_AFTER_UPDATE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, directory, revision]);

  return useMemo(
    () => (track && fresh?.path === track.path ? { ...track, ...fresh } : track),
    [track, fresh],
  );
}
