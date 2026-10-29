import { readPlaybackSync } from './playbackSync';

describe('playback output clock', () => {
  const audio = {
    currentTime: 10,
    playbackRate: 1,
    readyState: 4,
    paused: false,
    seeking: false,
  };
  const context = {
    state: 'running',
    currentTime: 20,
    getOutputTimestamp: () => ({ contextTime: 19.7, performanceTime: 1_000 }),
  };
  it('measures output delay and accounts for timestamp age', () => {
    expect.hasAssertions();
    const sample = readPlaybackSync(audio, context, 1_100);
    expect(sample.available).toBe(true);
    expect(sample.delay).toBeCloseTo(0.2);
    expect(sample.audibleTime).toBeCloseTo(9.8);
  });
  it('converts delay to media time at the audition playback rate', () => {
    expect.hasAssertions();
    expect(
      readPlaybackSync({ ...audio, playbackRate: 2 }, context, 1_100)
        .audibleTime,
    ).toBeCloseTo(9.6);
  });
  it.each([{ paused: true }, { seeking: true }, { readyState: 2 }])(
    'does not compensate inactive or discontinuous playback: %p',
    (state) => {
      expect.hasAssertions();
      expect(
        readPlaybackSync({ ...audio, ...state }, context, 1_100).available,
      ).toBe(false);
    },
  );
  it('rejects missing, stale or invalid output timestamps', () => {
    expect.hasAssertions();
    expect(readPlaybackSync(audio, null, 1_100).available).toBe(false);
    expect(readPlaybackSync(audio, context, 3_000).available).toBe(false);
    expect(
      readPlaybackSync(audio, { ...context, currentTime: 1 }, 1_100).available,
    ).toBe(false);
    expect(
      readPlaybackSync(
        audio,
        {
          ...context,
          getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
        },
        1_100,
      ).available,
    ).toBe(false);
  });
  it('clamps the display position at the beginning of a track', () => {
    expect.hasAssertions();
    expect(
      readPlaybackSync({ ...audio, currentTime: 0.01 }, context, 1_100)
        .audibleTime,
    ).toBe(0);
  });
});
