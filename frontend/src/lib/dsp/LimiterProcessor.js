// <copyright file="LimiterProcessor.js" company="John Narey">
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

export const CEILING_MIN_DB = -3;
export const CEILING_MAX_DB = -0.1;
export const RELEASE_MIN_SECONDS = 0.02;
export const RELEASE_MAX_SECONDS = 0.3;

const RAMP_SECONDS = 0.08;

// Final safety stage — NOT a mix-bus compressor, so only Ceiling and
// Release are exposed. Knee (0, hard) and ratio (20:1, the
// DynamicsCompressorNode maximum) stay fixed at the most limiter-like
// values the node allows; attack stays fast and fixed (2ms) because a
// safety stage that lets the user slow its attack down defeats the point.
// This is the honest limit of what a stock browser node can do — it is not
// a true lookahead brick-wall limiter, just the closest approximation
// available without a custom AudioWorklet/WASM limiter.
const KNEE_DB = 0;
const RATIO = 20;
const ATTACK_SECONDS = 0.002;

export class LimiterProcessor extends AudioProcessor {
  constructor(context) {
    super(context);

    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = KNEE_DB;
    this.limiter.ratio.value = RATIO;
    this.limiter.attack.value = ATTACK_SECONDS;
    this.limiter.release.value = 0.1;

    this.ceiling = this.limiter.threshold.value;
    this.release = this.limiter.release.value;
  }

  getInputNode() {
    return this.limiter;
  }

  getOutputNode() {
    return this.limiter;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      ceiling: this.ceiling,
      release: this.release,
    };
  }

  setCeiling(dbfs) {
    this.ceiling = clamp(dbfs, CEILING_MIN_DB, CEILING_MAX_DB);
    this.limiter.threshold.setTargetAtTime(
      this.ceiling,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }

  setRelease(seconds) {
    this.release = clamp(seconds, RELEASE_MIN_SECONDS, RELEASE_MAX_SECONDS);
    this.limiter.release.setTargetAtTime(
      this.release,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }
}
