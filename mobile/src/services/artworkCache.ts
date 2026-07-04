// <copyright file="artworkCache.ts" company="John Narey">
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

import { File } from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';
import { Dimensions, PixelRatio } from 'react-native';
import { recordMediaLoad } from '../store/networkLogStore';

// Pixel size to request for the full-screen player artwork. The cover now spans the whole
// screen width, so request it at the device's physical pixel width (capped) rather than a
// fixed 512 — otherwise it's upscaled and looks soft. Bounded so the server transcode and
// payload stay reasonable on very high-DPI screens.
export const PLAYER_ART_SIZE = Math.min(
  1280,
  Math.round(Dimensions.get('window').width * PixelRatio.get()),
);

// Canonical thumbnail size for every small artwork cell (library/folder/album-grid rows, the
// mini-bar, Android Auto icons, lock-screen metadata). The server resizes + caches per (path,
// size) and expo-image caches per (path, size) cacheKey, so the more sizes we request the more
// duplicate transcodes and downloads of the *same* cover we incur. Collapsing all small cells
// onto one size — and the player/album-hero onto PLAYER_ART_SIZE — means a cover is fetched at
// most twice total instead of once per screen. 192px covers list cells up to ~64pt at 3x.
export const ARTWORK_THUMB_SIZE = 192;

// Warm expo-image's cache for a single artwork URL under its stable cacheKey (path-derived,
// not the rotating URL signature), so a later <Image> render of the same track is instant.
// loadAsync uses the source's cacheKey and the default memory-disk policy. Best-effort.
export async function prefetchArtwork(uri: string, cacheKey?: string): Promise<void> {
  const startedAt = Date.now();
  try {
    await ExpoImage.loadAsync(cacheKey ? { uri, cacheKey } : { uri });
    // Latency is near-zero on a cache hit and the real fetch time on a miss — both useful in the
    // Network Log debug screen for confirming caching and spotting slow artwork loads.
    recordMediaLoad('img', uri, startedAt, true);
  } catch (e) {
    recordMediaLoad('img', uri, startedAt, false, { error: e instanceof Error ? e.message : 'load failed' });
  }
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function getArtworkCacheKey(trackPath: string, size: number): string {
  return `artwork_${djb2(trackPath)}_${size}`;
}

// Pixel sizes covering 1x–3.5x pixel ratios for layout sizes 36, 42, 48, 96, 512.
const EVICT_SIZES = [36, 42, 48, 72, 84, 96, 105, 108, 120, 126, 144, 147, 168, 288, 512];

export async function evictArtwork(trackPaths: string[]): Promise<void> {
  if (trackPaths.length === 0) return;
  await Promise.all(
    trackPaths.flatMap(path =>
      EVICT_SIZES.map(async size => {
        try {
          const cachePath = await ExpoImage.getCachePathAsync(getArtworkCacheKey(path, size));
          if (cachePath) { const f = new File(cachePath); if (f.exists) f.delete(); }
        } catch {}
      })
    ),
  );
}

export async function clearArtworkCache(): Promise<void> {
  try { await ExpoImage.clearDiskCache(); } catch {}
}
