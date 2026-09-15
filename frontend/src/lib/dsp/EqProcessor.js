// <copyright file="EqProcessor.js" company="John Narey">
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

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
const RAMP_SECONDS = 0.05;

// 3-band music EQ: low shelf, mid peaking, high shelf. Fixed corner
// frequencies (typical "broadcast EQ" split) rather than exposing them —
// three sliders is the UI this was asked for, not a parametric EQ.
export class EQProcessor extends AudioProcessor {
  constructor(context) {
    super(context);

    this.lowNode = context.createBiquadFilter();
    this.lowNode.type = 'lowshelf';
    this.lowNode.frequency.value = 120;

    this.midNode = context.createBiquadFilter();
    this.midNode.type = 'peaking';
    this.midNode.frequency.value = 1_000;
    this.midNode.Q.value = 1;

    this.highNode = context.createBiquadFilter();
    this.highNode.type = 'highshelf';
    this.highNode.frequency.value = 8_000;

    this.lowNode.connect(this.midNode);
    this.midNode.connect(this.highNode);

    this.low = 0;
    this.mid = 0;
    this.high = 0;
  }

  getInputNode() {
    return this.lowNode;
  }

  getOutputNode() {
    return this.highNode;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      high: this.high,
      low: this.low,
      mid: this.mid,
    };
  }

  setLow(db) {
    this.low = clamp(db, EQ_MIN_DB, EQ_MAX_DB);
    this.lowNode.gain.setTargetAtTime(
      this.low,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }

  setMid(db) {
    this.mid = clamp(db, EQ_MIN_DB, EQ_MAX_DB);
    this.midNode.gain.setTargetAtTime(
      this.mid,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }

  setHigh(db) {
    this.high = clamp(db, EQ_MIN_DB, EQ_MAX_DB);
    this.highNode.gain.setTargetAtTime(
      this.high,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }
}
