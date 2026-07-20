// <copyright file="logs.ts" company="John Narey">
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

// Mirrors the backend LogRecord (camelCased by the SignalR/JSON serializers).
export interface LogRecord {
  timestamp:   string;
  level:       string;
  context:     string | null;
  subContext:  string | null;
  message:     string | null;
  exception:   string | null;
}

export interface LogQuery {
  offset?: number;
  limit?:  number;
  level?:  string[];
  context?: string;
  search?: string;
  from?:   string;
  to?:     string;
}

export interface LogPage {
  items: LogRecord[];
  total: number;
}

const totalCount = (headers: Record<string, unknown>): number =>
  Number.parseInt(String(headers['x-total-count'] ?? '0'), 10);

// Paginated, filtered query of historical log entries from persistent storage.
export const getLogs = ({
  offset = 0,
  limit = 100,
  level,
  context,
  search,
  from,
  to,
}: LogQuery = {}): Promise<LogPage> => {
  const params = new URLSearchParams();
  params.set('offset', String(offset));
  params.set('limit', String(limit));
  if (level?.length) for (const l of level) params.append('level', l);
  if (context) params.set('context', context);
  if (search) params.set('search', search);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  return apiClient
    .get<LogRecord[]>(`/logs?${params.toString()}`)
    .then(r => ({ items: r.data, total: totalCount(r.headers as Record<string, unknown>) }));
};
