// <copyright file="transfers.js" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import api from './api';

export const getStatus = async ({ signal } = {}) => {
  const { data } = await api.get('/transfers/status', {
    signal,
    timeout: 10_000,
  });
  for (const direction of ['downloads', 'uploads']) {
    const status = data?.[direction];
    if (
      !status ||
      !Number.isSafeInteger(status.activeCount) ||
      status.activeCount < 0 ||
      !Number.isSafeInteger(status.queuedCount) ||
      status.queuedCount < 0 ||
      !Array.isArray(status.transfers)
    ) {
      throw new Error('Invalid transfer status response');
    }
  }

  return data;
};

export const getUploadsPage = async ({
  page = 0,
  pageSize = 250,
  signal,
} = {}) => {
  const response = await api.get(
    `/transfers/uploads?page=${page}&pageSize=${pageSize}`,
    { signal, timeout: 10_000 },
  );
  const rawTotal = response.headers['x-uploads-total-pending'];
  const total =
    rawTotal === '' || rawTotal == null ? Number.NaN : Number(rawTotal);
  if (
    !Array.isArray(response.data) ||
    !Number.isSafeInteger(total) ||
    total < 0
  ) {
    throw new Error('Invalid paged uploads response');
  }

  return { totalPending: total, transfers: response.data };
};

const isQueueCount = (value) => Number.isSafeInteger(value) && value >= 0;

export const getUploadsQueue = async ({
  username,
  page = 0,
  pageSize = 250,
  signal,
} = {}) => {
  const { data } = await api.get('/transfers/upload-queue', {
    params: { username: username ?? undefined, page, pageSize },
    signal,
    timeout: 10_000,
  });
  if (
    !data ||
    !Array.isArray(data.users) ||
    !Array.isArray(data.transfers) ||
    !isQueueCount(data.totalPending) ||
    !isQueueCount(data.userTotalPending) ||
    !isQueueCount(data.page) ||
    (data.username !== null && typeof data.username !== 'string') ||
    data.users.some(
      (user) =>
        typeof user.username !== 'string' ||
        !isQueueCount(user.pendingCount) ||
        !isQueueCount(user.activeCount) ||
        !isQueueCount(user.waitingCount) ||
        user.pendingCount !== user.activeCount + user.waitingCount,
    ) ||
    data.users.reduce((total, user) => total + user.pendingCount, 0) !==
      data.totalPending
  ) {
    throw new Error('Invalid upload recipient queue response');
  }

  return data;
};

export const getAll = async ({ direction, activeOnly = false, signal }) => {
  const qs = activeOnly ? '?activeOnly=true' : '';
  const response = (
    await api.get(`/transfers/${encodeURIComponent(direction)}s${qs}`, {
      signal,
      timeout: 10_000,
    })
  ).data;

  if (!Array.isArray(response)) {
    console.warn('got non-array response from transfers API', response);
    return undefined;
  }

  return response;
};

export const download = ({
  username,
  files = [],
  destinationFolder = '',
  allowDuplicate = false,
}) => {
  const body = files.map((f) => ({
    ...f,
    destinationFolder: destinationFolder || undefined,
  }));
  return api.post(
    `/transfers/downloads/${encodeURIComponent(username)}`,
    body,
    {
      params: allowDuplicate ? { allowDuplicate: true } : undefined,
    },
  );
};

export const cancel = ({ direction, username, id, remove = false }) => {
  return api.delete(
    `/transfers/${direction}s/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=${remove}`,
  );
};

// Kill switch: cancels every incomplete transfer for a user, or just one of their folders.
// `deny` only applies to uploads with a `directory`: it permanently denies that folder to the
// user going forward, instead of just cancelling what's currently queued/in-flight.
export const cancelAll = ({
  direction,
  username,
  directory,
  remove = false,
  deny,
}) => {
  return api.delete(
    `/transfers/${direction}s/${encodeURIComponent(username)}`,
    { params: { directory, remove, deny } },
  );
};

export const clearCompleted = ({ direction }) => {
  return api.delete(`/transfers/${direction}s/all/completed`);
};

// 'Requested'
// 'Queued, Remotely'
// 'Queued, Locally'
// 'Initializing'
// 'InProgress'
// 'Completed, Succeeded'
// 'Completed, Cancelled'
// 'Completed, TimedOut'
// 'Completed, Errored'
// 'Completed, Rejected'

export const listDownloadFolders = async (path = '') => {
  const response = await api.get('/transfers/downloads/folders', {
    params: { path },
  });
  return response.data;
};

export const createDownloadFolder = async (path) => {
  return api.post('/transfers/downloads/folders', { path });
};

export const getPlaceInQueue = ({ username, id }) => {
  return api.get(
    `/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}/position`,
  );
};

export const isStateRetryable = (state) =>
  state.includes('Completed') && state !== 'Completed, Succeeded';

export const isStateCancellable = (state) =>
  [
    'InProgress',
    'Requested',
    'Queued',
    'Queued, Remotely',
    'Queued, Locally',
    'Initializing',
  ].find((s) => s === state);

export const isStateRemovable = (state) => state.includes('Completed');
