// <copyright file="analytics.ts" company="John Narey">
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

// Admin-only analytics/reports API — mirrors frontend/src/lib/reports.js.
// Every endpoint here requires the Administrator role server-side
// (backend/Telemetry/API/ReportsController.cs); callers are gated the same
// way in the UI (see store/auth.ts's isAdmin / MoreScreen's adminOnly menu).

import { apiClient } from './client';

export type TransferDirection = 'Download' | 'Upload';

export interface TransferSummary {
  username:         string | null;
  totalBytes:       number;
  count:            number;
  distinctUsers:    number;
  averageSpeed:     number;
  averageWait:      number;
  averageDuration:  number;
}

export interface UserDirectionTransferStatistics {
  total:      number;
  successful: number;
  errored:    number;
  cancelled:  number;
}

export interface TransferExceptionSummaryEntry {
  exception:     string;
  count:         number;
  distinctUsers: number;
}

export interface UserDirectionTransferSummary {
  summary:    Record<string, TransferSummary>;
  statistics: UserDirectionTransferStatistics;
  exceptions: TransferExceptionSummaryEntry[];
}

export interface UserReportSummary {
  username:             string;
  uploadCount:           number;
  downloadCount:         number;
  uploadBytes:           number;
  downloadBytes:         number;
  uploadErrorCount:      number;
  downloadErrorCount:    number;
  uploadAverageSpeed:    number;
  downloadAverageSpeed:  number;
  lastSeen:              string | null;
  ipAddress:             string | null;
  country:               string | null;
  city:                  string | null;
  isVpn:                 number | null;
  lat:                   number | null;
  lon:                   number | null;
}

export interface UserTransferRecord {
  id:                string;
  username:          string;
  direction:         string;
  filename:          string;
  size:              number;
  stateDescription:  string;
  exception:         string | null;
  requestedAt:       string;
  enqueuedAt:        string | null;
  startedAt:         string | null;
  endedAt:           string | null;
  bytesTransferred:  number;
  averageSpeed:      number;
}

export interface UserNetworkInfo {
  ipAddress: string | null;
  country:   string | null;
  city:      string | null;
  isVpn:     number | null;
  endedAt:   string | null;
}

export interface TransferFileSummary {
  filename:      string;
  count:         number;
  distinctUsers: number;
  totalBytes:    number;
}

export interface TransferDirectorySummary {
  directory:     string;
  count:         number;
  distinctUsers: number;
}

export interface HeatmapCell {
  dow:   number;
  hour:  number;
  bytes: number;
  count: number;
}

export interface CountrySummary {
  country: string;
  bytes:   number;
  count:   number;
  users:   number;
}

export interface GeographyReport {
  countries:    CountrySummary[];
  vpnUsers:     number;
  totalUsers:   number;
  unknownUsers: number;
}

export interface RetryBucket {
  attempts:  number;
  count:     number;
  succeeded: number;
}

export interface QueueWaitStats {
  p50:   number;
  p90:   number;
  p99:   number;
  max:   number;
  avg:   number;
  count: number;
}

export interface PeerRetention {
  newPeers:       number;
  returningPeers: number;
}

export interface CoverageReport {
  uploadedFiles: number;
}

export interface SocialActivity {
  browsed:         number;
  privateMessages: number;
  roomMessages:    number;
  mentions:        number;
}

interface RangeParams {
  start?: string;
  end?:   string;
}

interface Paged<T> {
  items: T[];
  total: number;
}

const totalCount = (headers: Record<string, unknown>): number =>
  Number.parseInt(String(headers['x-total-count'] ?? '0'), 10);

export const getSummary = (params: RangeParams & { direction?: TransferDirection; username?: string } = {}) =>
  apiClient
    .get<Record<TransferDirection, Record<string, TransferSummary>>>('/telemetry/reports/transfers/summary', { params })
    .then(r => r.data);

export const getHistogram = (params: RangeParams & { interval?: number; direction?: TransferDirection; username?: string } = {}) =>
  apiClient
    .get<Record<string, Record<TransferDirection, Record<string, TransferSummary>>>>('/telemetry/reports/transfers/histogram', { params: { interval: 60, ...params } })
    .then(r => r.data);

export const getLeaderboard = (params: RangeParams & { direction?: TransferDirection; sortBy?: string; limit?: number; offset?: number } = {}) =>
  apiClient
    .get<TransferSummary[]>('/telemetry/reports/transfers/leaderboard', { params: { sortBy: 'TotalBytes', limit: 10, offset: 0, ...params } })
    .then(r => r.data);

export const getUserDetail = (username: string, params: RangeParams = {}) =>
  apiClient
    .get<Record<TransferDirection, UserDirectionTransferSummary>>(`/telemetry/reports/transfers/users/${encodeURIComponent(username)}`, { params })
    .then(r => r.data);

export const getUserList = (params: RangeParams & { search?: string; sortBy?: string; sortOrder?: string; limit?: number; offset?: number } = {}): Promise<Paged<UserReportSummary>> =>
  apiClient
    .get<UserReportSummary[]>('/telemetry/reports/transfers/users', { params: { sortBy: 'LastSeen', sortOrder: 'DESC', limit: 25, offset: 0, ...params } })
    .then(r => ({ items: r.data, total: totalCount(r.headers as Record<string, unknown>) }));

export const getUserTransfers = (username: string, params: RangeParams & { direction?: TransferDirection; sortOrder?: string; limit?: number; offset?: number } = {}): Promise<Paged<UserTransferRecord>> =>
  apiClient
    .get<UserTransferRecord[]>(`/telemetry/reports/transfers/users/${encodeURIComponent(username)}/transfers`, { params: { sortOrder: 'DESC', limit: 25, offset: 0, ...params } })
    .then(r => ({ items: r.data, total: totalCount(r.headers as Record<string, unknown>) }));

export const getUserNetworkInfo = (username: string) =>
  apiClient
    .get<UserNetworkInfo>(`/telemetry/reports/transfers/users/${encodeURIComponent(username)}/network`)
    .then(r => r.data)
    .catch(() => null);

export const getTopFiles = (params: RangeParams & { limit?: number; offset?: number } = {}) =>
  apiClient
    .get<TransferFileSummary[]>('/telemetry/reports/transfers/files', { params: { limit: 10, offset: 0, ...params } })
    .then(r => r.data);

export const getDirectories = (params: RangeParams & { limit?: number; offset?: number } = {}) =>
  apiClient
    .get<TransferDirectorySummary[]>('/telemetry/reports/transfers/directories', { params: { limit: 10, offset: 0, ...params } })
    .then(r => r.data);

export const getExceptionsPareto = (params: RangeParams & { direction?: TransferDirection; limit?: number; offset?: number }): Promise<TransferExceptionSummaryEntry[]> => {
  if (!params.direction) return Promise.resolve([]);
  return apiClient
    .get<TransferExceptionSummaryEntry[]>('/telemetry/reports/transfers/exceptions/pareto', { params: { limit: 10, offset: 0, ...params } })
    .then(r => r.data);
};

export const getHeatmap = (params: RangeParams & { direction?: TransferDirection } = {}) =>
  apiClient.get<HeatmapCell[]>('/telemetry/reports/transfers/heatmap', { params }).then(r => r.data);

export const getGeography = (params: RangeParams & { limit?: number } = {}) =>
  apiClient.get<GeographyReport>('/telemetry/reports/transfers/geography', { params: { limit: 10, ...params } }).then(r => r.data);

export const getRetryFunnel = (params: RangeParams = {}) =>
  apiClient.get<RetryBucket[]>('/telemetry/reports/transfers/retries', { params }).then(r => r.data);

export const getQueueWait = (params: RangeParams = {}) =>
  apiClient.get<QueueWaitStats>('/telemetry/reports/transfers/queue-wait', { params }).then(r => r.data);

export const getPeerRetention = (params: RangeParams = {}) =>
  apiClient.get<PeerRetention>('/telemetry/reports/transfers/peers', { params }).then(r => r.data);

export const getCoverage = () =>
  apiClient.get<CoverageReport>('/telemetry/reports/transfers/coverage').then(r => r.data);

export const getSocialActivity = (params: RangeParams = {}) =>
  apiClient.get<SocialActivity>('/telemetry/reports/social', { params }).then(r => r.data);
