// <copyright file="windowDock.js" company="John Narey">
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

import { useEffect, useState } from 'react';

// Shared state for floating windows. Two things need coordinating between
// windows that don't know about each other (each report window is rendered by
// whichever component owns it — a username link, a map dot, a leaderboard row):
//
//   · stacking   — clicking a window raises it above its siblings.
//   · dock slots — minimised windows sit side by side, not stacked, so each
//                  needs its position in the docked order.
//
// Deliberately a module-level store rather than context: these windows have no
// common ancestor to hang a provider off.

// Raise order, back to front.
const stack = [];

// Docked (minimised) order, left to right.
const slots = [];

const listeners = new Set();
let version = 0;

const notify = () => {
  version += 1;
  for (const listener of listeners) listener(version);
};

const remove = (list, id) => {
  const index = list.indexOf(id);
  if (index !== -1) list.splice(index, 1);
  return index !== -1;
};

// ─── Stacking ────────────────────────────────────────────────────────────────

// Sits above the app chrome (nav 100, player 200) but below every "covers
// everything" layer: semantic-ui's dimmer/modal and the expanded player at
// 1000, and tooltips and context menus at 9999.
// A real modal should still cover a floating window.
const Z_BASE = 900;

/**
 * Raises a window to the front of the stack, registering it if it's new.
 * @param {string} id The window's id.
 */
export const raiseWindow = (id) => {
  // Already on top — nothing to do, and skipping the notify avoids a re-render
  // on every pointer-down.
  if (stack.at(-1) === id) return;
  remove(stack, id);
  stack.push(id);
  notify();
};

/**
 * Removes a window from the stack, on close.
 * @param {string} id The window's id.
 */
export const dropWindow = (id) => {
  if (remove(stack, id)) notify();
};

/**
 * The window's z-index, derived from its place in the raise order.
 *
 * Derived rather than handed out by an ever-incrementing counter: a counter
 * climbs by one on every click and would eventually cross 1000 and start
 * covering real modals. Deriving keeps the whole band within Z_BASE..Z_BASE+n,
 * where n is the number of open windows.
 * @param {string} id The window's id.
 * @returns {number} The z-index.
 */
export const getWindowZ = (id) => Z_BASE + Math.max(stack.indexOf(id), 0);

// ─── Dock ────────────────────────────────────────────────────────────────────

/**
 * Adds a window to the dock, if it isn't already there.
 * @param {string} id The window's id.
 */
export const dockWindow = (id) => {
  if (!slots.includes(id)) {
    slots.push(id);
    notify();
  }
};

/**
 * Removes a window from the dock; windows after it shuffle down a slot.
 * @param {string} id The window's id.
 */
export const undockWindow = (id) => {
  if (remove(slots, id)) notify();
};

/**
 * The window's position in the docked order, or -1 when it isn't docked.
 * @param {string} id The window's id.
 * @returns {number} The slot index.
 */
export const getDockSlot = (id) => slots.indexOf(id);

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Subscribes a window to the shared stack/dock state.
 *
 * Hand-rolled subscription rather than useSyncExternalStore, which needs React
 * 18; this app is on 16.14. Mirrors useBlockedUsers.
 * @param {string} id The window's id.
 * @returns {{dockSlot: number, zIndex: number}} This window's placement.
 */
export const useFloatingWindow = (id) => {
  const [, setVersion] = useState(version);

  useEffect(() => {
    listeners.add(setVersion);
    // A change landing between render and subscribe would otherwise be missed.
    setVersion(version);
    return () => {
      listeners.delete(setVersion);
    };
  }, []);

  return { dockSlot: getDockSlot(id), zIndex: getWindowZ(id) };
};
