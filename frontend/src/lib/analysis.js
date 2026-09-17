// <copyright file="keyAnalysis.js" company="John Narey">
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

// Every metric comes from one backend service and one decode per file; the API mirrors
// that with a single set of endpoints rather than one per metric.
export const METRICS = ['Bpm', 'Key', 'Waveform', 'Loudness'];

// Deliberately no getAll(): GET /analysis walks the whole share in memory and answered 25MB in
// 27 seconds on a 50k-track library. Anything wanting rows takes them from the paged, indexed
// /musiclibrary/tracks query instead (see musicLibrary.getTrackPage).

export const getScanState = async () => (await api.get('/analysis/scan')).data;

// The tag-editing endpoints below key on a masked filename, but the paged library query only
// knows paths. Resolved one row at a time, when someone actually edits that row — resolving the
// whole visible page up front would be 200 lookups nobody asked for.
export const getMaskedFilename = async (path) =>
  (await api.get('/analysis/masked', { params: { path } })).data.maskedFilename;

// The server always analyses key, BPM, loudness and waveform together, whatever `metrics` says.
export const startScan = async (request) => api.post('/analysis/scan', request);

export const cancelScan = async () => api.delete('/analysis/scan');

export const setAnalysis = async (maskedFilename, values) =>
  api.put(`/analysis/${encodeURIComponent(maskedFilename)}`, values);

export const setKey = async (maskedFilename, key) =>
  setAnalysis(maskedFilename, { key });

export const setBpm = async (maskedFilename, bpm) =>
  setAnalysis(maskedFilename, { bpm });

export const clearKey = async (maskedFilename) =>
  api.delete(`/analysis/${encodeURIComponent(maskedFilename)}/key`);

export const clearBpm = async (maskedFilename) =>
  api.delete(`/analysis/${encodeURIComponent(maskedFilename)}/bpm`);

// The backend answers 204 when the file exists but carries no cached analysis yet — the
// normal state while a scan is still decoding it. Axios reports that as a success with an
// empty body, so it is normalised to null here: callers already treat a null as "nothing to
// draw", and a rejection would be indistinguishable from a real failure. A path naming no
// file at all still rejects with a 404.
const dataOrNull = ({ data, status }) => (status === 204 ? null : data);

// cachedOnly never triggers an analysis — required by anything rendering a list,
// where one request per row would otherwise mean one ffmpeg decode per row.
export const getWaveform = async (path, { bars, cachedOnly = false } = {}) =>
  dataOrNull(
    await api.get('/analysis/waveform', {
      params: { bars, cachedOnly, path },
    }),
  );

export const getLoudness = async (path) =>
  dataOrNull(await api.get('/analysis/loudness', { params: { path } }));
