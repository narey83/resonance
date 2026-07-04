// <copyright file="application.ts" company="John Narey">
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

export interface AppState {
  version: {
    full:              string;
    current:           string;
    latest:            string | null;
    isUpdateAvailable: boolean;
    isCanary:          boolean;
    isDevelopment:     boolean;
  };
  server: {
    address:     string;
    state:       string;
    isConnected: boolean;
    isLoggedIn:  boolean;
  };
  user: {
    username:   string;
    privileges: { isPrivileged: boolean; privilegesRemaining: number };
    statistics: { averageSpeed: number; directoryCount: number; fileCount: number; uploadCount: number };
  };
  shares: {
    ready:       boolean;
    scanning:    boolean;
    scanPending: boolean;
    faulted:     boolean;
    directories: number;
    files:       number;
  };
}

export interface KpiMetric {
  name:     string;
  help:     string;
  type:     string;
  sum?:     number;
  count?:   number;
  samples?: { value?: number; labels: Record<string, string> }[];
}

export const getApplicationState = () =>
  apiClient.get<AppState>('/application').then(r => r.data);

export const getKpis = () =>
  apiClient.get<Record<string, KpiMetric>>('/telemetry/metrics/kpis').then(r => r.data);
