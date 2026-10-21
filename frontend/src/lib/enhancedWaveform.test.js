import timelines from './__fixtures__/djTimelines.json';
import {
  djTimeline,
  drawEnhanced,
  visibleEvents,
  visibleSpans,
} from './enhancedWaveform';

describe('enhanced waveform timeline', () => {
  it('clips spanning vocal regions to the zoom window', () => {
    expect(
      visibleSpans([{ startSeconds: 5, endSeconds: 15 }], 10, 20, 100),
    ).toEqual([{ startSeconds: 5, endSeconds: 15, x: 0, width: 50 }]);
  });
  it('uses phrase timestamps and discards invalid/offscreen regions', () => {
    expect(
      visibleSpans(
        [
          { start_seconds: 12, end_seconds: 14 },
          { start_seconds: 20, end_seconds: 21 },
          { start_seconds: 15, end_seconds: 14 },
        ],
        10,
        20,
        100,
        true,
      ),
    ).toEqual([{ start_seconds: 12, end_seconds: 14, x: 20, width: 20 }]);
  });
  it('unavailable analysis paints no overlays', () => {
    const ctx = { save: jest.fn() };
    drawEnhanced(ctx, { available: false }, {});
    expect(ctx.save).not.toHaveBeenCalled();
  });
  it('singing and processed voice occupy separate lanes', () => {
    const ctx = { save: jest.fn(), restore: jest.fn(), fillRect: jest.fn() };
    drawEnhanced(
      ctx,
      {
        available: true,
        singing: [{ startSeconds: 0, endSeconds: 2 }],
        processedVoice: [{ startSeconds: 2, endSeconds: 4 }],
      },
      {
        start: 0,
        end: 10,
        width: 100,
        height: 40,
        phrases: 'off',
        vocals: true,
      },
    );
    expect(ctx.fillRect.mock.calls).toEqual([
      [0, 32, 20, 3],
      [20, 36, 20, 3],
    ]);
  });

  it('separates a legacy entrance event from the sustained section without changing saved evidence', () => {
    const section = Object.freeze({
      start_seconds: 30,
      end_seconds: 120,
      label: 'Drop entrance',
      featureEvidence: { drumLevel: 1.3, bassLevel: 0.8 },
    });
    const data = Object.freeze({ djPhrases: Object.freeze([section]) });
    const result = djTimeline(data);
    expect(result.sections[0]).toMatchObject({
      start_seconds: 30,
      end_seconds: 120,
      label: 'High-energy groove',
    });
    expect(result.events).toEqual([
      {
        type: 'drop_entrance',
        seconds: 30,
        source: 'legacy-activity-evidence',
      },
    ]);
    expect(section.label).toBe('Drop entrance');
    expect(djTimeline(data)).toBe(result);
  });

  it('accepts canonical events and avoids generating a duplicate legacy marker', () => {
    const event = { type: 'drop_entrance', seconds: 30 };
    expect(
      djTimeline({
        djPhrases: [
          { start_seconds: 30, end_seconds: 120, label: 'Drop entrance' },
        ],
        djEvents: [event],
      }).events,
    ).toEqual([event]);
    expect(
      djTimeline({ djHierarchy: { sections: [], events: [event] } }).events,
    ).toEqual([event]);
  });

  it('maps point events with the same absolute-time zoom window and rejects missing clocks', () => {
    expect(
      visibleEvents(
        [
          { seconds: 12 },
          { seconds: 20 },
          { seconds: null },
          { seconds: Number.NaN },
        ],
        10,
        20,
        100,
      ),
    ).toEqual([{ seconds: 12, x: 20 }]);
    expect(visibleEvents([{ seconds: 12 }], 10, 10, 100)).toEqual([]);
    expect(visibleEvents([{ seconds: 12 }], 10, 20, 0)).toEqual([]);
  });

  it.each(timelines)(
    'keeps $title section edges and entrance positions intact at every zoom',
    (track) => {
      const result = djTimeline(track);
      expect(
        result.sections.map((s) => [s.start_seconds, s.end_seconds]),
      ).toEqual(track.djPhrases.map((s) => [s.start_seconds, s.end_seconds]));
      expect(result.sections.some((s) => s.label === 'Drop entrance')).toBe(
        false,
      );
      expect(result.events.map((event) => event.seconds)).toEqual(
        track.expectedEventSeconds,
      );
      for (const seconds of track.expectedEventSeconds) {
        for (const zoom of [1, 2, 4, 8, 16, 32]) {
          const span = track.durationSeconds / zoom;
          const start = Math.max(
            0,
            Math.min(seconds - span / 2, track.durationSeconds - span),
          );
          for (const width of [320, 720, 1_440]) {
            const event = visibleEvents(
              result.events,
              start,
              start + span,
              width,
            ).find((item) => item.seconds === seconds);
            expect(event.x).toBeCloseTo(((seconds - start) / span) * width, 8);
          }
        }
      }
    },
  );

  it('uses theme text/surface colours and hides event markers with musical or hidden phrases', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      fillRect: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      measureText: () => ({ width: 24 }),
      fillText: jest.fn(),
    };
    const data = {
      available: true,
      djEvents: [{ type: 'drop_entrance', seconds: 5 }],
    };
    const options = {
      start: 0,
      end: 10,
      width: 100,
      height: 60,
      scale: 1,
      grid: false,
      phrases: 'dj',
      labelColour: '#ede8ff',
      labelBackground: '#181024',
    };
    drawEnhanced(ctx, data, options);
    expect(ctx.moveTo).toHaveBeenCalledWith(45, 15);
    expect(ctx.fillText).toHaveBeenCalledWith('Drop', 57, 25);
    expect(ctx.fillStyle).toBe('#ede8ff');
    expect(ctx.strokeStyle).toBe('#181024');
    ctx.moveTo.mockClear();
    for (const phrases of ['off', 'musical'])
      drawEnhanced(ctx, data, { ...options, phrases });
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });
});
