// <copyright file="scratch-processor.js" company="John Narey">
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

// Reads samples from a pre-decoded track buffer at a continuously-updated
// position, rather than at a fixed 1x forward rate — this is what makes
// reverse/variable-speed "scratch" playback possible at all, since
// AudioBufferSourceNode only supports a fixed, positive, one-shot playback
// rate and can't be repositioned once started.

// Caps how fast the read head can move, in samples per output sample (i.e.
// playback speed multiples of normal). Without a cap, a large gap between
// drag updates gets closed within a single ~2.9ms render quantum regardless
// of size, which sounds like an unbounded-speed shriek rather than a scratch.
const MAX_SPEED = 6;

class ScratchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null; // Float32Array per channel, whole-track PCM
    this.length = 0;
    this.position = 0; // current read head, in samples (fractional)
    this.targetPosition = 0; // where the drag wants the read head to be
    this.scratching = false;
    this.reportCounter = 0;

    this.port.onmessage = (event) => {
      const message = event.data;
      switch (message.type) {
        case 'load': {
          this.channels = message.channels;
          this.length = this.channels[0]?.length ?? 0;
          this.position = message.startPosition ?? 0;
          this.targetPosition = this.position;
          break;
        }

        case 'scratchStart': {
          this.scratching = true;
          this.position = message.position;
          this.targetPosition = message.position;
          break;
        }

        case 'scratchMove': {
          this.targetPosition = message.position;
          break;
        }

        case 'scratchEnd': {
          this.scratching = false;
          break;
        }

        case 'unload': {
          this.channels = null;
          this.length = 0;
          break;
        }

        default:
          break;
      }
    };
  }

  // Linear interpolation between neighbouring samples — needed because the
  // read head moves at a variable (and often fractional, sometimes negative)
  // rate, not a fixed integer step.
  readSample(channelData, position) {
    const index = Math.floor(position);
    const fraction = position - index;
    const a = channelData[index] ?? 0;
    const b = channelData[index + 1] ?? a;
    return a + (b - a) * fraction;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const frameCount = output[0]?.length ?? 0;

    if (!this.channels || this.length === 0) {
      return true;
    }

    for (let frame = 0; frame < frameCount; frame++) {
      let step;
      if (this.scratching) {
        // Move toward targetPosition at a capped speed rather than always
        // closing the whole gap within this ~2.9ms quantum — a real drag can
        // easily imply a gap of thousands of samples between pointermove
        // updates, which without a cap made the read head "zip" to catch up
        // at extreme, unbounded speed every quantum (sounds like a shriek,
        // not a scratch). Falling behind and catching up gradually over
        // several quanta instead sounds like an actual bounded-speed scratch.
        const remaining = frameCount - frame;
        const desiredStep = (this.targetPosition - this.position) / remaining;
        step = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, desiredStep));
      } else {
        // Not actively being dragged — hold position (silence/last sample)
        // rather than auto-advancing; MediaPlayer hands control straight
        // back to the normal <audio> element on release, so this processor
        // is only ever live while a drag is in progress.
        step = 0;
      }

      this.position = Math.max(
        0,
        Math.min(this.length - 1, this.position + step),
      );

      for (const [channel, outChannel] of output.entries()) {
        const channelData =
          this.channels[Math.min(channel, this.channels.length - 1)];
        outChannel[frame] = this.readSample(channelData, this.position);
      }
    }

    this.reportCounter += 1;
    if (this.reportCounter >= 4) {
      this.reportCounter = 0;
      // AudioWorkletProcessor.port (MessagePort) send, not window.postMessage
      // — there's no targetOrigin parameter in this API.
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      this.port.postMessage({ position: this.position, type: 'position' });
    }

    return true;
  }
}

registerProcessor('scratch-processor', ScratchProcessor);
