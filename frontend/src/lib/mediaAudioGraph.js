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

import { CompressorProcessor } from './dsp/CompressorProcessor';
import { EQProcessor } from './dsp/EqProcessor';
import { FilterProcessor } from './dsp/FilterProcessor';
import { LimiterProcessor } from './dsp/LimiterProcessor';
import { MasterBypass } from './dsp/MasterBypass';
import { PerformanceProcessor } from './dsp/PerformanceProcessor';
import { applySubtleSettings } from './dsp/processingPolicy';
import { ProcessorChain } from './dsp/ProcessorChain';
import { SaturationProcessor } from './dsp/SaturationProcessor';
import { StereoProcessor } from './dsp/StereoProcessor';
import * as prefs from './prefs';

// Owns the single Web Audio graph tapped off the player's <audio> element —
// the source, the DSP processing rack, and the loudness meter's analysis
// tap. Every audio-processing feature attaches to this same graph —
// createMediaElementSource() can only ever be called once per element for
// its entire lifetime, so whichever feature mounts first builds it and
// every later consumer must reuse the cached instance rather than trying
// to build a second one.
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

// Every panel that shows a processor (see the *View.jsx components) reads
// and writes prefs under its own key, and syncs live via
// AudioProcessor.subscribe() — but the very first value each processor
// gets has to come from somewhere ONE time, in a defined order, or
// whichever panel's mount effect happens to run last would silently win
// and stomp what another panel (or Performance Mode) had just restored.
// Restoring every processor's persisted state HERE, once, centrally, at
// the moment they're built — rather than scattered across each panel's
// mount effect — is what avoids that race. Performance Mode is restored
// LAST and takes precedence over the Compressor/Limiter panels' own
// persisted `enabled` if it was on, mirroring the same precedence it
// already has live (see PerformanceProcessor's doc comment).
const restorePersistedState = (dsp) => {
  dsp.eq.setLow(prefs.get('mediaPlayer.dsp.eq.low', 0));
  dsp.eq.setMid(prefs.get('mediaPlayer.dsp.eq.mid', 0));
  dsp.eq.setHigh(prefs.get('mediaPlayer.dsp.eq.high', 0));
  dsp.eq.setEnabled(prefs.get('mediaPlayer.dsp.eq.enabled', false));

  dsp.filter.setPosition(prefs.get('mediaPlayer.dsp.filter.position', 0));
  dsp.filter.setResonance(prefs.get('mediaPlayer.dsp.filter.resonance', 1));
  dsp.filter.setEnabled(prefs.get('mediaPlayer.dsp.filter.enabled', false));

  dsp.compressor.setAmount(
    prefs.get('mediaPlayer.dsp.compressor.amount', 0.15),
  );
  dsp.compressor.setAttack(
    prefs.get('mediaPlayer.dsp.compressor.attack', 0.01),
  );
  dsp.compressor.setRelease(
    prefs.get('mediaPlayer.dsp.compressor.release', 0.2),
  );
  dsp.compressor.setEnabled(
    prefs.get('mediaPlayer.dsp.compressor.enabled', false),
  );

  dsp.saturation.setAmount(
    prefs.get('mediaPlayer.dsp.saturation.amount', 0.05),
  );
  dsp.saturation.setEnabled(
    prefs.get('mediaPlayer.dsp.saturation.enabled', false),
  );

  dsp.stereo.setWidth(prefs.get('mediaPlayer.dsp.stereo.width', 1));
  dsp.stereo.setEnabled(prefs.get('mediaPlayer.dsp.stereo.enabled', false));

  dsp.limiter.setCeiling(prefs.get('mediaPlayer.dsp.limiter.ceiling', -1));
  dsp.limiter.setRelease(prefs.get('mediaPlayer.dsp.limiter.release', 0.1));
  dsp.limiter.setEnabled(prefs.get('mediaPlayer.dsp.limiter.enabled', false));

  dsp.performance.setCompressionAmount(
    prefs.get('mediaPlayer.performanceCompression', 0.15),
  );
  dsp.performance.setOutputProtection(
    prefs.get('mediaPlayer.performanceProtection', true),
  );
  dsp.performance.setEnabled(prefs.get('mediaPlayer.performanceMode', false));
};

// Topology:
//
//   source ─┬─► dry gain ───────────────────────────────────► destination
//           ├─► outputGain ─► ProcessorChain ─► wet gain ────► destination
//           └─► highpass ──► highshelf ──► analyser    (analysis-only tap)
// Master bypass crossfades dry/wet gains; normalisation only affects the wet path.
//
// `outputGain` is the rack's shared input trim — always in the playback
// processed path, at unity by default, so audio reaches the speakers before any
// processor is touched. It also doubles as Loudness Normalise's pre-gain
// stage (driven by PerformanceProcessor): trimming level BEFORE anything
// else in the chain sees the signal is what lets a quiet and a loud track
// hit the compressor/limiter at roughly the same level, rather than
// fighting the dynamics processing to do leveling after the fact.
//
// Chain order — EQ ▸ Filter ▸ Compressor ▸ Saturation ▸ Stereo ▸ Limiter:
// EQ and the DJ filter shape tone/spectrum before anything reacts to
// level, so compression responds to the sound the listener will actually
// hear rather than pre-EQ balance. Saturation comes after compression so
// it's adding harmonics to an already-leveled signal instead of getting
// re-leveled itself. Stereo imaging is adjusted last before the safety
// stage, since none of the earlier processors depend on stereo width.
// Limiter is always the final node before destination — its whole job is
// catching whatever peaks everything upstream produced.
//
// Every processor is registered into the chain disabled by default, so
// with nothing touched the chain reduces to outputGain -> destination —
// identical to plain passthrough.
//
// The highpass/highshelf/analyser chain is a rough approximation of ITU-R
// BS.1770 K-weighting (not the spec's exact filter coefficients) feeding an
// analyser used only for the live loudness meter's visual bar — it taps the
// raw source directly, upstream of outputGain and the whole processing
// rack, so the meter always reflects the track's real level regardless of
// what processing is applied to what the listener actually hears.
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
  source.connect(highpass);
  highpass.connect(highshelf);
  highshelf.connect(analyser);

  const processing = new MasterBypass(
    context,
    source,
    context.destination,
    prefs.get('mediaPlayer.processingBypassed', true),
  );
  const chain = new ProcessorChain(context, outputGain, processing.wet);
  const eq = chain.register('eq', new EQProcessor(context));
  const filter = chain.register('filter', new FilterProcessor(context));
  const compressor = chain.register(
    'compressor',
    new CompressorProcessor(context),
  );
  const saturation = chain.register(
    'saturation',
    new SaturationProcessor(context),
  );
  const stereo = chain.register('stereo', new StereoProcessor(context));
  const limiter = chain.register('limiter', new LimiterProcessor(context));

  const performance_ = new PerformanceProcessor({
    compressor,
    context,
    limiter,
    outputGain,
  });

  const dsp = {
    chain,
    compressor,
    eq,
    filter,
    limiter,
    performance: performance_,
    saturation,
    stereo,
  };
  performance_.setAdvanced(prefs.get('mediaPlayer.processingAdvanced', false));
  restorePersistedState(dsp);
  if (!prefs.get('mediaPlayer.processingAdvanced', false))
    applySubtleSettings(dsp);

  graph = {
    analyser,
    analyserBuffer: new Float32Array(analyser.fftSize),
    context,
    dsp,
    outputGain,
    processing,
    source,
  };
  audioElement[GRAPH_PROPERTY] = graph;
  return graph;
};

export const peekMediaAudioGraph = (audioElement) =>
  audioElement?.[GRAPH_PROPERTY] ?? null;
