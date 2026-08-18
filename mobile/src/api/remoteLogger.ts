// <copyright file="remoteLogger.ts" company="John Narey">
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

import type { HubConnection } from '@microsoft/signalr';
import { apiClient } from './client';
import { getDeviceName } from '../store/auth';
import { useAppSettings } from '../store/appSettingsStore';

type LogLevel = 'info' | 'warn' | 'error';

interface QueuedEntry {
  level: LogLevel;
  message: string;
}

// Fixed so every device buckets under the same "Mobile" filter chip server-side; the device
// itself goes in subContext instead, so entries stay distinguishable without fragmenting the
// context registry into one dynamic value per device.
const LOG_CONTEXT = 'Mobile';
let logSubContext = '';
let queue: QueuedEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let intercepting = false;

// Capture originals before any interception so the flush path never loops back through our wrappers.
const originalConsole = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
};

const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE    = 100;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      // Error's `message`/`stack` are non-enumerable, so JSON.stringify(err)
      // yields "{}" and drops the actual failure. Pull them out explicitly —
      // this is what makes React render-error reports diagnosable server-side.
      if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a, (_key, value) =>
          value instanceof Error ? (value.stack || `${value.name}: ${value.message}`) : value,
        );
      } catch { return String(a); }
    })
    .join(' ');
}

function enqueue(level: LogLevel, message: string) {
  if (!useAppSettings.getState().remoteLogging) return;
  if (queue.length >= MAX_QUEUE_SIZE) queue.shift();
  queue.push({ level, message });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

async function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const entries = queue.splice(0, queue.length);
  // Sequentially, NOT Promise.all. /logs takes one entry per request, so a full queue used to fire
  // up to MAX_QUEUE_SIZE requests at once — and OkHttp only runs 5 per host, so every real API call
  // and artwork fetch queued behind them in the native dispatcher. That is worst right after a
  // resume, when a backlog built up while the app was away flushes in one burst.
  for (const e of entries) {
    try {
      await apiClient.post('/logs', {
        level: e.level,
        message: e.message,
        context: LOG_CONTEXT,
        subContext: logSubContext,
      });
    } catch {
      // Fire-and-forget: drop on network error to avoid feedback loops.
    }
  }
}

// Direct enqueue — use this for infrastructure/connection events that are
// too important to lose through the console-intercept path.
export function remoteLog(level: LogLevel, message: string) {
  enqueue(level, message);
}

// Attaches close/reconnecting/reconnected lifecycle logs to any hub connection.
export function attachHubLogging(hub: HubConnection, name: string) {
  hub.onclose((err) => {
    remoteLog('warn', `[hub:${name}] closed${err ? ` — ${err.message}` : ''}`);
  });
  hub.onreconnecting((err) => {
    remoteLog('warn', `[hub:${name}] reconnecting${err ? ` — ${err.message}` : ''}`);
  });
  hub.onreconnected((connectionId) => {
    remoteLog('info', `[hub:${name}] reconnected (id=${connectionId ?? 'unknown'})`);
  });
}

export async function enableRemoteLogging() {
  logSubContext = await getDeviceName();
  if (intercepting) return;
  intercepting = true;

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    enqueue('info', formatArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    enqueue('warn', formatArgs(args));
  };
  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    enqueue('error', formatArgs(args));
  };
}

export function disableRemoteLogging() {
  if (!intercepting) return;
  intercepting = false;
  console.log   = originalConsole.log;
  console.warn  = originalConsole.warn;
  console.error = originalConsole.error;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  queue = [];
}
