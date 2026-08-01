// <copyright file="perfProbe.tsx" company="John Narey">
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

import React, { Profiler, useEffect } from 'react';
import { AppState } from 'react-native';
import type { AxiosError } from 'axios';
import { apiClient } from '../api/client';
import { useAppSettings } from '../store/appSettingsStore';

// Why this exists: "the app feels unresponsive, especially after coming back to it" is a symptom
// with at least three different causes, and they need different fixes:
//
//   • the JS thread is blocked      → taps aren't processed until it frees up
//   • React is re-rendering too much → the thread is blocked *by rendering*, and by which subtree
//   • the HTTP dispatcher is saturated → taps land but the data behind them takes seconds
//
// Each counter below separates one of those. Everything aggregates in memory and ships as ONE
// request per window, so the probe can't become the stall it's measuring (which is exactly what
// dbg()'s post-per-call would do at this volume). Gated behind Settings → Debugging → "Performance
// probe"; when off, every entry point here is an early return.

const WINDOW_MS = 10_000;
// A 1 s heartbeat that comes back later than this means the thread was busy in between. 250 ms is
// roughly where a tap stops feeling instant, so anything above it is user-visible.
const STALL_MS = 250;
// React commits below this are noise at 60 fps; above it they're dropping frames.
const SLOW_COMMIT_MS = 16;

const enabled = (): boolean => useAppSettings.getState().perfProbe;

// ── Window counters ─────────────────────────────────────────────────────────

let commits = 0;
let commitMs = 0;
let slowCommits = 0;
let worstCommitMs = 0;
let worstCommitId = '';
// Per-subtree commit cost, so the summary can name the component that's actually burning the
// frame rather than just saying "React was busy".
const byTree = new Map<string, { n: number; ms: number }>();

let stalls = 0;
let stalledMs = 0;
let worstStallMs = 0;

let httpDone = 0;
let httpInflight = 0;
let httpPeakInflight = 0;
let worstHttpMs = 0;

// Tap-to-paint. The complaint is "I hear the keypress but the screen takes five seconds", which is
// a touch that reached native while JS was too busy to render the result — so measure exactly that:
// from the press handler running to the next commit that paints something.
let pendingInteraction: { label: string; at: number } | null = null;
let worstInteractionMs = 0;
let worstInteractionLabel = '';

// Synchronous work outside React, labelled at the call site. The headline stall (4051ms) was far
// bigger than the worst commit (709ms), so something was blocking the thread that wasn't rendering
// at all; without a label there is no way to tell which of the suspects it was.
let worstBlockMs = 0;
let worstBlockLabel = '';

// Set when the app last came back to the foreground, so the first summaries after a resume are
// labelled — that's the window the complaint is actually about.
let resumedAt: number | null = null;
let backgroundedAt: number | null = null;
let lastBackgroundMs = 0;

function resetWindow() {
  commits = 0; commitMs = 0; slowCommits = 0; worstCommitMs = 0; worstCommitId = '';
  byTree.clear();
  stalls = 0; stalledMs = 0; worstStallMs = 0;
  httpDone = 0; httpPeakInflight = httpInflight; worstHttpMs = 0;
  worstInteractionMs = 0; worstInteractionLabel = '';
  worstBlockMs = 0; worstBlockLabel = '';
  pendingInteraction = null;
}

/**
 * Mark the start of a user interaction. The next commit closes it, giving the latency the user
 * actually feels. Safe to call unconditionally — it's a no-op when the probe is off.
 */
export function notePerfInteraction(label: string): void {
  if (!enabled()) return;
  pendingInteraction = { label, at: Date.now() };
}

/** Record a synchronous non-React block, timed by the caller from `startedAt`. */
export function notePerfBlock(label: string, startedAt: number): void {
  if (!enabled()) return;
  const took = Date.now() - startedAt;
  if (took > worstBlockMs) { worstBlockMs = took; worstBlockLabel = label; }
}

// ── Entry points ────────────────────────────────────────────────────────────

/** Called by the <PerfProfiler> wrappers for every React commit in their subtree. */
function noteCommit(id: string, _phase: string, actualDuration: number) {
  if (!enabled()) return;
  // First commit after an interaction closes it — that's when the user sees the result.
  if (pendingInteraction) {
    const waited = Date.now() - pendingInteraction.at;
    if (waited > worstInteractionMs) {
      worstInteractionMs = waited;
      worstInteractionLabel = pendingInteraction.label;
    }
    pendingInteraction = null;
  }
  commits += 1;
  commitMs += actualDuration;
  if (actualDuration >= SLOW_COMMIT_MS) slowCommits += 1;
  if (actualDuration > worstCommitMs) { worstCommitMs = actualDuration; worstCommitId = id; }
  const t = byTree.get(id) ?? { n: 0, ms: 0 };
  t.n += 1; t.ms += actualDuration;
  byTree.set(id, t);
}

// In-flight depth is the one thing the existing network log can't give us: it only records
// requests that already finished. Peak depth is what says whether OkHttp's 5-per-host dispatcher
// is the thing making taps feel dead.
//
// The interceptors are attached from here rather than declared in client.ts, so the dependency
// runs one way (probe → client) — a cycle would leave apiClient undefined at module init.
let ejectRequest: number | null = null;
let ejectResponse: number | null = null;

function noteHttpStart() {
  if (!enabled()) return;
  httpInflight += 1;
  if (httpInflight > httpPeakInflight) httpPeakInflight = httpInflight;
}

function noteHttpEnd(startedAt: number | undefined) {
  if (!enabled()) return;
  httpInflight = Math.max(0, httpInflight - 1);
  httpDone += 1;
  const took = Date.now() - (startedAt ?? Date.now());
  if (took > worstHttpMs) worstHttpMs = took;
}

function attachHttpCounters() {
  if (ejectRequest !== null) return;
  ejectRequest = apiClient.interceptors.request.use((config) => {
    noteHttpStart();
    return config;
  });
  ejectResponse = apiClient.interceptors.response.use(
    (response) => { noteHttpEnd(response.config?.metadata?.startedAt); return response; },
    (error: AxiosError) => { noteHttpEnd(error.config?.metadata?.startedAt); return Promise.reject(error); },
  );
}

function detachHttpCounters() {
  if (ejectRequest !== null) { apiClient.interceptors.request.eject(ejectRequest); ejectRequest = null; }
  if (ejectResponse !== null) { apiClient.interceptors.response.eject(ejectResponse); ejectResponse = null; }
  httpInflight = 0;
}

// ── Summary ─────────────────────────────────────────────────────────────────

const ms = (n: number) => `${Math.round(n)}ms`;

function summary(): string {
  // Two or three worst subtrees by total cost — the ranking is the diagnosis.
  const trees = [...byTree.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 3)
    .map(([id, t]) => `${id}=${t.n}x/${ms(t.ms)}`)
    .join(' ');

  const since = resumedAt
    ? ` resume+${Math.round((Date.now() - resumedAt) / 1000)}s(was away ${Math.round(lastBackgroundMs / 1000)}s)`
    : '';

  return `[perf]${since}` +
    ` tap:worst=${ms(worstInteractionMs)}(${worstInteractionLabel || '-'})` +
    ` | block:worst=${ms(worstBlockMs)}(${worstBlockLabel || '-'})` +
    ` | js:stalls=${stalls} worst=${ms(worstStallMs)} blocked=${ms(stalledMs)}` +
    ` | react:commits=${commits} slow=${slowCommits} total=${ms(commitMs)}` +
    ` worst=${ms(worstCommitMs)}(${worstCommitId || '-'}) [${trees || 'none'}]` +
    ` | http:done=${httpDone} inflight=${httpInflight} peak=${httpPeakInflight} slowest=${ms(worstHttpMs)}`;
}

function report() {
  // Silence is the useful default: a window with no stalls, no slow commits and no slow request
  // says nothing worth a round-trip. Only windows with something in them are shipped.
  const interesting = stalls > 0 || slowCommits > 0 || worstHttpMs > 1_000
    || worstInteractionMs > 0 || worstBlockMs > 0 || resumedAt !== null;
  if (interesting) {
    apiClient
      .post('/logs', { level: 'info', message: summary(), context: 'Mobile/Perf' })
      .catch(() => { /* fire-and-forget; never retry, never queue */ });
  }
  // The resume label covers one window only, so later summaries aren't misread as post-resume.
  if (resumedAt !== null && Date.now() - resumedAt > WINDOW_MS) resumedAt = null;
  resetWindow();
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

let heartbeat: ReturnType<typeof setInterval> | null = null;
let windowTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
// Module scope, not a closure in startPerfProbe: the resume handler has to reset it, otherwise the
// first beat back counts the whole suspension as one enormous stall.
let lastBeat = Date.now();
// When the reporting window last ran, so a window that comes back overdue can be recognised as a
// resume even if the AppState event never arrived.
let lastWindowAt = Date.now();

/**
 * Starts the probe. Mount once from the authenticated app; safe to call when the setting is off
 * (it just doesn't start), and idempotent.
 */
export function startPerfProbe(): void {
  if (heartbeat) return;
  attachHttpCounters();

  lastBeat = Date.now();
  lastWindowAt = Date.now();
  heartbeat = setInterval(() => {
    const now = Date.now();
    const gap = now - lastBeat - 1_000;
    lastBeat = now;
    if (!enabled()) return;
    // A gap while backgrounded is the OS suspending timers, not a stall — don't count it.
    if (AppState.currentState !== 'active') return;
    if (gap > STALL_MS) {
      stalls += 1;
      stalledMs += gap;
      if (gap > worstStallMs) worstStallMs = gap;
    }
  }, 1_000);

  windowTimer = setInterval(() => {
    if (!enabled()) return;
    if (AppState.currentState !== 'active') return;
    // A window timer that fires far later than its interval means the app was suspended in
    // between, whether or not the AppState listener told us. Treating that as a resume is what
    // makes the label trustworthy — relying on the event alone produced "resume+4390s(was away
    // 359s)", a stale label from an earlier trip, because the listener didn't fire on that return.
    const now = Date.now();
    const overdueBy = now - lastWindowAt - WINDOW_MS;
    lastWindowAt = now;
    if (overdueBy > WINDOW_MS) {
      lastBackgroundMs = overdueBy + WINDOW_MS;
      resumedAt = now;
      lastBeat = now;
      resetWindow();
      return;
    }
    report();
  }, WINDOW_MS);

  appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      if (backgroundedAt) lastBackgroundMs = Date.now() - backgroundedAt;
      backgroundedAt = null;
      resumedAt = Date.now();
      // Both are stale after a suspend. Without the lastBeat reset the first beat back reports the
      // entire time away as a stall, which is the one false positive that would send us chasing
      // the wrong thing.
      lastBeat = Date.now();
      lastWindowAt = Date.now();
      resetWindow();
    } else {
      // Any non-active state ('inactive' then 'background' on the way out) — the last one before
      // the resume is the one that dates the trip away.
      backgroundedAt = Date.now();
    }
  });
}

export function stopPerfProbe(): void {
  detachHttpCounters();
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  if (windowTimer) { clearInterval(windowTimer); windowTimer = null; }
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
}

/** Hook form for the app root. */
export function usePerfProbe(): void {
  useEffect(() => {
    startPerfProbe();
    return stopPerfProbe;
  }, []);
}

/**
 * Wraps a subtree so its commits are attributed to `id` in the summary.
 *
 * Always renders the Profiler, and gates inside onRender instead. Two earlier attempts to skip it
 * when the setting is off were both wrong: subscribing swapped this element's type between Fragment
 * and Profiler, which remounts the subtree React-side (losing navigation state), and reading the
 * setting once at mount races the async SecureStore load, so the probe silently never armed —
 * `react:commits=0` in every summary.
 *
 * Keeping the type constant costs some profiling bookkeeping per commit in dev, and nothing at all
 * in release, where React compiles Profiler out to a passthrough. (That also means the react:
 * section of the summary is only ever populated in a dev build; stalls and HTTP still work.)
 */
export const PerfProfiler = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <Profiler id={id} onRender={noteCommit}>{children}</Profiler>
);
