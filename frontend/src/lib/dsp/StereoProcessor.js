// <copyright file="StereoProcessor.js" company="John Narey">
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

export const WIDTH_MIN = 0;
export const WIDTH_MAX = 2;
const RAMP_SECONDS = 0.05;

// Mid/Side stereo widener: split L/R into mid ((L+R)/2, mono-compatible
// content) and side ((L-R)/2, the stereo difference), scale only the side
// signal by `width`, then reconstruct L' = mid + side', R' = mid - side'.
// At width=1 this reconstructs the original signal exactly; width=0
// collapses to mono (L'=R'=mid); width>1 exaggerates the stereo image.
// Scaling the side component alone — rather than e.g. a naive
// haas/delay trick — is what keeps this mono-compatible at any width.
export class StereoProcessor extends AudioProcessor {
  constructor(context) {
    super(context);

    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);

    const midGainL = context.createGain();
    midGainL.gain.value = 0.5;
    const midGainR = context.createGain();
    midGainR.gain.value = 0.5;
    const midSum = context.createGain();
    midSum.gain.value = 1;

    const sideGainL = context.createGain();
    sideGainL.gain.value = 0.5;
    const sideGainR = context.createGain();
    sideGainR.gain.value = -0.5;
    const sideSum = context.createGain();
    sideSum.gain.value = 1;

    const widthGain = context.createGain();
    widthGain.gain.value = 1;
    const invertGain = context.createGain();
    invertGain.gain.value = -1;

    splitter.connect(midGainL, 0);
    splitter.connect(midGainR, 1);
    splitter.connect(sideGainL, 0);
    splitter.connect(sideGainR, 1);
    midGainL.connect(midSum);
    midGainR.connect(midSum);
    sideGainL.connect(sideSum);
    sideGainR.connect(sideSum);
    sideSum.connect(widthGain);
    widthGain.connect(invertGain);

    // Left output channel: mid + widened side.
    midSum.connect(merger, 0, 0);
    widthGain.connect(merger, 0, 0);
    // Right output channel: mid - widened side.
    midSum.connect(merger, 0, 1);
    invertGain.connect(merger, 0, 1);

    this.splitter = splitter;
    this.merger = merger;
    this.widthGain = widthGain;
    this.width = 1;
  }

  getInputNode() {
    return this.splitter;
  }

  getOutputNode() {
    return this.merger;
  }

  snapshot() {
    return { ...super.snapshot(), width: this.width };
  }

  setWidth(width) {
    this.width = clamp(width, WIDTH_MIN, WIDTH_MAX);
    this.widthGain.gain.setTargetAtTime(
      this.width,
      this.context.currentTime,
      RAMP_SECONDS,
    );
    this._notify();
  }
}
