// <copyright file="FilterProcessor.js" company="John Narey">
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

export const RESONANCE_MIN = 0.5;
export const RESONANCE_MAX = 10;
const RAMP_SECONDS = 0.03;

// A single knob's worth of DJ-style sweep filter: one BiquadFilterNode
// whose type flips between highpass and lowpass around a center "position"
// (-1..1). 0 is wide open (highpass floor / lowpass ceiling, effectively
// inaudible); negative sweeps a rising highpass; positive sweeps a
// falling lowpass — the classic one-knob mixer/DJ-controller filter feel.
const HIGHPASS_FLOOR_HZ = 20;
const HIGHPASS_CEILING_HZ = 4_000;
const LOWPASS_FLOOR_HZ = 200;
const LOWPASS_CEILING_HZ = 20_000;

// Logarithmic sweep — filter frequency perception is logarithmic, so a
// linear knob-to-Hz mapping would spend most of its travel doing nothing
// audible at the top end.
const logSweep = (t, floorHz, ceilingHz) =>
  floorHz * (ceilingHz / floorHz) ** t;

export class FilterProcessor extends AudioProcessor {
  constructor(context) {
    super(context);

    this.filter = context.createBiquadFilter();
    this.filter.type = 'highpass';
    this.filter.frequency.value = HIGHPASS_FLOOR_HZ;
    this.filter.Q.value = 1;

    this.position = 0;
    this.resonance = 1;
  }

  getInputNode() {
    return this.filter;
  }

  getOutputNode() {
    return this.filter;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      position: this.position,
      resonance: this.resonance,
    };
  }

  setPosition(position) {
    this.position = clamp(position, -1, 1);
    const now = this.context.currentTime;

    if (this.position <= 0) {
      // -1..0 -> 1..0 -> highpass frequency ceiling..floor.
      this.filter.type = 'highpass';
      const t = -this.position;
      this.filter.frequency.setTargetAtTime(
        logSweep(t, HIGHPASS_FLOOR_HZ, HIGHPASS_CEILING_HZ),
        now,
        RAMP_SECONDS,
      );
    } else {
      // 0..1 -> lowpass frequency ceiling..floor.
      this.filter.type = 'lowpass';
      const t = this.position;
      this.filter.frequency.setTargetAtTime(
        logSweep(1 - t, LOWPASS_FLOOR_HZ, LOWPASS_CEILING_HZ),
        now,
        RAMP_SECONDS,
      );
    }

    this._notify();
  }

  setResonance(q) {
    this.resonance = clamp(q, RESONANCE_MIN, RESONANCE_MAX);
    this.filter.Q.setTargetAtTime(
      this.resonance,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }
}
