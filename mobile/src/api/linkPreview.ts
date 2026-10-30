// <copyright file="linkPreview.ts" company="John Narey">
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

import { apiClient } from './client';
import { Image } from 'react-native';
import { onSessionReset, sessionGuard } from '../lib/sessionScope';
import { findFirstUrl } from '../lib/messageLinks';

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

type Entry = { promise: Promise<LinkPreview | null>; value: LinkPreview | null; expires: number };
const cache = new Map<string, Entry>();
const queued = new Set<string>();
const queue: string[] = [];
let active = 0;

onSessionReset(() => { cache.clear(); queue.length = 0; queued.clear(); });
const entryFor = (url: string) => {
  const entry = cache.get(url);
  if (entry && entry.expires > Date.now()) return entry;
  cache.delete(url);
};
export const peekLinkPreview = (url: string): LinkPreview | null => entryFor(url)?.value ?? null;

export const getLinkPreview = (url: string): Promise<LinkPreview | null> => {
  const cached = entryFor(url);
  if (cached) return cached.promise;
  const current = sessionGuard();
  const entry: Entry = { promise: Promise.resolve(null), value: null, expires: Infinity };
  entry.promise = Promise.resolve().then(() => current() ? apiClient.get<LinkPreview>('/linkpreview', { params: { url } }) : null)
    .then(r => {
      if (!current() || !r) return null;
      entry.value = r.data;
      entry.expires = Date.now() + 5 * 60_000;
      if (r.data.imageUrl) void Image.prefetch(r.data.imageUrl).catch(() => {});
      return r.data;
    }).catch(() => { entry.expires = Date.now() + 30_000; return null; });
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(url, entry);
  return entry.promise;
};

const drain = () => {
  while (active < 2 && queue.length) {
    const url = queue.shift()!;
    queued.delete(url);
    active += 1;
    void getLinkPreview(url).finally(() => { active -= 1; drain(); });
  }
};

/** Warm recent visible cards without delaying messages or flooding the server. */
export function prefetchMessagePreviews(messages: readonly { message?: string | null }[]) {
  for (const message of messages.slice(-20).reverse()) {
    const url = findFirstUrl(message.message);
    if (!url || entryFor(url) || queued.has(url) || queue.length >= 24) continue;
    queued.add(url);
    queue.push(url);
  }
  drain();
}
