// <copyright file="sound.js" company="John Narey">
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

let audioContext = null;

const getAudioContext = () => {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
  }

  return audioContext;
};

const tone = (ctx, { delay, duration, frequency }) => {
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.000_1, start + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
};

const patterns = {
  RoomMessageReceived: [660],
  PrivateMessageReceived: [880, 1_318.5],
  RoomMention: [1_046.5, 1_318.5, 1_568],
  DownloadDirectoryComplete: [523.25, 783.99],
  DownloadFileComplete: [523.25, 783.99],
  UploadFileComplete: [783.99, 523.25],
  SoulseekClientConnected: [440, 660],
  SoulseekClientDisconnected: [660, 440],
};

// Unlock during a gesture, before the first asynchronous hub notification.
const unlock = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    /* Web Audio is optional. */
  }
};

export const enableNotificationAudio = () => {
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
};

let lastSoundAt = 0;
export const playNotificationSound = async (
  type,
  { fallback = false } = {},
) => {
  const frequencies =
    patterns[type] || (fallback ? patterns.PrivateMessageReceived : null);
  if (!frequencies || Date.now() - lastSoundAt < 750) return;
  lastSoundAt = Date.now();
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    for (const [index, frequency] of frequencies.entries()) {
      tone(ctx, { delay: index * 0.09, duration: 0.16, frequency });
    }
  } catch {
    /* Web Audio unsupported or blocked. */
  }
};

export const playMessageReceived = () =>
  playNotificationSound('PrivateMessageReceived');
