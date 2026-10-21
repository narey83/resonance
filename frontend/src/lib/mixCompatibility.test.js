import library from './__fixtures__/mixLibrary.json';
import {
  auditionQueue,
  compareKeys,
  compareTempo,
  mergeRegions,
  mixCompatibility,
  mixDuration,
  mixWindows,
  overlapFraction,
  windowRegions,
} from './mixCompatibility';

const data = (path, overrides = {}) => ({
  track: {
    path,
    bpm: 120,
    key: 'Am',
    lufs: -10,
    duration: 244,
    genre: 'House',
  },
  waveform: { analysisDuration: 240, downbeatConfidence: 0.8 },
  enhanced: {
    available: true,
    durationSeconds: 240,
    beats: Array.from({ length: 481 }, (_, i) => i * 0.5),
    downbeats: Array.from({ length: 121 }, (_, i) => i * 2),
    singing: [],
    processedVoice: [],
    djPhrases: [
      { start_seconds: 0, end_seconds: 32, label: 'Intro' },
      { start_seconds: 32, end_seconds: 208, label: 'Groove' },
      { start_seconds: 208, end_seconds: 240, label: 'Outro' },
    ],
  },
  ...overrides,
});
const irregularBeats = Array.from(
  { length: 481 },
  (_, i) => Math.floor(i / 2) + (i % 2 ? 0.3 : 0),
);

describe('mix compatibility evidence', () => {
  it('calculates incoming tempo adjustment in the correct direction', () => {
    expect.hasAssertions();
    expect(compareTempo(128, 130).adjustment).toBeCloseTo(-1.538_46, 4);
    expect(compareTempo(130, 128).adjustment).toBeCloseTo(1.562_5, 4);
    expect(compareTempo(0, 130).known).toBe(false);
    expect(compareTempo(128, null).known).toBe(false);
    expect(compareTempo(Number.NaN, 128).known).toBe(false);
  });
  it('offers half-time as an explicit alternative without changing the BPM', () => {
    expect.hasAssertions();
    const tempo = compareTempo(70, 140);
    expect(tempo.adjustment).toBe(-50);
    expect(tempo.to).toBe(140);
    expect(tempo.alternative).toEqual({ factor: 0.5, bpm: 70, adjustment: 0 });
  });
  it('recognises enharmonic keys, wheel wrap and relative modes', () => {
    expect.hasAssertions();
    expect(compareKeys('A♭m', 'G#m').kind).toBe('same');
    expect(compareKeys('12A', '1a').kind).toBe('neighbour');
    expect(compareKeys('Am', 'C').kind).toBe('relative');
    expect(compareKeys('Am', 'F#').kind).toBe('contrast');
    expect(compareKeys('unknown', 'Am').known).toBe(false);
  });
  it('keeps PCM duration authoritative and rejects non-finite fallbacks', () => {
    expect.hasAssertions();
    expect(mixDuration(data('a'))).toBe(240);
    expect(
      mixDuration({
        track: { duration: 244 },
        enhanced: { durationSeconds: Number.POSITIVE_INFINITY },
      }),
    ).toBe(244);
    expect(mixDuration({})).toBe(0);
  });
  it('unions overlapping voice predictions and clips invalid spans', () => {
    expect.hasAssertions();
    const regions = mergeRegions(
      [
        { startSeconds: -2, endSeconds: 5 },
        { start_seconds: 3, end_seconds: 9 },
        { startSeconds: 9, endSeconds: 11 },
        { startSeconds: 20, endSeconds: 19 },
        { startSeconds: Number.NaN, endSeconds: 40 },
      ],
      10,
    );
    expect(regions).toEqual([{ start: 0, end: 10 }]);
    expect(
      overlapFraction([{ start: 0, end: 0.5 }], [{ start: 0.25, end: 0.75 }]),
    ).toBe(0.25);
  });
  it('compares vocal locations after mapping each source window to the shared overlap', () => {
    expect.hasAssertions();
    const a = data('a');
    a.enhanced.singing = [{ startSeconds: 100, endSeconds: 110 }];
    a.enhanced.processedVoice = [{ startSeconds: 105, endSeconds: 110 }];
    const b = data('b');
    b.enhanced.singing = [{ startSeconds: 10, endSeconds: 15 }];
    expect(windowRegions(a, { start: 100, end: 120 })).toEqual([
      { start: 0, end: 0.5 },
    ]);
    expect(
      overlapFraction(
        windowRegions(a, { start: 100, end: 120 }),
        windowRegions(b, { start: 10, end: 20 }),
      ),
    ).toBe(0.5);
  });
  it('suggests real detected bar windows and suitable opening/closing sections', () => {
    expect.hasAssertions();
    const result = mixCompatibility(data('a'), data('b'), 16);
    expect(result.plan.exit).toEqual(
      expect.objectContaining({
        start: 208,
        end: 240,
        bars: 16,
        aligned: true,
      }),
    );
    expect(result.plan.entry).toEqual(
      expect.objectContaining({ start: 0, end: 32, bars: 16, aligned: true }),
    );
    expect(result.plan.overlapSeconds).toBe(0);
    expect(result.signals).toBe(6);
    expect(result.label).toBe('Promising blend');
  });
  it('flags sustained predicted vocal overlap instead of calling it a clean blend', () => {
    expect.hasAssertions();
    const a = data('a');
    const b = data('b');
    a.enhanced.singing = [{ startSeconds: 0, endSeconds: 240 }];
    b.enhanced.processedVoice = [{ startSeconds: 0, endSeconds: 240 }];
    const result = mixCompatibility(a, b);
    expect(result.label).toBe('Watch the vocal overlap');
    expect(result.plan.overlapSeconds).toBeCloseTo(32);
  });
  it('keeps the ending and opening even when predicted voices or phrases favour the middle', () => {
    expect.hasAssertions();
    const a = data('a');
    const b = data('b');
    a.enhanced.singing = [{ startSeconds: 208, endSeconds: 240 }];
    b.enhanced.singing = [{ startSeconds: 0, endSeconds: 32 }];
    a.enhanced.djPhrases = [
      { start_seconds: 150, end_seconds: 185, label: 'Outro' },
    ];
    b.enhanced.djPhrases = [
      { start_seconds: 50, end_seconds: 85, label: 'Intro' },
    ];
    const result = mixCompatibility(a, b, 16);
    expect(result.plan.exit.end).toBe(240);
    expect(result.plan.entry.start).toBe(0);
    expect(result.label).toBe('Watch the vocal overlap');
  });
  it('keeps unknown voice and bar timing distinct from a negative detection', () => {
    expect.hasAssertions();
    const basic = data('b', { enhanced: { available: false }, waveform: null });
    const result = mixCompatibility(data('a'), basic);
    expect(result.voiceKnown).toBe(false);
    expect(result.plan.fraction).toBeNull();
    expect(result.plan.entry.aligned).toBe(false);
    expect(result.plan.entry.bars).toBeNull();
    expect(result.label).toBe('Tempo / key starting point');
    expect(mixWindows({ track: { path: 'none' } }, 'entry')).toEqual([]);
  });
  it('flags irregular beat spacing and saved-tempo disagreements', () => {
    expect.hasAssertions();
    const a = data('a');
    a.enhanced.beats = irregularBeats;
    const result = mixCompatibility(a, data('b'));
    expect(result.plan.timingA.variable).toBe(true);
    expect(result.label).toBe('Check the timing');
  });
  it('does not suggest mixing a track into itself', () => {
    expect.hasAssertions();
    const result = mixCompatibility(data('same'), data('same'));
    expect(result.sameTrack).toBe(true);
    expect(result.plan).toBeNull();
  });
  it('does not apply confidence from a different beatgrid to the suggested bars', () => {
    expect.hasAssertions();
    const a = data('a');
    a.waveform.downbeatConfidence = 0.01;
    expect(mixCompatibility(a, data('b')).plan.phaseUncertain).toBe(false);
    a.enhanced.downbeatConfidence = 0.01;
    expect(mixCompatibility(a, data('b')).plan.phaseUncertain).toBe(true);
  });
  it('preserves queue order and metadata when auditioning or revisiting a target', () => {
    expect.hasAssertions();
    const queue = [
      { path: 'first', filename: 'first' },
      { path: 'second', filename: 'second' },
    ];
    const result = auditionQueue(queue, {
      path: 'third',
      bpm: 138,
      key: 'Gm',
      duration: 403,
    });
    expect(result.tracks.map((row) => row.path)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(result.index).toBe(2);
    expect(queue).toHaveLength(2);
    const again = auditionQueue(result.tracks, {
      path: 'third',
      bpm: 139,
      key: 'Gm',
      duration: 403,
    });
    expect(again.tracks).toHaveLength(3);
    expect(again.tracks[2]).toEqual(
      expect.objectContaining({
        bpm: 139,
        key: 'Gm',
        length: 403,
        localRelativePath: 'third',
      }),
    );
  });
});

describe('15-track captured analysis matrix', () => {
  it('keeps all 630 directional pair/length suggestions within their authoritative source timelines', () => {
    expect.hasAssertions();
    expect(library).toHaveLength(15);
    let checked = 0;
    for (const a of library)
      for (const b of library.filter(
        (row) => row.track.path !== a.track.path,
      )) {
        for (const bars of [8, 16, 32]) {
          const result = mixCompatibility(a, b, bars);
          expect(result.plan).not.toBeNull();
          expect(result.plan.entry.start).toBe(b.enhanced.downbeats[0]);
          expect(result.plan.exit.end).toBe(a.enhanced.downbeats.at(-1));
          for (const [track, window] of [
            [a, result.plan.exit],
            [b, result.plan.entry],
          ]) {
            expect(window.start).toBeGreaterThanOrEqual(0);
            expect(window.end).toBeGreaterThan(window.start);
            expect(window.end).toBeLessThanOrEqual(mixDuration(track));
            expect(window.aligned).toBe(true);
            const start = track.enhanced.downbeats.indexOf(window.start);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(track.enhanced.downbeats[start + bars]).toBe(window.end);
          }

          expect(result.plan.fraction).toBeGreaterThanOrEqual(0);
          expect(result.plan.fraction).toBeLessThanOrEqual(1);
          expect(result.plan.overlapSeconds).toBeLessThanOrEqual(
            result.plan.duration,
          );
          expect(result.tempo.adjustment).toBeCloseTo(
            (a.track.bpm / b.track.bpm - 1) * 100,
          );
          checked++;
        }
      }

    expect(checked).toBe(630);
  });
});
