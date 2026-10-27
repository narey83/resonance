// <copyright file="jwt.ts" company="John Narey">
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

export interface TokenClaims {
  exp?: number;
  name?: string;
  role?: string;
  [claim: string]: unknown;
}

/** JWT payloads use base64url, which atob does not accept without normalisation. */
export function decodeJwt(token: string | null): TokenClaims | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const json = decodeURIComponent(Array.from(bytes, (c) =>
      `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims as TokenClaims : null;
  } catch {
    return null;
  }
}

/** Supports both compact JWT names and ASP.NET's mapped name claim. */
export function tokenUsername(token: string | null): string | null {
  const claims = decodeJwt(token);
  const name = claims?.name ?? claims?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ?? claims?.unique_name;
  return typeof name === 'string' ? name : null;
}

export function accountScope(serverUrl: string | null, token: string | null): string | null {
  if (!serverUrl || !token) return null;
  const claims = decodeJwt(token);
  // The backend issues a random NameIdentifier per token; `name` is the stable username.
  const name = claims?.name ?? claims?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'];
  // Without an account identity, disable persistent caching rather than storing a credential.
  return typeof name === 'string' ? JSON.stringify([serverUrl.replace(/\/+$/, ''), name]) : null;
}
