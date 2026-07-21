// <copyright file="scratchEngine.js" company="John Narey">
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

import { getLocalStreamUrl } from './files';
import { ensureSigned } from './streamSignatures';

// Drives real (reverse/variable-speed) scratch playback via a decoded
// AudioBuffer + AudioWorkletNode, only while a drag gesture is active.
// MediaPlayer pauses the normal <audio> element for the gesture's duration
// and hands control back to it on release — this class only owns the
// scratch-mode audio path, not regular playback.
export class ScratchEngine {
  constructor() {
    this.context = null;
    this.workletLoaded = false;
    this.workletNode = null;
    this.bufferPath = null;
    this.channels = null;
    this.sampleRate = 44_100;
    this.decoding = null;
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextClass();
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    if (!this.workletLoaded) {
      await this.context.audioWorklet.addModule('/scratch-processor.js');
      this.workletLoaded = true;
    }

    return this.context;
  }

  // Decodes the whole track into memory ahead of time, so the first actual
  // scratch gesture doesn't stall on a multi-second decode. Safe to call
  // repeatedly — a decode already in flight or already cached is reused.
  async prepare(path) {
    if (!path || (this.bufferPath === path && this.channels)) return;
    if (this.decoding?.path === path) {
      await this.decoding.promise;
      return;
    }

    const context = await this.ensureContext();
    const promise = (async () => {
      await ensureSigned([path]);
      const response = await fetch(getLocalStreamUrl(path));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer);
      const channels = [];
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        channels.push(audioBuffer.getChannelData(channel));
      }

      this.channels = channels;
      this.sampleRate = audioBuffer.sampleRate;
      this.bufferPath = path;
    })();

    this.decoding = { path, promise };
    try {
      await promise;
    } catch {
      /* leave unprepared — startScratch below no-ops without a buffer */
    } finally {
      if (this.decoding?.path === path) this.decoding = null;
    }
  }

  isReady(path) {
    return this.bufferPath === path && Boolean(this.channels);
  }

  async startScratch(path, time) {
    const context = await this.ensureContext();
    await this.prepare(path);
    if (!this.channels || this.bufferPath !== path) return false;

    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {
        /* already disconnected */
      }
    }

    this.workletNode = new AudioWorkletNode(context, 'scratch-processor', {
      outputChannelCount: [this.channels.length],
    });
    this.workletNode.connect(context.destination);
    const position = time * this.sampleRate;
    // These are AudioWorkletNode.port (MessagePort) sends, not
    // window.postMessage — there's no targetOrigin parameter in this API.
    this.workletNode.port.postMessage({
      channels: this.channels,
      startPosition: position,
      type: 'load',
      // eslint-disable-next-line unicorn/require-post-message-target-origin
    });
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    this.workletNode.port.postMessage({ position, type: 'scratchStart' });
    return true;
  }

  moveScratch(time) {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      position: time * this.sampleRate,
      type: 'scratchMove',
      // eslint-disable-next-line unicorn/require-post-message-target-origin
    });
  }

  endScratch() {
    if (!this.workletNode) return;
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    this.workletNode.port.postMessage({ type: 'scratchEnd' });
    this.workletNode.disconnect();
    this.workletNode = null;
  }

  // Frees the decoded buffer (can be tens of MB per track) — call on track
  // change so only the current track's audio stays resident in memory.
  release() {
    this.endScratch();
    this.channels = null;
    this.bufferPath = null;
  }
}
