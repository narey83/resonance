// <copyright file="reports.js" company="John Narey">
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

const buildParameters = (parameters) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(parameters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }

  return qs.toString();
};

export const getSummary = async ({ start, end, direction, username } = {}) => {
  const q = buildParameters({ start, end, direction, username });
  return (await api.get(`/telemetry/reports/transfers/summary?${q}`)).data;
};

export const getHistogram = async ({
  start,
  end,
  interval = 60,
  direction,
  username,
} = {}) => {
  const q = buildParameters({ start, end, interval, direction, username });
  return (await api.get(`/telemetry/reports/transfers/histogram?${q}`)).data;
};

export const getLeaderboard = async ({
  direction,
  start,
  end,
  sortBy = 'TotalBytes',
  limit = 10,
  offset = 0,
} = {}) => {
  const q = buildParameters({ direction, start, end, sortBy, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/leaderboard?${q}`)).data;
};

export const getDirectories = async ({
  start,
  end,
  limit = 10,
  offset = 0,
} = {}) => {
  const q = buildParameters({ start, end, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/directories?${q}`)).data;
};

export const getTopFiles = async ({
  start,
  end,
  limit = 10,
  offset = 0,
} = {}) => {
  const q = buildParameters({ start, end, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/files?${q}`)).data;
};

export const getExceptionsPareto = async ({
  direction,
  start,
  end,
  limit = 10,
  offset = 0,
} = {}) => {
  if (!direction) return [];
  const q = buildParameters({ direction, start, end, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/exceptions/pareto?${q}`))
    .data;
};

export const getUserDetail = async ({ username, start, end } = {}) => {
  const q = buildParameters({ start, end });
  return (
    await api.get(
      `/telemetry/reports/transfers/users/${encodeURIComponent(username)}?${q}`,
    )
  ).data;
};

export const getExceptions = async ({
  direction,
  start,
  end,
  username,
  limit = 50,
  offset = 0,
} = {}) => {
  const q = buildParameters({ direction, start, end, username, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/exceptions?${q}`)).data;
};

export const getUserList = async ({
  start,
  end,
  search,
  sortBy = 'LastSeen',
  sortOrder = 'DESC',
  limit = 25,
  offset = 0,
} = {}) => {
  const q = buildParameters({
    start,
    end,
    search,
    sortBy,
    sortOrder,
    limit,
    offset,
  });
  const res = await api.get(`/telemetry/reports/transfers/users?${q}`);
  return {
    items: res.data,
    total: Number.parseInt(res.headers['x-total-count'] ?? '0', 10),
  };
};

export const getUserTransfers = async ({
  username,
  direction,
  start,
  end,
  sortOrder = 'DESC',
  search,
  limit = 25,
  offset = 0,
  includeTotal = true,
} = {}) => {
  const q = buildParameters({
    direction,
    start,
    end,
    sortOrder,
    search,
    limit,
    offset,
    includeTotal,
  });
  const res = await api.get(
    `/telemetry/reports/transfers/users/${encodeURIComponent(username)}/transfers?${q}`,
  );
  return {
    items: res.data,
    total: Number.parseInt(res.headers['x-total-count'] ?? '0', 10),
  };
};

/**
 * Every finished transfer across all peers, newest first. The transfers list endpoint only carries
 * in-flight transfers plus the most recent completions, so this is the only route to the rest of
 * the history. `total` is a lower bound used to indicate that another page exists; `totalBytes`
 * covers the returned page rather than forcing a full-history aggregate on every request.
 */
export const getTransferHistory = async ({
  direction,
  state,
  start,
  end,
  sortOrder = 'DESC',
  search,
  limit = 50,
  offset = 0,
} = {}) => {
  const q = buildParameters({
    direction,
    state,
    start,
    end,
    sortOrder,
    search,
    limit,
    offset,
  });
  const res = await api.get(`/telemetry/reports/transfers/history?${q}`);
  return {
    items: res.data,
    total: Number.parseInt(res.headers['x-total-count'] ?? '0', 10),
    totalBytes: Number.parseInt(res.headers['x-total-bytes'] ?? '0', 10),
  };
};

/**
 * The full chain of attempts leading up to a transfer, oldest first: the failed attempt(s) that
 * were retried, if any, followed by the transfer itself.
 */
export const getTransferAttempts = async (id) => {
  const res = await api.get(
    `/telemetry/reports/transfers/history/${encodeURIComponent(id)}/attempts`,
  );
  return res.data;
};

export const getUserEventCounts = async ({ usernames, start } = {}) => {
  const q = start ? `?start=${encodeURIComponent(start)}` : '';
  return (
    await api.post(`/telemetry/reports/users/event-counts${q}`, usernames)
  ).data;
};

export const getUserNetworkInfo = async ({ username } = {}) => {
  try {
    return (
      await api.get(
        `/telemetry/reports/transfers/users/${encodeURIComponent(username)}/network`,
      )
    ).data;
  } catch {
    return null;
  }
};

export const getHeatmap = async ({ start, end, direction } = {}) => {
  const q = buildParameters({ start, end, direction });
  return (await api.get(`/telemetry/reports/transfers/heatmap?${q}`)).data;
};

export const getGeography = async ({ start, end, limit = 10 } = {}) => {
  const q = buildParameters({ start, end, limit });
  return (await api.get(`/telemetry/reports/transfers/geography?${q}`)).data;
};

export const getRetryFunnel = async ({ start, end } = {}) => {
  const q = buildParameters({ start, end });
  return (await api.get(`/telemetry/reports/transfers/retries?${q}`)).data;
};

export const getQueueWait = async ({ start, end } = {}) => {
  const q = buildParameters({ start, end });
  return (await api.get(`/telemetry/reports/transfers/queue-wait?${q}`)).data;
};

export const getPeerRetention = async ({ start, end } = {}) => {
  const q = buildParameters({ start, end });
  return (await api.get(`/telemetry/reports/transfers/peers?${q}`)).data;
};

export const getCoverage = async () => {
  return (await api.get('/telemetry/reports/transfers/coverage')).data;
};

export const getSocialActivity = async ({ start, end } = {}) => {
  const q = buildParameters({ start, end });
  return (await api.get(`/telemetry/reports/social?${q}`)).data;
};

export const getUserBrowseEvents = async ({
  username,
  start,
  end,
  limit = 50,
  offset = 0,
} = {}) => {
  const q = buildParameters({ start, end, limit, offset });
  const res = await api.get(
    `/telemetry/reports/transfers/users/${encodeURIComponent(username)}/browse?${q}`,
  );
  return {
    items: res.data,
    total: Number.parseInt(res.headers['x-total-count'] ?? '0', 10),
  };
};
