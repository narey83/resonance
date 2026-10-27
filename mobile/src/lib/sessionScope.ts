// <copyright file="sessionScope.ts" company="John Narey">
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

// Account data and asynchronous work belong to a single login. Token refreshes keep the
// generation; signing out, changing servers, and starting a new login invalidate old work.
let generation = 0;
let scope: string | null = null;
const resets = new Set<(restoring: boolean) => void>();

export const getSessionGeneration = (): number => generation;
export const getSessionScope = (): string | null => scope;
export const isCurrentSession = (value: number): boolean => value === generation;

export function onSessionReset(reset: (restoring: boolean) => void): () => void {
  resets.add(reset);
  return () => { resets.delete(reset); };
}

export function resetSessionScope(nextScope: string | null, restoring = false): void {
  generation += 1;
  scope = nextScope;
  for (const reset of resets) reset(restoring);
}

/** Capture before an await; a late response must not update a subsequent login. */
export function sessionGuard(): () => boolean {
  const started = generation;
  return () => isCurrentSession(started);
}

/** Ignore events from a hub whose login has ended, even before React runs effect cleanup. */
export function guardSessionCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result):
  (...args: Args) => Result | undefined {
  const current = sessionGuard();
  return (...args) => current() ? callback(...args) : undefined;
}
