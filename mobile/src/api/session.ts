// <copyright file="session.ts" company="John Narey">
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

import axios from 'axios';

// camelCase matches the backend's default ASP.NET Core JSON output — do NOT change to PascalCase
export interface TokenResponse {
  token:        string;
  refreshToken: string;
  expires:      number;
  name:         string;
  sessionId?:   string;
}

export const login = async (
  serverUrl: string,
  username: string,
  password: string,
  deviceName: string,
  deviceId: string,
  existingSessionId?: string | null,
): Promise<TokenResponse> => {
  const { data } = await axios.post<TokenResponse>(
    `${serverUrl}/api/v0/session`,
    { username, password, deviceName, deviceId, existingSessionId },
    { timeout: 10000 },
  );
  return data;
};

/**
 * Exchanges a pairing code from a scanned QR for a session on `serverUrl`.
 *
 * The code is single-use and short-lived, and carries no credentials — it identifies the Resonance
 * account that generated it in the web UI, which is separate from the Soulseek network login.
 */
export const redeemPairingCode = async (
  serverUrl: string,
  code: string,
  deviceName: string,
  deviceId: string,
): Promise<TokenResponse> => {
  const { data } = await axios.post<TokenResponse>(
    `${serverUrl}/api/v0/session/pair/redeem`,
    { code, deviceName, deviceId },
    { timeout: 10000 },
  );
  return data;
};

export const checkInitialized = async (serverUrl: string): Promise<boolean> => {
  const { data } = await axios.get<boolean>(
    `${serverUrl}/api/v0/session/initialized`,
    { timeout: 8000 },
  );
  return data;
};

export const logout = async (refreshToken: string): Promise<void> => {
  const { apiClient } = await import('./client');
  await apiClient.delete('/session', { data: { refreshToken } });
};
