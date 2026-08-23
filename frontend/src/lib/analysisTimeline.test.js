// <copyright file="analysisTimeline.test.js" company="John Narey">
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

import {
  analysisToPlaybackTime,
  pixelToTime,
  playbackToAnalysisTime,
  resolveBeatAvailability,
  resolveWaveformDuration,
  timeToPixel,
} from './analysisTimeline';

describe('resolveWaveformDuration', () => {
  // Real values captured from "Cordial" (Z.I.P.P.O & Hiver), a VBR MP3 whose
  // HTMLAudioElement.duration Chromium revises upward across playback while
  // currentTime stays accurate — the bug this function fixes.
  const analysisDuration = 400.704_4;
  const trackLength = 400.728;
  const initialAudioDuration = 400.704;
  const finalAudioDuration = 402.361_7;

  it('prefers the analysis duration when present, regardless of audio.duration', () => {
    expect(
      resolveWaveformDuration(
        analysisDuration,
        trackLength,
        initialAudioDuration,
      ),
    ).toBe(analysisDuration);
    expect(
      resolveWaveformDuration(
        analysisDuration,
        trackLength,
        finalAudioDuration,
      ),
    ).toBe(analysisDuration);
  });

  it('does not change when audio.duration is revised mid-playback (the durationchange bug)', () => {
    const atStart = resolveWaveformDuration(
      analysisDuration,
      trackLength,
      initialAudioDuration,
    );
    const atEnd = resolveWaveformDuration(
      analysisDuration,
      trackLength,
      finalAudioDuration,
    );
    expect(atEnd).toBe(atStart);
  });

  it('falls back to track length when no analysis duration is stored yet', () => {
    expect(resolveWaveformDuration(null, trackLength, finalAudioDuration)).toBe(
      trackLength,
    );
    expect(
      resolveWaveformDuration(undefined, trackLength, finalAudioDuration),
    ).toBe(trackLength);
  });

  it('falls back to audio.duration only as a last resort', () => {
    expect(resolveWaveformDuration(null, null, finalAudioDuration)).toBe(
      finalAudioDuration,
    );
    expect(resolveWaveformDuration(undefined, undefined, 123.45)).toBe(123.45);
  });

  it('treats zero, negative, and non-finite values as absent at every tier', () => {
    expect(resolveWaveformDuration(0, trackLength, finalAudioDuration)).toBe(
      trackLength,
    );
    expect(resolveWaveformDuration(-5, trackLength, finalAudioDuration)).toBe(
      trackLength,
    );
    expect(resolveWaveformDuration(Number.NaN, 0, finalAudioDuration)).toBe(
      finalAudioDuration,
    );
    expect(resolveWaveformDuration(null, null, Number.POSITIVE_INFINITY)).toBe(
      0,
    );
    expect(resolveWaveformDuration(null, null, 0)).toBe(0);
  });
});

describe('timeToPixel', () => {
  it('maps 0/25/50/75/100% of a duration to the corresponding fraction of the width', () => {
    const duration = 400;
    const width = 800;
    expect(timeToPixel(0, duration, width)).toBe(0);
    expect(timeToPixel(100, duration, width)).toBe(200);
    expect(timeToPixel(200, duration, width)).toBe(400);
    expect(timeToPixel(300, duration, width)).toBe(600);
    expect(timeToPixel(400, duration, width)).toBe(800);
  });

  it('returns 0 for a non-positive duration rather than dividing by zero', () => {
    expect(timeToPixel(10, 0, 800)).toBe(0);
    expect(timeToPixel(10, -5, 800)).toBe(0);
  });

  it('works for a zoomed sub-window by treating it as its own (duration, width) span', () => {
    // A window covering [100, 200) of a track, drawn across 400px, is the same formula as
    // the whole-track case above — zoom is a choice of span, not a second mapping.
    const windowDuration = 100;
    const windowWidth = 400;
    const relativeTime = 25; // 25s into the 100s window == absolute time 125s
    expect(timeToPixel(relativeTime, windowDuration, windowWidth)).toBe(100);
  });
});

describe('pixelToTime', () => {
  it('is the inverse of timeToPixel', () => {
    const duration = 400;
    const width = 800;
    expect(pixelToTime(0, duration, width)).toBe(0);
    expect(pixelToTime(200, duration, width)).toBe(100);
    expect(pixelToTime(400, duration, width)).toBe(200);
    expect(pixelToTime(800, duration, width)).toBe(400);
  });

  it('returns 0 for a non-positive width rather than dividing by zero', () => {
    expect(pixelToTime(100, 400, 0)).toBe(0);
    expect(pixelToTime(100, 400, -10)).toBe(0);
  });
});

describe('time -> pixel -> time round trip', () => {
  it('recovers the original time within floating-point precision, for arbitrary points', () => {
    const duration = 483.439_456;
    const width = 917; // an odd width on purpose — not a multiple of duration
    for (const fraction of [0, 0.1, 0.25, 0.333, 0.5, 0.75, 0.999, 1]) {
      const time = fraction * duration;
      const pixel = timeToPixel(time, duration, width);
      const roundTripped = pixelToTime(pixel, duration, width);
      expect(roundTripped).toBeCloseTo(time, 9);
    }
  });
});

describe('playbackToAnalysisTime / analysisToPlaybackTime', () => {
  // Both are the identity function today — proven, not assumed: an independent
  // decodeAudioData decode of a real VBR MP3 with a measured ~23ms LAME encoder delay landed
  // within ~0.02ms of the backend's ffmpeg-based analysis decode. These tests exist so that if
  // either function ever stops being the identity, something breaks loudly here rather than
  // silently at the pixel level.
  it('playbackToAnalysisTime returns its input unchanged', () => {
    for (const t of [0, 0.023, 100.176, 400.704_014, 999.999]) {
      expect(playbackToAnalysisTime(t)).toBe(t);
    }
  });

  it('analysisToPlaybackTime returns its input unchanged', () => {
    for (const t of [0, 0.023, 100.176, 400.704_014, 999.999]) {
      expect(analysisToPlaybackTime(t)).toBe(t);
    }
  });

  it('are exact inverses of one another', () => {
    for (const t of [0, 12.5, 483.439_456]) {
      expect(analysisToPlaybackTime(playbackToAnalysisTime(t))).toBe(t);
      expect(playbackToAnalysisTime(analysisToPlaybackTime(t))).toBe(t);
    }
  });
});

describe('resolveBeatAvailability', () => {
  it('reports known:true and passes through the real offset/beats when analysis exists', () => {
    const beats = [0.429_7, 0.963_6, 1.497_7];
    const result = resolveBeatAvailability({
      beatOffsetSeconds: 0.429_7,
      beats,
    });
    expect(result.known).toBe(true);
    expect(result.offsetSeconds).toBe(0.429_7);
    expect(result.beats).toBe(beats);
  });

  it('reports known:false — not a fabricated zero offset — when beatOffsetSeconds is null', () => {
    // This is the exact shape "Cordial" returns: BPM tag present, but Essentia never ran.
    const result = resolveBeatAvailability({
      beatOffsetSeconds: null,
      beats: null,
    });
    expect(result.known).toBe(false);
    expect(result.offsetSeconds).toBeNull();
    expect(result.beats).toBeNull();
  });

  it('reports known:false for undefined/missing beat data, not just explicit null', () => {
    expect(resolveBeatAvailability({}).known).toBe(false);
    expect(resolveBeatAvailability(null).known).toBe(false);
    expect(resolveBeatAvailability(undefined).known).toBe(false);
  });

  it('treats an offset of exactly 0 seconds as real analysis, not as "unknown"', () => {
    // A track whose rhythm genuinely starts at 0:00 must not be indistinguishable from one
    // with no analysis at all — this is the whole point of not defaulting via `|| 0`.
    const result = resolveBeatAvailability({
      beatOffsetSeconds: 0,
      beats: [0, 0.5, 1],
    });
    expect(result.known).toBe(true);
    expect(result.offsetSeconds).toBe(0);
  });
});
