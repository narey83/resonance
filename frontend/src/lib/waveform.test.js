// <copyright file="waveform.test.js" company="John Narey">
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
  beatGridPhase,
  beatGridSeconds,
  compareBeats,
  estimatedPhraseBarMarkers,
  expectedBeats,
  firstGridLineAt,
  resamplePeaks,
  visibleBeats,
  visibleBeatTimes,
  visibleSampledBeatTimes,
  waveColours,
  waveformBeatBpm,
} from './waveform';

// 128bpm: 0.469s a beat. The scales below are what the player's seek bar
// actually works at — a 5 minute track across ~900px is 3 pixels a second.
const BEAT = 60 / 128;
const measured = (count, start = 0.09) =>
  Array.from({ length: count }, (_, index) => start + index * 0.5);

describe('estimatedPhraseBarMarkers', () => {
  it('counts 16 and 32 bars from measured beats with distinct levels', () => {
    expect(estimatedPhraseBarMarkers(measured(129), 65)).toEqual([
      { seconds: 0.09, level: 2 },
      { seconds: 32.09, level: 1 },
      { seconds: 64.09, level: 2 },
    ]);
  });

  it('keeps the count after a missed beat and omits a missed boundary', () => {
    const skippedBeforeBoundary = measured(129).filter(
      (_, index) => index !== 61,
    );
    expect(estimatedPhraseBarMarkers(skippedBeforeBoundary, 65)[1]).toEqual({
      seconds: 32.09,
      level: 1,
    });

    const skippedBoundary = measured(129).filter((_, index) => index !== 64);
    expect(estimatedPhraseBarMarkers(skippedBoundary, 65)).toEqual([
      { seconds: 0.09, level: 2 },
      { seconds: 64.09, level: 2 },
    ]);
  });

  it('keeps the count when a detector misses a tick repeatedly', () => {
    const repeatedMisses = measured(160).filter((_, index) => index % 8 !== 7);
    expect(estimatedPhraseBarMarkers(repeatedMisses, 80)).toEqual([
      { seconds: 0.09, level: 2 },
      { seconds: 32.09, level: 1 },
      { seconds: 64.09, level: 2 },
    ]);
  });

  it('never extrapolates before a delayed start or across an unknown silent gap', () => {
    const late = measured(129, 12.09);
    expect(estimatedPhraseBarMarkers(late, 77.5)[0].seconds).toBe(12.09);

    const gap = [...measured(80), ...measured(80, 48.09)];
    expect(estimatedPhraseBarMarkers(gap, 90)).toEqual([
      { seconds: 0.09, level: 2 },
      { seconds: 32.09, level: 1 },
      { seconds: 48.09, level: 2 },
      { seconds: 80.09, level: 1 },
    ]);
  });

  it('resumes provisional phrases after irregular timing and a half-time breakdown', () => {
    const opening = measured(129);
    const breakdown = Array.from(
      { length: 45 },
      (_, index) => 65.2 + index * 0.9,
    );
    const outro = measured(129, 107);
    const markers = estimatedPhraseBarMarkers(
      [...opening, ...breakdown, ...outro],
      172,
    );
    expect(markers).toEqual(
      expect.arrayContaining([
        { seconds: 64.09, level: 2 },
        { seconds: 107, level: 2 },
        { seconds: 139, level: 1 },
      ]),
    );
  });

  it('uses a supported bar origin after a pickup and clips at analysis duration', () => {
    expect(estimatedPhraseBarMarkers(measured(130), 64.5, 0.59)).toEqual([
      { seconds: 0.59, level: 2 },
      { seconds: 32.59, level: 1 },
    ]);
    expect(estimatedPhraseBarMarkers(measured(129), 64)).toEqual([
      { seconds: 0.09, level: 2 },
      { seconds: 32.09, level: 1 },
    ]);
  });

  it('omits a lone opening marker and rejects invalid beat timelines', () => {
    expect(estimatedPhraseBarMarkers(measured(20), 20)).toEqual([]);
    expect(estimatedPhraseBarMarkers([0.1, 0.1, 0.6], 10)).toEqual([]);
    expect(estimatedPhraseBarMarkers(measured(129), 65, 5)).toEqual([]);
  });

  it('aligns a provisional 32-bar guide to a measured sustained low-end section rise', () => {
    const overallPeaks = Array.from({ length: 6_500 }).fill(0.3);
    const lowPeaks = Array.from({ length: 6_500 }).fill(0.15);
    overallPeaks.fill(0.8, 6_385);
    lowPeaks.fill(0.65, 6_385);
    const markers = estimatedPhraseBarMarkers(measured(129), 65, null, {
      overallPeaks,
      lowPeaks,
    });

    expect(markers[1]).toEqual({ seconds: 32.09, level: 1 });
    expect(markers[2].level).toBe(2);
    expect(markers[2].seconds).toBeCloseTo(63.85, 1);
  });

  it('does not move phrase guides for an isolated kick accent or missing low band', () => {
    const overallPeaks = Array.from({ length: 6_500 }).fill(0.3);
    const lowPeaks = Array.from({ length: 6_500 }).fill(0.15);
    overallPeaks.fill(0.9, 6_385, 6_390);
    lowPeaks.fill(0.8, 6_385, 6_390);
    expect(
      estimatedPhraseBarMarkers(measured(129), 65, null, {
        overallPeaks,
        lowPeaks,
      })[2],
    ).toEqual({ seconds: 64.09, level: 2 });
    expect(
      estimatedPhraseBarMarkers(measured(129), 65, null, { overallPeaks })[2],
    ).toEqual({ seconds: 64.09, level: 2 });
  });
});

describe('beatGridSeconds', () => {
  it('keeps a line per beat once there is room for one', () => {
    expect(beatGridSeconds(128, 60, 8)).toBeCloseTo(BEAT);
  });

  it('widens to bars, then phrases, rather than drawing a Moiré comb', () => {
    // 2.8px a beat, 11px a bar.
    expect(beatGridSeconds(128, 6, 8)).toBeCloseTo(BEAT * 4);
    // 1.4px a beat, 5.6px a bar, 22px a phrase — a whole track, unzoomed.
    expect(beatGridSeconds(128, 3, 8)).toBeCloseTo(BEAT * 16);
  });

  it('gives up when even a phrase would not be legible', () => {
    expect(beatGridSeconds(128, 0.5, 8)).toBe(0);
  });

  it('always returns a whole number of beats, to stay on the grid', () => {
    for (const pixelsPerSecond of [0.5, 1, 3, 6, 20, 60, 400]) {
      const beats = beatGridSeconds(128, pixelsPerSecond, 8) / BEAT;
      expect(beats).toBeCloseTo(Math.round(beats));
    }
  });

  it('draws nothing without a tempo', () => {
    expect(beatGridSeconds(undefined, 60, 8)).toBe(0);
    expect(beatGridSeconds(0, 60, 8)).toBe(0);
  });
});

describe('beatGridPhase / firstGridLineAt', () => {
  it('reproduces the old track-start anchor when there is no detected offset', () => {
    expect(beatGridPhase(0, BEAT)).toBeCloseTo(0);
    expect(firstGridLineAt(0, BEAT, 10)).toBeCloseTo(
      Math.ceil(10 / BEAT) * BEAT,
    );
  });

  it('anchors the grid to the first detected beat instead of 0:00', () => {
    // A 2s intro before the beat locks in — every grid line must land at
    // 2 + k*BEAT, not at a multiple of BEAT from track start.
    const offset = 2.137;
    const phase = beatGridPhase(offset, BEAT);
    for (let k = 0; k < 20; k++) {
      const line = firstGridLineAt(phase, BEAT, offset + (k - 5) * BEAT - 1e-6);
      const beatsFromOffset = (line - offset) / BEAT;
      expect(beatsFromOffset).toBeCloseTo(Math.round(beatsFromOffset));
    }
  });

  it('still finds the phase when the offset is larger than the line spacing', () => {
    // beatOffsetSeconds is a raw seconds value; lineSeconds may have widened
    // to a bar or phrase (4x/16x BEAT) at low zoom, so the offset routinely
    // exceeds it many times over.
    const barSeconds = BEAT * 4;
    const offset = 47.3; // ~101 beats in
    const phase = beatGridPhase(offset, barSeconds);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(barSeconds);
    expect((offset - phase) / barSeconds).toBeCloseTo(
      Math.round((offset - phase) / barSeconds),
    );
  });

  it('returns the first line at or after the requested time, never before', () => {
    const offset = 0.75;
    const phase = beatGridPhase(offset, BEAT);
    for (const from of [0, 0.1, 0.75, 0.76, 5, 100.2]) {
      const line = firstGridLineAt(phase, BEAT, from);
      expect(line).toBeGreaterThanOrEqual(from - 1e-9);
      expect(line).toBeLessThan(from + BEAT);
    }
  });
});

describe('expectedBeats', () => {
  it('matches the direct-calculation formula, not accumulation', () => {
    // BPM=128, beatOffset=2.137 -> 2.137, 2.606, 3.075, 3.544, 4.012, ...
    const offset = 2.137;
    // Start just before `offset` itself so the range covers indices 0..4
    // exactly, without also picking up earlier ghost beats the formula
    // legitimately extrapolates backward from the offset (negative indices).
    const ghosts = expectedBeats(
      offset,
      BEAT,
      offset - 1e-6,
      offset + 4.5 * BEAT,
    );
    expect(ghosts).toHaveLength(5);
    for (const [index, time] of ghosts.entries()) {
      expect(time).toBeCloseTo(offset + index * BEAT, 9);
    }

    // The spec's own values are rounded to 3dp for readability (e.g. 3.0745
    // shown as "3.075"), so compare at 2dp rather than treating the rounding
    // itself as a mismatch.
    const literalSpecValues = [2.137, 2.606, 3.075, 3.544, 4.012];
    for (const [index, expected] of literalSpecValues.entries()) {
      expect(ghosts[index]).toBeCloseTo(expected, 2);
    }
  });

  it('never drifts across many beats, because each position is computed independently', () => {
    // An accumulation bug (running += BEAT) compounds float error over
    // thousands of additions; direct calculation from the index cannot.
    const offset = 2.137;
    const ghosts = expectedBeats(offset, BEAT, 0, offset + 20_000 * BEAT);
    const last = ghosts.at(-1);
    const lastIndex = Math.round((last - offset) / BEAT);
    expect(last).toBeCloseTo(offset + lastIndex * BEAT, 9);
  });

  it('draws nothing before the requested viewport start', () => {
    const ghosts = expectedBeats(2.137, BEAT, 10, 12);
    expect(ghosts.every((t) => t >= 10)).toBe(true);
  });

  it('draws nothing at or past the requested viewport end', () => {
    const ghosts = expectedBeats(2.137, BEAT, 10, 12);
    expect(ghosts.every((t) => t < 12)).toBe(true);
  });

  it('handles a beat offset greater than one beat interval', () => {
    // A late-locking intro: offset is many multiples of BEAT, not just one.
    const offset = 47.3; // ~101 beats in
    const ghosts = expectedBeats(offset, BEAT, 50, 52);
    expect(ghosts.length).toBeGreaterThan(0);
    for (const time of ghosts) {
      const beatsFromOffset = (time - offset) / BEAT;
      expect(beatsFromOffset).toBeCloseTo(Math.round(beatsFromOffset), 6);
    }
  });

  it('reproduces the track-start grid for a zero/unknown offset', () => {
    const ghosts = expectedBeats(0, BEAT, 10, 10 + 2 * BEAT);
    expect(ghosts[0]).toBeCloseTo(Math.ceil(10 / BEAT) * BEAT, 9);
  });

  it('handles zoom/scroll as a plain change of viewport bounds', () => {
    // "Zoom" and "scroll" are just a narrower/shifted [from, to) to this pure
    // function — the same grid must survive both without special-casing.
    const offset = 2.137;
    const wholeTrack = expectedBeats(offset, BEAT, 0, 200);
    const zoomedWindow = expectedBeats(offset, BEAT, 80, 90); // scrolled + zoomed in
    const fromWholeTrack = wholeTrack
      .filter((t) => t >= 80)
      .filter((t) => t < 90);
    expect(zoomedWindow).toEqual(fromWholeTrack);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(expectedBeats(2.137, BEAT, 10, 10)).toEqual([]);
    expect(expectedBeats(2.137, BEAT, 10, 5)).toEqual([]);
  });

  it('returns nothing without a usable bpm', () => {
    expect(expectedBeats(2.137, 0, 0, 10)).toEqual([]);
  });
});

describe('visibleBeats', () => {
  const beats = Float32Array.from([1, 2.5, 4, 6.5, 9, 12]);

  it('keeps only detected beats inside [from, to)', () => {
    expect(Array.from(visibleBeats(beats, 2, 9))).toEqual([2.5, 4, 6.5]);
  });

  it('never mutates the source array', () => {
    const before = Array.from(beats);
    visibleBeats(beats, 2, 9);
    expect(Array.from(beats)).toEqual(before);
  });

  it('handles missing/empty detection gracefully', () => {
    expect(visibleBeats(null, 0, 10)).toEqual([]);
    expect(visibleBeats(undefined, 0, 10)).toEqual([]);
    expect(visibleBeats([], 0, 10)).toEqual([]);
  });
});

describe('compareBeats', () => {
  const bpm = 128;
  const beat = 60 / bpm;
  const offset = 2.137;
  const onGrid = (count) =>
    Array.from({ length: count }, (_, index) => offset + index * beat);

  it('keeps detected and expected as separate values per beat, never overwriting either', () => {
    const beats = onGrid(10);
    const { comparisons } = compareBeats(beats, bpm, offset);
    for (const [index, c] of comparisons.entries()) {
      expect(c.detected).toBeCloseTo(beats[index], 9);
      expect(c.expected).toBeCloseTo(offset + index * beat, 9);
    }
  });

  it('never mutates the detected beats array', () => {
    const beats = onGrid(10);
    const before = [...beats];
    compareBeats(beats, bpm, offset);
    expect(beats).toEqual(before);
  });

  it('reports ~zero error when the detector stays on the theoretical grid', () => {
    const {
      maxAbsErrorSeconds,
      meanAbsErrorSeconds,
      skippedBeats,
      extraBeats,
    } = compareBeats(onGrid(30), bpm, offset);
    expect(meanAbsErrorSeconds).toBeCloseTo(0, 6);
    expect(maxAbsErrorSeconds).toBeCloseTo(0, 6);
    expect(skippedBeats).toBe(0);
    expect(extraBeats).toBe(0);
  });

  it('flags a skipped beat as an index gap without cascading into later beats', () => {
    const beats = onGrid(20).filter((_, index) => index !== 5);
    const { count, skippedBeats, extraBeats, maxAbsErrorSeconds } =
      compareBeats(beats, bpm, offset);
    expect(count).toBe(19);
    expect(skippedBeats).toBe(1);
    expect(extraBeats).toBe(0);
    expect(maxAbsErrorSeconds).toBeCloseTo(0, 6);
  });

  it('flags an inserted extra beat as a non-positive index gap', () => {
    const beats = onGrid(20);
    beats.splice(5, 0, offset + 4.5 * beat);
    const { count, skippedBeats, extraBeats } = compareBeats(
      beats,
      bpm,
      offset,
    );
    expect(count).toBe(21);
    expect(skippedBeats).toBe(0);
    expect(extraBeats).toBe(1);
  });

  it('handles no beats or no bpm without throwing', () => {
    expect(compareBeats([], bpm, offset).count).toBe(0);
    expect(compareBeats(null, bpm, offset).count).toBe(0);
    expect(compareBeats(onGrid(5), 0, offset).count).toBe(0);
  });
});

// One loud sample in an otherwise silent span. Max-hold reports the transient
// (1), RMS reports how much energy is actually there (sqrt(1/8)) — which of those
// is right depends entirely on how much audio the slot covers.
const spike = (length, at = 0) =>
  Float32Array.from({ length }, (_, index) => (index === at ? 1 : 0));

// Loud for the first half of the span, silent for the second.
const frontHalfLoud = (length) =>
  Float32Array.from({ length }, (_, index) => (index < length / 2 ? 1 : 0));

describe('resamplePeaks', () => {
  it('keeps the transient while a slot covers only a few peaks', () => {
    expect(Array.from(resamplePeaks(spike(3), 3))).toEqual([1, 0, 0]);
  });

  it('switches to energy once a slot covers a real span of audio', () => {
    // 8 peaks into 1 slot: max-hold would say 1 and paint a full-height bar for
    // a single transient, which is what flattens a whole track into a slab.
    expect(resamplePeaks(spike(8), 1)[0]).toBeCloseTo(Math.sqrt(1 / 8));
  });

  it('samples the tail, even when the slots do not divide evenly', () => {
    // An integer stride would drop the last peak here; the final slot has to
    // reach the end of the data or the picture drifts against playback.
    expect(resamplePeaks(spike(10, 9), 3)[2]).toBeGreaterThan(0);
  });

  it('reads only the requested slice', () => {
    const data = frontHalfLoud(8);
    expect(resamplePeaks(data, 1, 0, 0.5)[0]).toBeCloseTo(1);
    expect(resamplePeaks(data, 1, 0.5, 1)[0]).toBeCloseTo(0);
  });

  it('never invents a peak that is not in the data', () => {
    // Asking for more slots than there are peaks upsamples, which is what the
    // seek bar clamps against — it must at least not manufacture amplitude.
    const out = resamplePeaks(spike(4), 16);
    expect(Math.max(...out)).toBeCloseTo(1);
    expect(out.filter((v) => v > 0).length).toBeLessThanOrEqual(4);
  });
});

describe('waveColours', () => {
  it('falls back to the dark palette when a theme defines no tokens', () => {
    const element = document.createElement('div');
    document.body.append(element);
    expect(waveColours(element)).toEqual({
      blend: 'lighter',
      grid: 'rgba(255,232,214,0.13)',
      high: '#ffe2b0',
      low: '#e0417a',
      mid: '#ffa629',
    });
    element.remove();
  });
});

describe('cached waveform beat cadence', () => {
  it('derives tempo from actual ticks without a BPM tag', () => {
    expect.hasAssertions();
    expect(
      waveformBeatBpm(
        Array.from({ length: 40 }, (_, i) => 0.2 + (i * 60) / 128),
      ),
    ).toBeCloseTo(128, 8);
    expect(waveformBeatBpm([0.2, 0.7])).toBeCloseTo(120, 10);
  });
  it('does not invent cadence for absent or invalid ticks', () => {
    expect.hasAssertions();
    for (const beats of [null, [], [0.2], [0.2, 0.2], [1, 0], [0, Number.NaN]])
      expect(waveformBeatBpm(beats)).toBeNull();
  });
});

describe('detected grid timing', () => {
  it('preserves changing beat intervals and bar alignment in scrolling windows', () => {
    const beats = Array.from(
      { length: 80 },
      (_, i) => 0.2 + i * 0.43 + i * i * 0.000_2,
    );
    const bars = beats.filter((_, i) => i % 4 === 0);
    for (const start of [0, 8.123, 17.83, 25.18]) {
      const end = start + 8;
      const visible = visibleBeatTimes(beats, start, end);
      const visibleBars = visibleBeatTimes(beats, start, end, 4);
      expect(visibleBars).toEqual(
        bars.filter((t) => t >= start).filter((t) => t < end),
      );
      for (const time of visibleBars) expect(visible).toContain(time);
    }
  });

  it('samples only observed timestamps at screen spacing without assigning a bar phase', () => {
    const beats = [0.1, 0.4, 0.9, 1.1, 1.5, 3.9, 4.2];
    expect(visibleSampledBeatTimes(beats, 0, 5, 10, 10)).toEqual([
      0.4, 1.5, 3.9,
    ]);
    expect(visibleSampledBeatTimes(beats, 1, 4, 10, 10)).toEqual([1.5, 3.9]);
    expect(visibleSampledBeatTimes(beats, 0, 5, 0, 10)).toEqual([]);
    expect(visibleSampledBeatTimes([], 0, 5, 10, 10)).toEqual([]);
    expect(beats).toEqual([0.1, 0.4, 0.9, 1.1, 1.5, 3.9, 4.2]);
  });
});
