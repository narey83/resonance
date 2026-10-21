/* Matrix cases deliberately check both supported and unsupported pairs. */
/* eslint-disable jest/no-conditional-in-test, jest/no-conditional-expect */
import library from './__fixtures__/mixLibrary.json';
import { mixCompatibility } from './mixCompatibility';
import {
  crossfadeGains,
  SharedMixTransport,
  sourcePosition,
  syncPlan,
  transitionPosition,
} from './mixSync';

const context = () => ({
  currentTime: 10,
  destination: {},
  resume: jest.fn(async () => {}),
  createGain: () => ({
    gain: {
      value: 1,
      setTargetAtTime: jest.fn(),
      cancelScheduledValues: jest.fn(),
      setValueAtTime: jest.fn(),
      setValueCurveAtTime: jest.fn(),
      linearRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
  createBufferSource: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
});
const buffers = [
  { length: 441_000, sampleRate: 44_100, duration: 10 },
  { length: 441_000, sampleRate: 44_100, duration: 10 },
];

const transition = { handoverStart: 2, handoverEnd: 8 };

describe('shared-clock transition transport', () => {
  it('reports a natural ending once and never advances for stopped or sought sources', async () => {
    expect.hasAssertions();
    const ctx = context();
    const ended = jest.fn();
    const engine = new SharedMixTransport(ctx, buffers, transition, ended);
    await engine.play();
    await engine.play();
    const first = engine.sources.map((source) => source.onended);
    // The native ended event is authoritative even if the exposed context
    // clock is still one render quantum behind the scheduled buffer end.
    ctx.currentTime = 10.035;
    first[0]();
    first[1]();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(engine.snapshot().elapsed).toBe(10);
    await engine.play();
    const stopped = engine.sources[0].onended;
    engine.pause();
    ctx.currentTime = 40;
    stopped();
    expect(ended).toHaveBeenCalledTimes(1);
    await engine.seek(10);
    expect(ended).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
  it('starts both stems at exactly the same context time and sample offset', async () => {
    expect.hasAssertions();
    const ctx = context();
    const engine = new SharedMixTransport(ctx, buffers, transition);
    await engine.play();
    expect(engine.sources).toHaveLength(2);
    expect(engine.sources[0].start).toHaveBeenCalledWith(10.04, 0);
    expect(engine.sources[1].start.mock.calls).toEqual(
      engine.sources[0].start.mock.calls,
    );
    ctx.currentTime = 12.04;
    expect(engine.snapshot().elapsed).toBeCloseTo(2);
    engine.pause();
    ctx.currentTime = 20;
    expect(engine.snapshot().elapsed).toBeCloseTo(2);
    await engine.play();
    expect(engine.sources[0].start.mock.calls[0][1]).toBeCloseTo(2);
    expect(engine.sources[1].start.mock.calls).toEqual(
      engine.sources[0].start.mock.calls,
    );
  });
  it('seeks and restarts both decks together without separate timers', async () => {
    expect.hasAssertions();
    const ctx = context();
    const engine = new SharedMixTransport(ctx, buffers, transition);
    await engine.play();
    await engine.seek(6);
    expect(engine.sources[0].start).toHaveBeenLastCalledWith(10.04, 6);
    expect(engine.sources[1].start.mock.calls).toEqual(
      engine.sources[0].start.mock.calls,
    );
    engine.stop();
    expect(engine.snapshot()).toEqual({
      elapsed: 0,
      playing: false,
      duration: 10,
      crossfade: 0,
      automatic: true,
    });
    engine.dispose();
    expect(engine.buffers).toEqual([]);
  });
  it('does not start after a pause while context resume is pending', async () => {
    expect.hasAssertions();
    const ctx = context();
    let resume;
    ctx.resume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const engine = new SharedMixTransport(ctx, buffers, transition);
    const pending = engine.play();
    engine.pause();
    resume();
    await pending;
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
  });
  it('ends both stems at the same duration and refuses different timelines', async () => {
    expect.hasAssertions();
    const ctx = context();
    const engine = new SharedMixTransport(ctx, buffers, transition);
    await engine.play();
    // The mock audio clock is advanced deliberately after playback starts.
    // eslint-disable-next-line require-atomic-updates
    ctx.currentTime = 25;
    expect(engine.snapshot()).toEqual({
      elapsed: 10,
      playing: false,
      duration: 10,
      crossfade: 1,
      automatic: true,
    });
    expect(
      () =>
        new SharedMixTransport(
          ctx,
          [buffers[0], { ...buffers[1], length: 2 }],
          transition,
        ),
    ).toThrow('exact sample timeline');
  });
  it('keeps crossfader endpoints silent on the opposite deck and retains headroom at centre', () => {
    expect.hasAssertions();
    expect(crossfadeGains(0)[1]).toBe(0);
    expect(crossfadeGains(1)[0]).toBeLessThan(1e-10);
    expect(crossfadeGains(0.5)[0]).toBeCloseTo(0.5);
    expect(crossfadeGains(0.5)[1]).toBeCloseTo(0.5);
    for (let i = 0; i <= 100; i++)
      expect(
        crossfadeGains(i / 100).reduce((a, b) => a + b, 0),
      ).toBeLessThanOrEqual(1.000_000_01);
  });
  it('holds A alone, schedules a fade on the audio clock, then holds B alone', async () => {
    expect.hasAssertions();
    const ctx = context();
    const engine = new SharedMixTransport(ctx, buffers, transition);
    await engine.play();
    const [curveA, startA, lengthA] =
      engine.gains[0].gain.setValueCurveAtTime.mock.calls.at(-1);
    const [curveB, startB, lengthB] =
      engine.gains[1].gain.setValueCurveAtTime.mock.calls.at(-1);
    expect(startA).toBeCloseTo(12.04);
    expect(startB).toBe(startA);
    expect(lengthA).toBe(6);
    expect(lengthB).toBe(lengthA);
    expect(curveA[0]).toBeCloseTo(1 / Math.SQRT2);
    expect(curveB[0]).toBe(0);
    expect(curveA.at(-1)).toBe(0);
    expect(curveB.at(-1)).toBeCloseTo(1 / Math.SQRT2);
    ctx.currentTime = 11.04;
    expect(engine.snapshot().crossfade).toBe(0);
    ctx.currentTime = 15.04;
    expect(engine.snapshot().crossfade).toBeCloseTo(0.5);
    ctx.currentTime = 19.04;
    expect(engine.snapshot().crossfade).toBe(1);
  });
  it('rebuilds automation at the correct point when seeking, pausing and restarting', async () => {
    expect.hasAssertions();
    const ctx = context();
    const engine = new SharedMixTransport(ctx, buffers, transition);
    await engine.play();
    await engine.seek(5);
    const [curve, when, duration] =
      engine.gains[1].gain.setValueCurveAtTime.mock.calls.at(-1);
    expect(curve[0]).toBeCloseTo(0.5);
    expect(when).toBeCloseTo(10.04);
    expect(duration).toBe(3);
    engine.pause();
    expect(engine.snapshot().crossfade).toBeCloseTo(0.5);
    await engine.seek(9);
    expect(engine.snapshot().crossfade).toBe(1);
    expect(engine.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);
    engine.stop();
    expect(engine.snapshot().crossfade).toBe(0);
    expect(engine.gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);
  });
  it('finishes when seeking to the end instead of looping back to A', async () => {
    expect.hasAssertions();
    const ctx = context();
    const engine = new SharedMixTransport(ctx, buffers, {
      ...transition,
      duration: 10,
    });
    await engine.play();
    await engine.seek(10);
    expect(engine.snapshot()).toEqual({
      playing: false,
      elapsed: 10,
      duration: 10,
      crossfade: 1,
      automatic: true,
    });
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(2);
  });
  it('allows an explicit manual fade and resumes the automatic handover from the shared timeline', async () => {
    expect.hasAssertions();
    const ctx = context();
    const engine = new SharedMixTransport(ctx, buffers, transition);
    await engine.play();
    ctx.currentTime = 15.04;
    engine.setAutomatic(false);
    expect(engine.snapshot().automatic).toBe(false);
    expect(engine.snapshot().crossfade).toBeCloseTo(0.5);
    engine.setCrossfade(0.2);
    ctx.currentTime = 16.04;
    expect(engine.snapshot().crossfade).toBe(0.2);
    engine.setAutomatic(true);
    expect(engine.snapshot().automatic).toBe(true);
    const [curve, when, duration] =
      engine.gains[1].gain.setValueCurveAtTime.mock.calls.at(-1);
    expect(when).toBeCloseTo(16.06);
    expect(duration).toBeCloseTo(1.98);
    expect(curve[0]).toBeCloseTo(crossfadeGains(4.02 / 6)[1]);
    expect(
      engine.gains[1].gain.linearRampToValueAtTime.mock.calls.at(-1)[0],
    ).toBeCloseTo(curve[0]);
    expect(engine.gains[1].gain.cancelScheduledValues).toHaveBeenLastCalledWith(
      0,
    );
  });
});

const shortTrack = (path) => ({
  track: { path, bpm: 120, duration: 18 },
  enhanced: { downbeats: Array.from({ length: 10 }, (_, i) => i * 2) },
});

describe('15-track synced bar plans', () => {
  it('locks every accepted pair/bar boundary to the same master timeline and refuses large changes', () => {
    expect.hasAssertions();
    let accepted = 0;
    let cases = 0;
    for (const a of library)
      for (const b of library) {
        if (a.track.path === b.track.path) continue;
        for (const bars of [8, 16, 32]) {
          cases++;
          const comparison = mixCompatibility(a, b, bars);
          const plan = syncPlan(a, b, comparison.plan, a.track.bpm);
          if (!plan.available) {
            expect(plan.reason).toBeTruthy();
            continue;
          }

          accepted++;
          expect(sourcePosition(plan.decks[1], 0, plan)).toBe(
            comparison.plan.entry.start,
          );
          expect(sourcePosition(plan.decks[0], plan.duration, plan)).toBe(
            comparison.plan.exit.end,
          );
          expect(plan.handoverEnd - plan.handoverStart).toBeCloseTo(
            (bars * 240) / a.track.bpm,
          );
          expect(plan.duration).toBeCloseTo(
            ((plan.leadBars + bars + plan.tailBars) * 240) / a.track.bpm,
          );
          expect(transitionPosition(plan.handoverStart, plan)).toBe(0);
          expect(transitionPosition(plan.handoverEnd, plan)).toBe(1);
          for (const deck of plan.decks)
            for (let i = 0; i < deck.knots.length; i++) {
              expect(
                sourcePosition(
                  deck,
                  deck.timelineStart + (i * 240) / plan.bpm,
                  plan,
                ),
              ).toBeCloseTo(deck.knots[i], 7);
              expect(
                deck.rates.every((rate) => Math.abs(rate - 1) <= 0.080_001),
              ).toBe(true);
            }
        }
      }

    expect(cases).toBe(630);
    expect(accepted).toBeGreaterThan(100);
  });
  it('refuses missing grids, self mixes and out-of-range local bar timing', () => {
    expect.hasAssertions();
    const a = library[0];
    const b = library[1];
    const comparison = mixCompatibility(a, b, 16);
    expect(syncPlan(a, a, comparison.plan, a.track.bpm).available).toBe(false);
    expect(
      syncPlan(
        a,
        b,
        {
          ...comparison.plan,
          entry: { ...comparison.plan.entry, aligned: false },
        },
        a.track.bpm,
      ).available,
    ).toBe(false);
    expect(syncPlan(a, b, comparison.plan, 400).available).toBe(false);
  });
  it('uses only available supported context bars at either edge', () => {
    expect.hasAssertions();
    const windows = {
      exit: { start: 0, end: 16, bars: 8, aligned: true },
      entry: { start: 2, end: 18, bars: 8, aligned: true },
    };
    const plan = syncPlan(shortTrack('a'), shortTrack('b'), windows, 120);
    expect(plan.available).toBe(true);
    expect(plan.leadBars).toBe(0);
    expect(plan.tailBars).toBe(0);
    expect(plan.duration).toBe(16);
    expect(sourcePosition(plan.decks[1], -10, plan)).toBe(2);
    expect(sourcePosition(plan.decks[0], 30, plan)).toBe(16);
  });
});
