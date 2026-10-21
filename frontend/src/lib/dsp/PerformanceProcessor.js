// <copyright file="PerformanceProcessor.js" company="John Narey">
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dbToGain = (db) => 10 ** (db / 20);

// Reference level for Loudness Normalise. -9 LUFS, not the -14
// streaming-standard target: most club/EDM/techno masters in this library
// run -6 to -9 LUFS, well louder than -14, so a -14 target would read as
// "everything got quieter" rather than levelling out the occasional
// outlier.
const TARGET_LUFS = -9;
const MAX_BOOST_DB = 6;
const MAX_CUT_DB = 12;
const RAMP_SECONDS = 0.08;

// NOT a processor in its own right — Performance Mode is a one-switch
// orchestrator over three things that already live in the rack:
// CompressorProcessor, LimiterProcessor, and the shared pre-gain node every
// processor sits downstream of (see mediaAudioGraph.js). It owns no Web
// Audio nodes itself, which is deliberate: the whole point is to reuse the
// same Compressor/Limiter the standalone panels drive, not maintain a
// second private compressor+limiter chain that could drift out of sync
// with what the Compressor/Limiter panels show.
//
// Trade-off worth knowing: because it's driving shared instances, turning
// Performance Mode on/off overwrites whatever the Compressor/Limiter
// panels were set to (forces them enabled/disabled to match). Manually
// tweaking Compressor while Performance Mode is on works — the amount
// slider on both is the same underlying value — but toggling Performance
// off will disable it, discarding that manual enable. Layering "resume my
// manual setting after Performance turns off" wasn't asked for and would
// add real state-machine complexity, so it's left as a known interaction
// rather than guessed at.
export class PerformanceProcessor {
  constructor({ compressor, limiter, outputGain, context }) {
    this.compressor = compressor;
    this.limiter = limiter;
    this.outputGain = outputGain;
    this.context = context;

    this.enabled = false;
    this.advanced = false;
    this.protectionEnabled = true;
    this.normalizeEnabled = true;
    this.compressionAmount = 0.5;
    this.targetLufs = null;
    // Not an AudioProcessor subclass (see class doc), but the same
    // problem applies: presets.js can flip `enabled` directly, and the
    // panel showing this needs to hear about it — see EQProcessor etc.
    // for the same pattern via AudioProcessor.subscribe().
    this._listeners = new Set();
  }

  subscribe(listener) {
    this._listeners.add(listener);
    listener(this.snapshot());
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return {
      compressionAmount: this.compressionAmount,
      enabled: this.enabled,
      normalizeEnabled: this.normalizeEnabled,
      protectionEnabled: this.protectionEnabled,
    };
  }

  _notify() {
    const snap = this.snapshot();
    for (const listener of this._listeners) listener(snap);
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;

    this.compressor.setEnabled(enabled);
    this.limiter.setEnabled(enabled && this.protectionEnabled);
    if (enabled) this.compressor.setAmount(this.compressionAmount);
    this._applyPreGain();
    this._notify();
  }

  setAdvanced(value) {
    this.advanced = Boolean(value);
    this._applyPreGain();
  }

  setCompressionAmount(amount) {
    this.compressionAmount = clamp(amount, 0, 1);
    if (this.enabled) this.compressor.setAmount(this.compressionAmount);
    this._notify();
  }

  setOutputProtection(enabled) {
    this.protectionEnabled = enabled;
    if (this.enabled) this.limiter.setEnabled(enabled);
    this._notify();
  }

  setLoudnessNormalize(enabled, targetLufs) {
    this.normalizeEnabled = enabled;
    this.targetLufs = targetLufs;
    if (this.enabled) this._applyPreGain();
    this._notify();
  }

  _applyPreGain() {
    let targetGain = 1;
    if (this.enabled && this.normalizeEnabled && this.targetLufs != null) {
      const gainDb = clamp(
        TARGET_LUFS - this.targetLufs,
        this.advanced ? -MAX_CUT_DB : -3,
        this.advanced ? MAX_BOOST_DB : 0,
      );
      targetGain = dbToGain(gainDb);
    }

    this.outputGain.gain.setTargetAtTime(
      targetGain,
      this.context.currentTime,
      RAMP_SECONDS,
    );
  }

  dispose() {
    if (this.enabled) this.setEnabled(false);
  }
}
