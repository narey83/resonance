// <copyright file="mediaAudioGraph.js" company="John Narey">
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

// Owns the single Web Audio graph tapped off the player's <audio> element.
// Both the loudness meter and Performance Mode attach to this same graph —
// createMediaElementSource() can only ever be called once per element for
// its entire lifetime, so whichever feature mounts first builds it and every
// later consumer must reuse the cached instance rather than trying to build
// a second one.
//
// Stashed directly on the <audio> DOM element (see GRAPH_PROPERTY) rather
// than in a module-level Map/WeakMap — this dev server hot-reloads on every
// deploy (the running craco process recompiles in place, it's never a fresh
// process), and a hot-swap of this module re-evaluates it from scratch,
// silently wiping any module-scoped cache. The browser's own "already
// connected to a MediaElementSourceNode" tracking is NOT reset by that,
// since it lives on the persistent DOM element, not in JS module state — so
// a module-level cache falls out of sync with the browser exactly when it's
// needed most (right after a hot-reload) and createMediaElementSource
// throws again. A property on the element itself survives the hot-swap.
const GRAPH_PROPERTY = '__resonanceAudioGraph';

// Builds (once) or returns the cached Web Audio graph for `audioElement`.
//
// Topology:
//
//   source ─┬─► outputGain ──► destination            (playback path)
//           └─► highpass ──► highshelf ──► analyser    (analysis-only tap)
//
// `outputGain` is always in the playback path, at unity by default, so
// audio reaches the speakers even before any feature touches it — this is
// also Performance Mode's pre-gain stage once enabled (see
// PerformanceAudioProcessor), and with gain left at 1 the two are
// indistinguishable from plain passthrough.
//
// The highpass/highshelf/analyser chain is a rough approximation of ITU-R
// BS.1770 K-weighting (not the spec's exact filter coefficients) feeding an
// analyser used only for the live loudness meter's visual bar — it taps the
// raw source directly, upstream of any gain or Performance Mode processing,
// so the meter always reflects the track's real level regardless of what
// processing is applied to what the listener actually hears.
export const getMediaAudioGraph = (audioElement) => {
  if (!audioElement) return null;

  let graph = audioElement[GRAPH_PROPERTY];
  if (graph) return graph;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const source = context.createMediaElementSource(audioElement);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 60;

  const highshelf = context.createBiquadFilter();
  highshelf.type = 'highshelf';
  highshelf.frequency.value = 1_500;
  highshelf.gain.value = 4;

  const analyser = context.createAnalyser();
  // Kept small deliberately — this only feeds a coarse live VISUAL meter,
  // not a certified measurement, and summing this buffer every update
  // competes with the waveform's own per-frame work on the main thread.
  // 2048 samples (~43ms at 48kHz) is still a fine window for a moving bar.
  analyser.fftSize = 2_048;
  analyser.smoothingTimeConstant = 0;

  const outputGain = context.createGain();
  outputGain.gain.value = 1;

  // The element's own output was implicitly disconnected the moment
  // createMediaElementSource ran, so playback needs its own explicit path
  // to the speakers, separate from the filtered analysis path.
  source.connect(outputGain);
  outputGain.connect(context.destination);
  source.connect(highpass);
  highpass.connect(highshelf);
  highshelf.connect(analyser);

  graph = {
    analyser,
    analyserBuffer: new Float32Array(analyser.fftSize),
    context,
    outputGain,
    // Populated lazily by PerformanceAudioProcessor on first enable — not
    // every session touches Performance Mode, so its compressor/limiter
    // nodes shouldn't be built (even inert) until something asks for them.
    performance: null,
    source,
  };
  audioElement[GRAPH_PROPERTY] = graph;
  return graph;
};
