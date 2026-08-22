// <copyright file="CompressorProcessor.js" company="John Narey">
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

import { AudioProcessor } from './AudioProcessor';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dbToGain = (db) => 10 ** (db / 20);

// "Amount" (0..1) sweeps threshold and ratio together between a light touch
// and a firmer, still-musical setting — separate Threshold/Ratio/Knee
// sliders would be more precise but less usable for a player aimed at
// "make this sound more even," not mix engineering.
const THRESHOLD_MIN_DB = -6;
const THRESHOLD_MAX_DB = -18;
const RATIO_MIN = 1.5;
const RATIO_MAX = 4;
const KNEE_DB = 6;

export const ATTACK_MIN_SECONDS = 0.001;
export const ATTACK_MAX_SECONDS = 0.05;
export const RELEASE_MIN_SECONDS = 0.05;
export const RELEASE_MAX_SECONDS = 0.5;

const RAMP_SECONDS = 0.08;

// Single-band bus compressor: DynamicsCompressorNode + an auto make-up
// GainNode so turning it up doesn't quietly turn the track down too.
export class CompressorProcessor extends AudioProcessor {
  constructor(context) {
    super(context);

    this.compressor = context.createDynamicsCompressor();
    this.compressor.knee.value = KNEE_DB;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.2;

    this.makeup = context.createGain();
    this.makeup.gain.value = 1;

    this.compressor.connect(this.makeup);

    this.amount = 0.5;
    this.attack = this.compressor.attack.value;
    this.release = this.compressor.release.value;
  }

  getInputNode() {
    return this.compressor;
  }

  getOutputNode() {
    return this.makeup;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      amount: this.amount,
      attack: this.attack,
      release: this.release,
    };
  }

  setAmount(amount) {
    this.amount = clamp(amount, 0, 1);
    const thresholdDb =
      THRESHOLD_MIN_DB + (THRESHOLD_MAX_DB - THRESHOLD_MIN_DB) * this.amount;
    const ratio = RATIO_MIN + (RATIO_MAX - RATIO_MIN) * this.amount;
    const now = this.context.currentTime;

    this.compressor.threshold.setTargetAtTime(thresholdDb, now, RAMP_SECONDS);
    this.compressor.ratio.setTargetAtTime(ratio, now, RAMP_SECONDS);

    // Half the theoretical maximum gain reduction at this threshold/ratio,
    // clamped — restores level compression removed without re-inflating
    // the track past what it took away.
    const makeupDb = clamp(Math.abs(thresholdDb) * (1 - 1 / ratio) * 0.5, 0, 6);
    this.makeup.gain.setTargetAtTime(dbToGain(makeupDb), now, RAMP_SECONDS);
    this._notify();
  }

  setAttack(seconds) {
    this.attack = clamp(seconds, ATTACK_MIN_SECONDS, ATTACK_MAX_SECONDS);
    this.compressor.attack.setTargetAtTime(
      this.attack,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }

  setRelease(seconds) {
    this.release = clamp(seconds, RELEASE_MIN_SECONDS, RELEASE_MAX_SECONDS);
    this.compressor.release.setTargetAtTime(
      this.release,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }
}
