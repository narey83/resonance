// <copyright file="streamSignatures.js" company="John Narey">
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

import api from './api';

// Path-scoped signatures for stream/artwork URLs. The server signs each library path with a
// secret we never see; we cache the resulting { exp, sig } and append it to media URLs instead
// of the account JWT. Signatures are valid ~24h and reused, so we only call the server for paths
// we haven't signed yet (or that are about to expire). Mirrors mobile's api/streamSignatures.ts.

const cache = new Map(); // path -> { exp (unix seconds), sig }

// Re-sign a little before expiry so a URL in use never goes stale.
const REFRESH_SKEW_SEC = 300;

// Library tracks and artwork are absolute filesystem paths; soulseek/relative download paths use
// other endpoints (still token-authed) and must not be signed here.
const isServerLibraryPath = (path) =>
  typeof path === 'string' && path.startsWith('/');

const needsSigning = (path, nowSec) => {
  if (!isServerLibraryPath(path)) return false;
  const existing = cache.get(path);
  return !existing || existing.exp - nowSec < REFRESH_SKEW_SEC;
};

// Ensure every given library path has a fresh signature cached. Fetches only missing/expiring
// paths. Never throws — on failure the URLs stay unsigned and the caller can retry.
export const ensureSigned = async (paths) => {
  const nowSec = Math.floor(Date.now() / 1_000);
  const todo = [
    ...new Set((paths || []).filter((p) => p && needsSigning(p, nowSec))),
  ];
  if (todo.length === 0) return;

  try {
    const { data } = await api.post('/musiclibrary/sign', { paths: todo });
    for (const [path, sig] of Object.entries(data || {})) {
      if (sig && sig.sig) cache.set(path, sig);
    }
  } catch {
    /* leave unsigned; caller can retry on the next fetch */
  }
};

// Cache the signatures the list endpoints already embed on each row (MusicLibraryController
// stamps Sig/Exp per row), instead of asking for them again. ensureSigned is a POST of every
// path plus a same-size response — on a 48k-track list that is megabytes of round-trip,
// serialised after the fetch and before anything renders, for data we were already sent.
// `key` is the row field holding the path ('path' for tracks, 'coverPath' for artwork rows).
export const seedSignatures = (rows, key = 'path') => {
  for (const row of rows || []) {
    const path = row?.[key];
    if (path && row.sig && typeof row.exp === 'number') {
      cache.set(path, { exp: row.exp, sig: row.sig });
    }
  }
};

// The `&exp=...&sig=...` query fragment for a path, or '' if not signed yet.
export const signedQuery = (path) => {
  const s = cache.get(path);
  return s ? `&exp=${s.exp}&sig=${encodeURIComponent(s.sig)}` : '';
};

export const clearSignatures = () => cache.clear();
