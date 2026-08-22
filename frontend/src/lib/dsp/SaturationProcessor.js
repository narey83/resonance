// <copyright file="SaturationProcessor.js" company="John Narey">
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
const RAMP_SECONDS = 0.05;
const CURVE_SAMPLES = 1_024;

// tanh soft-clip — asymptotically approaches ±1 rather than hard-clipping,
// which is what makes it sound like harmonic warmth instead of digital
// distortion. `drive` pushes more of the signal into the curved region.
const buildCurve = (drive) => {
  const curve = new Float32Array(CURVE_SAMPLES);
  const k = 1 + drive * 9; // drive 0..1 -> effective gain into the curve 1..10
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const x = (i / (CURVE_SAMPLES - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }

  return curve;
};

// Subtle musical saturation: a WaveShaperNode on a "wet" branch, mixed
// back with the unprocessed "dry" signal via two gain nodes so the effect
// stays additive/harmonic rather than replacing the source entirely — a
// 100%-wet waveshaper on full-mix material reads as distortion, not warmth.
export class SaturationProcessor extends AudioProcessor {
  constructor(context) {
    super(context);

    this.input = context.createGain();
    this.input.gain.value = 1;

    this.dry = context.createGain();
    this.wet = context.createGain();
    this.shaper = context.createWaveShaper();
    this.shaper.oversample = '2x';

    this.output = context.createGain();
    this.output.gain.value = 1;

    this.input.connect(this.dry);
    this.input.connect(this.shaper);
    this.shaper.connect(this.wet);
    this.dry.connect(this.output);
    this.wet.connect(this.output);

    this.amount = 0.15;
    this._applyAmount();
  }

  getInputNode() {
    return this.input;
  }

  getOutputNode() {
    return this.output;
  }

  snapshot() {
    return { ...super.snapshot(), amount: this.amount };
  }

  setAmount(amount) {
    this.amount = clamp(amount, 0, 1);
    this._applyAmount();
    this._notify();
  }

  _applyAmount() {
    this.shaper.curve = buildCurve(this.amount);
    const now = this.context.currentTime;
    // Wet ramps in as amount increases; dry never drops below ~40% so even
    // at full amount there's still a recognisable, un-saturated component.
    this.wet.gain.setTargetAtTime(this.amount, now, RAMP_SECONDS);
    this.dry.gain.setTargetAtTime(1 - this.amount * 0.6, now, RAMP_SECONDS);
  }
}
