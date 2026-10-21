// Standalone Node ESM requires explicit extensions.
// eslint-disable-next-line import/extensions
import { placeMixChannels } from '../src/lib/mixAudioTimeline.js';
// eslint-disable-next-line import/extensions
import { stretchBars } from '../src/lib/mixStretch.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const library = JSON.parse(
  await fs.readFile(new URL('src/lib/__fixtures__/mixLibrary.json', root)),
);
const results = [];
const frequency = (samples, sr) => {
  let crossings = 0;
  for (let i = Math.round(sr * 0.2); i < Math.round(sr * 1.2); i++)
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings;
};

const clicks = (knots, sr, clipStart) => {
  const samples = new Float32Array(
    Math.ceil((knots.at(-1) - clipStart + 0.3) * sr),
  );
  for (let bar = 0; bar < knots.length - 1; bar++)
    for (let beat = 0; beat < 4; beat++) {
      const center = Math.round(
        (knots[bar] + (beat * (knots[bar + 1] - knots[bar])) / 4 - clipStart) *
          sr,
      );
      for (let d = -300; d <= 300; d++)
        if (center + d >= 0 && center + d < samples.length)
          samples[center + d] = 0.8 * Math.exp((-d * d) / (2 * 70 ** 2));
    }

  return samples;
};

const phaseErrors = (samples, sr, bpm, bars) => {
  const errors = [];
  for (let beat = 1; beat < bars * 4; beat++) {
    const expected = Math.round(((beat * 60) / bpm) * sr);
    let index = expected;
    let peak = -1;
    for (
      let i = Math.max(0, expected - Math.round(sr * 0.08));
      i < Math.min(samples.length, expected + Math.round(sr * 0.08));
      i++
    )
      if (samples[i] > peak) {
        peak = samples[i];
        index = i;
      }

    assert(peak > 0.3, 'Transient was lost');
    errors.push(((index - expected) / sr) * 1_000);
  }

  return errors;
};

for (const sr of [44_100, 48_000])
  for (const rate of [0.75, 0.92, 1, 1.08, 1.25]) {
    const knots = Array.from({ length: 5 }, (_, i) => 0.3 + i * 2);
    const bpm = 120 * rate;
    const tones = [440, 880].map((hz) =>
      Float32Array.from(
        { length: Math.ceil(sr * 8.6) },
        (_, i) => 0.2 * Math.sin((2 * Math.PI * hz * i) / sr),
      ),
    );
    const rendered = stretchBars({
      channels: tones,
      sampleRate: sr,
      knots,
      bpm,
      clipStart: 0,
    });
    assert.equal(rendered[0].length, Math.round((4 * 240 * sr) / bpm));
    assert.equal(rendered[0].length, rendered[1].length);
    const frequencies = rendered.map((samples) => frequency(samples, sr));
    assert(Math.abs(frequencies[0] - 440) <= 2);
    assert(Math.abs(frequencies[1] - 880) <= 2);
    const transients = stretchBars({
      channels: [clicks(knots, sr, 0)],
      sampleRate: sr,
      knots,
      bpm,
      clipStart: 0,
    });
    const errors = phaseErrors(transients[0], sr, bpm, 4);
    const maxMs = Math.max(...errors.map(Math.abs));
    assert(
      maxMs < 25,
      `Transient alignment exceeded 25 ms at rate ${rate}: ${maxMs}`,
    );
    if (rate === 1) {
      let maximumError = 0;
      for (let i = sr * 0.01; i < rendered[0].length - sr * 0.01; i++)
        maximumError = Math.max(
          maximumError,
          Math.abs(rendered[0][i] - tones[0][i + Math.round(0.3 * sr)]),
        );
      assert(maximumError < 1e-6, 'Unity tempo must bypass the stretch engine');
    }

    // Render B on a delayed absolute bar timeline, then pad the solo phases.
    const delayed = stretchBars({
      channels: [clicks(knots, sr, 0)],
      sampleRate: sr,
      knots,
      bpm,
      clipStart: 0,
      outputBarOffset: 4,
    });
    const placed = placeMixChannels(
      delayed,
      sr,
      { timelineStartBar: 4, timelineEndBar: 8, previewBars: 12 },
      bpm,
    );
    const entryFrame = Math.round((4 * 240 * sr) / bpm);
    const endFrame = Math.round((8 * 240 * sr) / bpm);
    assert.equal(delayed[0].length, endFrame - entryFrame);
    assert.equal(placed[0].length, Math.round((12 * 240 * sr) / bpm));
    assert(placed[0].subarray(0, entryFrame).every((sample) => sample === 0));
    assert(placed[0].subarray(endFrame).every((sample) => sample === 0));
    const delayedErrors = phaseErrors(
      placed[0].subarray(entryFrame, endFrame),
      sr,
      bpm,
      4,
    );
    const delayedMax = Math.max(...delayedErrors.map(Math.abs));
    assert(
      delayedMax < 25,
      'Delayed bar placement changed transient alignment',
    );
    results.push({
      sampleRate: sr,
      rate,
      delayedEntryBar: 4,
      maxTransientErrorMs: delayedMax,
      frames: placed[0].length,
    });
    results.push({
      sampleRate: sr,
      rate,
      pitchHz: frequencies,
      maxTransientErrorMs: maxMs,
      frames: rendered[0].length,
    });
  }

for (const row of library) {
  const sr = 44_100;
  const bpm = row.track.bpm;
  const first = row.enhanced.downbeats.findIndex(
    (_t, index, array) =>
      index + 16 < array.length &&
      array
        .slice(index + 1, index + 17)
        .every(
          (t, j) => Math.abs(((t - array[index + j]) * bpm) / 240 - 1) <= 0.08,
        ),
  );
  assert(
    first >= 0,
    `${row.track.title} needs at least one supported 16-bar window`,
  );
  const knots = row.enhanced.downbeats.slice(first, first + 17);
  const clipStart = Math.max(0, knots[0] - 0.3);
  const start = performance.now();
  const rendered = stretchBars({
    channels: [clicks(knots, sr, clipStart)],
    sampleRate: sr,
    knots,
    bpm,
    clipStart,
  });
  const errors = phaseErrors(rendered[0], sr, bpm, 16);
  const maxMs = Math.max(...errors.map(Math.abs));
  assert.equal(rendered[0].length, Math.round((16 * 240 * sr) / bpm));
  assert(maxMs < 25, `${row.track.title}: transient error ${maxMs} ms`);
  results.push({
    track: row.track.title,
    bpm,
    sourceStart: knots[0],
    frames: rendered[0].length,
    maxTransientErrorMs: maxMs,
    renderMs: performance.now() - start,
  });
}

// CI may choose a destination for the optional machine-readable report.
// eslint-disable-next-line n/no-process-env
const reportPath = process.env.MIX_DSP_REPORT;
if (reportPath)
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        passed: true,
        syntheticRateCases: 10,
        delayedEntryCases: 10,
        savedTrackGridCases: 15,
        scope:
          'Synthetic tones and transients through the actual pitch-preserving renderer; not a subjective listening score or proof that saved beat analysis is correct.',
        results,
      },
      null,
      2,
    ),
  );
console.log(
  `Passed ${results.length} DSP cases: exact output lengths, preserved pitch, transient error below 25 ms, unity bypass.`,
);
