// <copyright file="presets.js" company="John Narey">
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

// A preset is DATA — a bundle of settings for the granular processors
// (EQ/Compressor/Limiter/Saturation/Stereo/Filter) — not a processor
// itself. Applying one always targets those six directly and leaves
// Performance Mode off, so Performance Mode's own on/off toggle (which
// drives the same Compressor/Limiter instances — see PerformanceProcessor)
// can't silently overwrite what a preset just configured the next time
// someone flips it. No UI component should hard-code these values; this
// module is the only place they live.
export const PRESETS = [
  {
    id: 'clean',
    name: 'Clean / Hi-Fi',
    description: 'Preserves the original recording as closely as possible.',
    config: {
      eq: { enabled: false, low: 0, mid: 0, high: 0 },
      compressor: { enabled: true, amount: 0.05, attack: 0.015, release: 0.25 },
      limiter: { enabled: true, ceiling: -1, release: 0.15 },
      saturation: { enabled: false, amount: 0 },
      stereo: { enabled: false, width: 1 },
      filter: { enabled: false, position: 0, resonance: 1 },
    },
  },
  {
    id: 'performance',
    name: 'Performance',
    description: 'Primary general-purpose mode for DJ-style playback.',
    config: {
      eq: { enabled: false, low: 0, mid: 0, high: 0 },
      compressor: { enabled: true, amount: 0.5, attack: 0.01, release: 0.2 },
      limiter: { enabled: true, ceiling: -1, release: 0.1 },
      saturation: { enabled: true, amount: 0.1 },
      stereo: { enabled: true, width: 1 },
      filter: { enabled: false, position: 0, resonance: 1 },
    },
  },
  {
    id: 'club',
    name: 'Club',
    description: 'More energetic playback without going bass-heavy.',
    config: {
      eq: { enabled: true, low: 2, mid: 0, high: 1.5 },
      compressor: { enabled: true, amount: 0.55, attack: 0.008, release: 0.18 },
      limiter: { enabled: true, ceiling: -0.8, release: 0.1 },
      saturation: { enabled: true, amount: 0.2 },
      stereo: { enabled: true, width: 1.1 },
      filter: { enabled: false, position: 0, resonance: 1 },
    },
  },
  {
    id: 'loud',
    name: 'Loud',
    description:
      'Maximum perceived loudness while remaining listenable. Reduces dynamic range noticeably.',
    config: {
      eq: { enabled: false, low: 0, mid: 0, high: 0 },
      compressor: { enabled: true, amount: 0.85, attack: 0.006, release: 0.15 },
      limiter: { enabled: true, ceiling: -0.5, release: 0.08 },
      saturation: { enabled: true, amount: 0.25 },
      stereo: { enabled: true, width: 1 },
      filter: { enabled: false, position: 0, resonance: 1 },
    },
  },
  {
    id: 'punch',
    name: 'Punch',
    description:
      'Preserves transients — drums, house, techno, breaks. Slower attack lets hits through before compressing.',
    config: {
      eq: { enabled: true, low: 1.5, mid: 0, high: 0.5 },
      compressor: { enabled: true, amount: 0.4, attack: 0.03, release: 0.12 },
      limiter: { enabled: true, ceiling: -1, release: 0.1 },
      saturation: { enabled: true, amount: 0.1 },
      stereo: { enabled: true, width: 1 },
      filter: { enabled: false, position: 0, resonance: 1 },
    },
  },
  {
    id: 'warm',
    name: 'Warm',
    description: 'Light compression, subtle saturation, gentle low-mid lift.',
    config: {
      eq: { enabled: true, low: 1.5, mid: 0.5, high: -1.5 },
      compressor: { enabled: true, amount: 0.25, attack: 0.015, release: 0.25 },
      limiter: { enabled: true, ceiling: -1.2, release: 0.15 },
      saturation: { enabled: true, amount: 0.3 },
      stereo: { enabled: true, width: 1 },
      filter: { enabled: false, position: 0, resonance: 1 },
    },
  },
  {
    id: 'bright',
    name: 'Bright',
    description: 'Controlled high-frequency lift without harshness.',
    config: {
      eq: { enabled: true, low: -0.5, mid: 0, high: 2.5 },
      compressor: { enabled: true, amount: 0.3, attack: 0.01, release: 0.2 },
      limiter: { enabled: true, ceiling: -1, release: 0.1 },
      saturation: { enabled: true, amount: 0.12 },
      stereo: { enabled: true, width: 1 },
      filter: { enabled: false, position: 0, resonance: 1 },
    },
  },
  {
    id: 'dj-mix',
    name: 'DJ / Mix',
    description:
      'Designed for live manipulation — EQ, filter, compression, limiting and loudness levelling all engaged.',
    config: {
      eq: { enabled: true, low: 0, mid: 0, high: 0 },
      compressor: { enabled: true, amount: 0.45, attack: 0.01, release: 0.18 },
      limiter: { enabled: true, ceiling: -1, release: 0.1 },
      saturation: { enabled: false, amount: 0 },
      stereo: { enabled: true, width: 1 },
      filter: { enabled: true, position: 0, resonance: 1 },
    },
  },
];

// Applies one preset's config to the live processor instances. `dsp` is
// the object returned by mediaAudioGraph's graph.dsp — the same instances
// every processor's own UI panel reads and writes, so a preset and a
// user's manual tweak afterward operate on one shared source of truth.
export const applyPreset = (dsp, presetId) => {
  const preset = PRESETS.find((entry) => entry.id === presetId);
  if (!preset || !dsp) return;

  const { config } = preset;

  dsp.eq.setLow(config.eq.low);
  dsp.eq.setMid(config.eq.mid);
  dsp.eq.setHigh(config.eq.high);
  dsp.eq.setEnabled(config.eq.enabled);

  dsp.compressor.setAttack(config.compressor.attack);
  dsp.compressor.setRelease(config.compressor.release);
  dsp.compressor.setAmount(config.compressor.amount);
  dsp.compressor.setEnabled(config.compressor.enabled);

  dsp.limiter.setCeiling(config.limiter.ceiling);
  dsp.limiter.setRelease(config.limiter.release);
  dsp.limiter.setEnabled(config.limiter.enabled);

  dsp.saturation.setAmount(config.saturation.amount);
  dsp.saturation.setEnabled(config.saturation.enabled);

  dsp.stereo.setWidth(config.stereo.width);
  dsp.stereo.setEnabled(config.stereo.enabled);

  dsp.filter.setPosition(config.filter.position);
  dsp.filter.setResonance(config.filter.resonance);
  dsp.filter.setEnabled(config.filter.enabled);

  // A preset always takes direct control of the granular processors above
  // — Performance Mode's own toggle must be off so it can't clobber this
  // the next time someone flips it (see PerformanceProcessor's doc comment
  // on why it drives the same shared instances).
  dsp.performance.setEnabled(false);
};
