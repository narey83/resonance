// <copyright file="logs.js" company="John Narey">
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

const LOG_DEDUPE_MS = 60_000;
const recentLogs = new Map();

export const postLog = (level, ...args) => {
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }

      return String(a);
    })
    .join(' ');

  // React can emit the same warning on every render. Forwarding each copy to
  // the backend turns one UI bug into a high-volume database write storm, so
  // send at most one identical entry per minute. Keep the map bounded while
  // pruning expired entries.
  const now = Date.now();
  const fingerprint = `${level}|${message}`;
  const lastSent = recentLogs.get(fingerprint);
  if (lastSent != null && now - lastSent < LOG_DEDUPE_MS) return;

  recentLogs.set(fingerprint, now);
  if (recentLogs.size > 200) {
    for (const [key, timestamp] of recentLogs) {
      if (now - timestamp >= LOG_DEDUPE_MS) recentLogs.delete(key);
    }

    while (recentLogs.size > 200) {
      recentLogs.delete(recentLogs.keys().next().value);
    }
  }

  api.post('/logs', { level, message }).catch(() => {});
};

export const getLogs = async ({
  offset = 0,
  limit = 100,
  level,
  context,
  search,
  from,
  to,
  afterId,
  beforeId,
} = {}) => {
  const params = new URLSearchParams({ offset, limit });

  if (level?.length) {
    for (const l of level) params.append('level', l);
  }

  if (context?.length) {
    for (const c of context) params.append('context', c);
  }

  if (search) params.append('search', search);
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  if (afterId !== undefined && afterId !== null)
    params.append('afterId', afterId);

  if (beforeId !== undefined && beforeId !== null)
    params.append('beforeId', beforeId);

  const response = await api.get(`/logs?${params}`, { timeout: 10_000 });

  return {
    logs: response.data,
    totalCount: Number(response.headers['x-total-count'] ?? 0),
  };
};

// Every context the backend can log under, so the filter list is complete on first paint rather
// than growing as messages happen to arrive.
export const getLogContexts = async () =>
  (await api.get('/logs/contexts')).data;

// The server-side minimum levels, as { level, framework }. Events below these are dropped before
// they ever reach a sink, so the matching filters are inert unless the floor is lowered.
// `framework` covers Microsoft.* (ASP.NET, EF Core, SignalR) and is held higher on purpose.
export const getLogLevel = async () => (await api.get('/logs/level')).data;

// Accepts a partial patch — { level }, { framework }, or both. Omitted fields are left alone.
export const setLogLevel = async (patch) =>
  (await api.put('/logs/level', patch)).data;

// Downloads the backend's recently-captured HTTP traffic as a HAR 1.2 file — the server-side
// counterpart to the mobile app's network log export, for side-by-side latency comparison.
export const getHttpCaptureHar = async () => {
  const response = await api.get('/httpcapture/har', { responseType: 'blob' });
  return response.data;
};

export const clearHttpCapture = () => api.delete('/httpcapture');

export const getLogSummaries = async (days, signal) =>
  (
    await api.get('/logs/summaries', {
      params: { days },
      signal,
      timeout: 10_000,
    })
  ).data;
