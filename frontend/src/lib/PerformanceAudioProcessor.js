// <copyright file="PerformanceAudioProcessor.js" company="John Narey">
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

// DJ-style "Performance Mode" processing chain, inserted into the shared
// media audio graph (see mediaAudioGraph.js) between its always-present
// `outputGain` node and `context.destination`:
//
//   outputGain (pre-gain) ──► compressor ──► makeup gain ──► limiter ──► destination
//
// `outputGain` doubles as the pre-gain stage: with Loudness Normalise on, it
// is retargeted toward a fixed reference level exactly like the old
// standalone "Norm" toggle did, so quiet and loud masters land closer
// together before compression ever sees them. `compressor` narrows the
// remaining dynamic range; `makeup gain` restores the level that
// compression removed; `limiter` is a second DynamicsCompressorNode
// configured as a fast, hard-kneed brick-wall stage purely to catch any
// peak that still gets through — the Web Audio API has no dedicated
// limiter node, and a 20:1 ratio (its maximum) with a near-zero attack is
// the closest a stock browser node gets to one without pulling in a
// third-party DSP library.
//
// Bypass is a graph edit, not a rebuild: when disabled, `outputGain`
// connects straight to `destination` and the compressor/limiter chain is
// disconnected from destination entirely, so it does no processing (a
// Web Audio node with no path to the destination isn't pulled by the
// renderer) and costs nothing. The compressor/limiter/makeup nodes
// themselves are created once, on first enable, and then reused for the
// life of the <audio> element — never destroyed and rebuilt on toggle.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dbToGain = (db) => 10 ** (db / 20);

// Reference level for Loudness Normalise — matches the app's previous
// standalone "Norm" feature. -9 LUFS, not the -14 streaming-standard
// target: most club/EDM/techno masters in this library run -6 to -9 LUFS,
// well louder than -14, so a -14 target would read as "everything got
// quieter" rather than levelling out the occasional outlier.
const TARGET_LUFS = -9;
const MAX_BOOST_DB = 6;
const MAX_CUT_DB = 12;

// The compression slider (0..1) sweeps threshold and ratio together between
// a light touch and a firmer, still-musical setting — not full limiting,
// which is the dedicated limiter stage's job. Knee/attack/release stay
// fixed: they shape *how* compression sounds rather than *how much*, and a
// single slider mapped to five parameters at once stops being predictable.
// A 6dB soft knee and ~10ms attack avoid clamping down on individual kick
// transients (this library skews club/EDM, typically 120-140 BPM, i.e. a
// beat every 400-500ms), while a 200ms release lets the gain recover
// between hits instead of audibly pumping in time with the beat.
const THRESHOLD_MIN_DB = -6;
const THRESHOLD_MAX_DB = -18;
const RATIO_MIN = 1.5;
const RATIO_MAX = 4;
const COMPRESSOR_KNEE_DB = 6;
const COMPRESSOR_ATTACK_SECONDS = 0.01;
const COMPRESSOR_RELEASE_SECONDS = 0.2;

// Limiter (safety stage) — fixed, not user-tunable via the compression
// slider, since its job is "never clip" rather than shaping tone. -1dB
// threshold leaves a small ceiling of headroom; 0dB knee and the maximum
// 20:1 ratio push it as close to a hard ceiling as the node allows; a 2ms
// attack catches fast transients (some overshoot is inherent to a
// non-lookahead limiter) and a 100ms release keeps gain reduction from
// releasing so fast it becomes audible as distortion on sustained peaks.
const LIMITER_THRESHOLD_DB = -1;
const LIMITER_KNEE_DB = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SECONDS = 0.002;
const LIMITER_RELEASE_SECONDS = 0.1;

// Smooth every parameter/gain change over ~80ms instead of stepping it
// instantly — an instant jump (toggling a control, a new track's LUFS
// value loading) is an audible click or zipper noise.
const RAMP_SECONDS = 0.08;

export class PerformanceAudioProcessor {
  constructor(graph) {
    this.graph = graph;
    this.context = graph.context;
    this.enabled = false;
    this.protectionEnabled = true;
    this.normalizeEnabled = true;
    this.compressionAmount = 0.5;
    this.targetLufs = null;
  }

  // Builds the compressor/makeup/limiter nodes on first use and caches them
  // on the shared graph so a later PerformanceAudioProcessor instance for
  // the same <audio> element (e.g. after a remount) reuses them instead of
  // creating a second set.
  _ensureNodes() {
    if (this.graph.performance) {
      ({
        compressor: this.compressor,
        limiter: this.limiter,
        makeup: this.makeup,
      } = this.graph.performance);
      return;
    }

    const { context } = this;
    const compressor = context.createDynamicsCompressor();
    compressor.knee.value = COMPRESSOR_KNEE_DB;
    compressor.attack.value = COMPRESSOR_ATTACK_SECONDS;
    compressor.release.value = COMPRESSOR_RELEASE_SECONDS;

    const makeup = context.createGain();
    makeup.gain.value = 1;

    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = LIMITER_THRESHOLD_DB;
    limiter.knee.value = LIMITER_KNEE_DB;
    limiter.ratio.value = LIMITER_RATIO;
    limiter.attack.value = LIMITER_ATTACK_SECONDS;
    limiter.release.value = LIMITER_RELEASE_SECONDS;

    // Internal wiring is permanent — only the edges connecting this chain
    // to the rest of the graph (outputGain → compressor, limiter/makeup →
    // destination) are toggled by _reconnect().
    compressor.connect(makeup);
    makeup.connect(limiter);

    this.compressor = compressor;
    this.makeup = makeup;
    this.limiter = limiter;
    this.graph.performance = { compressor, limiter, makeup };
  }

  _applyCompressionAmount() {
    if (!this.compressor) return;

    const amount = this.compressionAmount;
    const thresholdDb =
      THRESHOLD_MIN_DB + (THRESHOLD_MAX_DB - THRESHOLD_MIN_DB) * amount;
    const ratio = RATIO_MIN + (RATIO_MAX - RATIO_MIN) * amount;
    const now = this.context.currentTime;

    this.compressor.threshold.setTargetAtTime(thresholdDb, now, RAMP_SECONDS);
    this.compressor.ratio.setTargetAtTime(ratio, now, RAMP_SECONDS);

    // Auto make-up gain: half the theoretical maximum gain reduction at
    // this threshold/ratio (full-scale material would see the full
    // reduction; typical program material sits below that most of the
    // time), clamped so it can only ever restore lost level, never boost a
    // track beyond what compression took away.
    const makeupDb = clamp(Math.abs(thresholdDb) * (1 - 1 / ratio) * 0.5, 0, 6);
    this.makeup.gain.setTargetAtTime(dbToGain(makeupDb), now, RAMP_SECONDS);
  }

  _applyPreGain() {
    const { outputGain, context } = this.graph;
    let targetGain = 1;
    if (this.enabled && this.normalizeEnabled && this.targetLufs != null) {
      const gainDb = clamp(
        TARGET_LUFS - this.targetLufs,
        -MAX_CUT_DB,
        MAX_BOOST_DB,
      );
      targetGain = dbToGain(gainDb);
    }

    outputGain.gain.setTargetAtTime(
      targetGain,
      context.currentTime,
      RAMP_SECONDS,
    );
  }

  // Reconnects the playback edges to match current enabled/protection
  // state. Idempotent and non-destructive: disconnect() then connect() are
  // cheap graph edits, not node teardown, so this can run on every toggle
  // without ever creating or destroying a node.
  _reconnect() {
    const { outputGain, context } = this.graph;
    outputGain.disconnect();

    if (!this.enabled) {
      outputGain.connect(context.destination);
      return;
    }

    const { compressor, limiter, makeup } = this;
    limiter.disconnect();
    makeup.disconnect();

    outputGain.connect(compressor);
    makeup.connect(limiter);
    if (this.protectionEnabled) {
      limiter.connect(context.destination);
    } else {
      makeup.connect(context.destination);
    }
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this._ensureNodes();
      this._applyCompressionAmount();
    }

    this._reconnect();
    this._applyPreGain();
  }

  setCompressionAmount(amount) {
    this.compressionAmount = clamp(amount, 0, 1);
    if (this.enabled) this._applyCompressionAmount();
  }

  setOutputProtection(enabled) {
    this.protectionEnabled = enabled;
    if (this.enabled) this._reconnect();
  }

  setLoudnessNormalize(enabled, targetLufs) {
    this.normalizeEnabled = enabled;
    this.targetLufs = targetLufs;
    if (this.enabled) this._applyPreGain();
  }

  // Detaches this processor's playback edges (falling back to plain
  // passthrough) without touching the underlying nodes, which stay cached
  // on the graph for reuse by whatever mounts next. Call on unmount.
  dispose() {
    if (this.enabled) this.setEnabled(false);
  }
}
