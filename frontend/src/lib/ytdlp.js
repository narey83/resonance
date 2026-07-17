// <copyright file="ytdlp.js" company="John Narey">
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

// Mix-length presets mapping a DJ/electronic "mix type" to a duration range.
// maxSeconds 0 = no upper bound (matches the backend min/max convention).
export const DURATION_PRESETS = [
  { value: 'radio', label: 'Radio mix', minSeconds: 150, maxSeconds: 300 },
  {
    value: 'extended',
    label: 'Extended mix',
    minSeconds: 300,
    maxSeconds: 600,
  },
  { value: 'set', label: 'Set', minSeconds: 1_800, maxSeconds: 0 },
];

export const listJobs = () => api.get('/ytdlp/jobs');
export const submitJob = ({
  url,
  outputDirectory,
  audioFormat,
  audioQuality,
  defaultGenre,
  minTrackDurationSeconds,
  maxTrackDurationSeconds,
  convertOnCompletionFormat,
  uploadedAfter,
}) =>
  api.post('/ytdlp/jobs', {
    url,
    outputDirectory,
    audioFormat,
    audioQuality,
    defaultGenre,
    minTrackDurationSeconds,
    maxTrackDurationSeconds,
    convertOnCompletionFormat,
    uploadedAfter,
  });
export const getJobTracks = (jobId) => api.get(`/ytdlp/jobs/${jobId}/tracks`);
export const clearEvents = () => api.delete('/ytdlp/events');
export const clearJobEvents = (jobId) => api.delete(`/ytdlp/events/${jobId}`);
export const removeJob = (jobId) => api.delete(`/ytdlp/jobs/${jobId}`);
export const cancelJob = (jobId) => api.post(`/ytdlp/jobs/${jobId}/cancel`);
export const pauseJob = (jobId) => api.post(`/ytdlp/jobs/${jobId}/pause`);
export const resumeJob = (jobId) => api.post(`/ytdlp/jobs/${jobId}/resume`);
export const retryFailedTracks = (jobId) =>
  api.post(`/ytdlp/jobs/${jobId}/retry-failed`);
export const reconcileJob = (jobId) =>
  api.post(`/ytdlp/jobs/${jobId}/reconcile`);

export const cancelTrack = (trackId) => api.delete(`/ytdlp/tracks/${trackId}`);
export const getTagErrors = () => api.get('/ytdlp/tag-errors');
export const retryTags = (trackId) =>
  api.post(`/ytdlp/tracks/${trackId}/retry-tags`);
export const setTags = (trackId, { album, artist, title }) =>
  api.post(`/ytdlp/tracks/${trackId}/tags`, { album, artist, title });

export const search = (
  q,
  { duration, limit = 25, sort, type, uploadDate } = {},
) => {
  const params = new URLSearchParams({ limit, q });
  if (type) params.append('type', type);
  if (duration) params.append('duration', duration);
  if (uploadDate) params.append('uploadDate', uploadDate);
  if (sort) params.append('sort', sort);
  return api.get(`/ytdlp/search?${params.toString()}`);
};

export const resolveUrl = (url) =>
  api.get(`/ytdlp/resolve?url=${encodeURIComponent(url)}`);

export const listSubscriptions = () => api.get('/ytdlp/subscriptions');
export const addSubscription = ({
  channelUrl,
  outputDirectory,
  audioFormat,
  audioQuality,
  defaultGenre,
  minTrackDurationSeconds,
  maxTrackDurationSeconds,
  convertOnCompletionFormat,
  uploadedAfter,
} = {}) =>
  api.post('/ytdlp/subscriptions', {
    channelUrl,
    outputDirectory,
    audioFormat,
    audioQuality,
    defaultGenre,
    minTrackDurationSeconds,
    maxTrackDurationSeconds,
    convertOnCompletionFormat,
    uploadedAfter,
  });
export const updateSubscription = (id, changes) =>
  api.patch(`/ytdlp/subscriptions/${id}`, changes);
export const removeSubscription = (id) =>
  api.delete(`/ytdlp/subscriptions/${id}`);
export const checkSubscription = (id) =>
  api.post(`/ytdlp/subscriptions/${id}/check`);

export const getVersions = () => api.get('/ytdlp/versions');
export const checkForUpdate = () => api.get('/ytdlp/update-check');
export const installUpdate = () => api.post('/ytdlp/update');

export const backfillDurations = () => api.post('/ytdlp/backfill-durations');

export const getCookieStatus = () => api.get('/ytdlp/cookies');
export const uploadCookies = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/ytdlp/cookies', fd);
};

export const deleteCookies = () => api.delete('/ytdlp/cookies');
