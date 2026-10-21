import { placeMixChannels } from './mixAudioTimeline';

const tone = (size, value) => [
  new Float32Array(size).fill(value),
  new Float32Array(size).fill(value),
];

describe('transition audio placement', () => {
  it.each([44_100, 48_000])(
    'keeps B silent before its entry and A silent after its exit at %i Hz',
    (sampleRate) => {
      expect.hasAssertions();
      const bpm = 138;
      const frames = (bar) => Math.round((bar * 240 * sampleRate) / bpm);
      const a = { timelineStartBar: 0, timelineEndBar: 20, previewBars: 24 };
      const b = { timelineStartBar: 4, timelineEndBar: 24, previewBars: 24 };
      const left = placeMixChannels(tone(frames(20), 0.5), sampleRate, a, bpm);
      const right = placeMixChannels(
        tone(frames(24) - frames(4), 0.25),
        sampleRate,
        b,
        bpm,
      );
      expect(left[0]).toHaveLength(frames(24));
      expect(right[0]).toHaveLength(left[0].length);
      expect(
        right[0].subarray(0, frames(4)).every((sample) => sample === 0),
      ).toBe(true);
      expect(left[0].subarray(frames(20)).every((sample) => sample === 0)).toBe(
        true,
      );
      expect(left[0][frames(4)]).toBe(0.5);
      expect(right[0][frames(4)]).toBe(0.25);
      expect(left[0][frames(20) - 1]).toBe(0.5);
      expect(right[0][frames(24) - 1]).toBe(0.25);
      expect(left[1].every((sample, i) => sample === left[0][i])).toBe(true);
      expect(right[1].every((sample, i) => sample === right[0][i])).toBe(true);
    },
  );
  it('rejects incomplete or incorrectly sized stems', () => {
    expect.hasAssertions();
    expect(() =>
      placeMixChannels(
        [new Float32Array(10)],
        44_100,
        { timelineStartBar: 4, timelineEndBar: 20, previewBars: 24 },
        138,
      ),
    ).toThrow('transition timeline');
  });
});
