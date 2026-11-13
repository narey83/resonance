// Each display size and zoom asserts real canvas output.
/* eslint-disable jest/no-conditional-in-test, jest/no-conditional-expect, no-loop-func */
import fixtures from '../../lib/__fixtures__/beatgrid-15.json';
import { getWaveform } from '../../lib/analysis';
import api from '../../lib/api';
import { beatGridSeconds, waveformBeatBpm } from '../../lib/waveform';
import WaveformSeekBar from './WaveformSeekBar';
import { WAVEFORM_ZOOMS } from './WaveformToolbar';
import fs from 'node:fs';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({ get: jest.fn() }));
jest.mock('../../lib/analysis', () => ({ getWaveform: jest.fn() }));
jest.mock('../Shared/WaveformPreview', () => ({
  analyseTrack: jest.fn(),
  primeWaveformCache: jest.fn(),
}));

const report = [];
const sizes = [
  { width: 420, height: 40, dpr: 1.25 },
  { width: 420, height: 60, dpr: 1 },
  { width: 987, height: 120, dpr: 1.25 },
  { width: 987, height: 240, dpr: 2 },
  { width: 1_595, height: 180, dpr: 2 },
];

describe('docked beatgrid shipping matrix', () => {
  // Give each display size its own timeout and cleanup boundary while retaining
  // every track, zoom, playback position and seek assertion in the matrix.
  it.each(
    fixtures.flatMap((fixture) =>
      sizes.map((size) => ({ title: fixture.track.title, fixture, size })),
    ),
  )(
    '$title at $size.width x $size.height / DPR $size.dpr keeps beat/bar positions locked',
    async ({ fixture, size, title }) => {
      expect.hasAssertions();
      expect(fixture.track.title).toBe(title);
      const win = window;
      const container = document.createElement('div');
      document.body.append(container);
      let frame;
      const raf = jest
        .spyOn(win, 'requestAnimationFrame')
        .mockImplementation((cb) => {
          frame = cb;
          return 1;
        });
      const cancel = jest
        .spyOn(win, 'cancelAnimationFrame')
        .mockImplementation(() => {});
      window.ResizeObserver = class {
        observe() {}

        disconnect() {}
      };
      const data = fixture.enhanced;
      const duration = fixture.waveform.analysisDuration;
      getWaveform.mockResolvedValue({
        ...fixture.waveform,
        overallPeaks: Array.from(
          { length: fixture.waveform.peakCount },
          () => 0.5,
        ),
      });
      api.get.mockResolvedValue({ data });
      let clock = 0;
      const seek = jest.fn();
      const ctx = Object.fromEntries(
        [
          'beginPath',
          'clearRect',
          'clip',
          'fillRect',
          'fillText',
          'lineTo',
          'moveTo',
          'rect',
          'restore',
          'save',
          'setTransform',
          'stroke',
          'translate',
        ].map((k) => [k, jest.fn()]),
      );
      const render = async (zoom) => {
        await act(async () => {
          ReactDOM.render(
            <WaveformSeekBar
              duration={duration}
              getCurrentTime={() => clock}
              onReady={() => {}}
              onSeek={seek}
              phraseMode="off"
              progressPct={0}
              showVocals={false}
              track={fixture.track}
              zoom={zoom}
            />,
            container,
          );
        });
        const canvas = container.querySelector('canvas');
        canvas.getContext = () => ctx;
        Object.defineProperty(canvas, 'clientWidth', {
          configurable: true,
          get: () => size.width,
        });
        Object.defineProperty(canvas, 'clientHeight', {
          configurable: true,
          get: () => size.height,
        });
        return canvas;
      };

      try {
        Object.defineProperty(win, 'devicePixelRatio', {
          configurable: true,
          value: size.dpr,
        });
        for (const zoom of WAVEFORM_ZOOMS) {
          const canvas = await render(zoom);
          const positions = [
            0,
            duration * 0.1,
            duration * 0.5,
            duration * 0.9,
            duration - 0.001,
          ];
          // Consecutive video frames plus forward and backward seeks.
          positions.push(
            ...Array.from({ length: 12 }, (_, i) => duration * 0.4 + i / 60),
            duration * 0.2,
          );
          let frames = 0;
          for (clock of positions) {
            for (const mock of Object.values(ctx)) mock?.mockClear?.();
            act(() => frame());
            const offset = ctx.translate.mock.calls[0][0];
            const grid = ctx.moveTo.mock.calls
              .slice(0, -1)
              .map((call) => call[0]);
            const caps = ctx.fillRect.mock.calls.filter(
              (call) =>
                call[2] === 8 * Math.max(1, Math.round(size.dpr)) &&
                call[3] === 5 * Math.max(1, Math.round(size.dpr)),
            );
            const pixelWidth = Math.round(size.width * size.dpr);
            const dprScale = Math.max(1, Math.round(size.dpr));
            const barWidth = Math.max(
              dprScale,
              Math.ceil(
                pixelWidth /
                  Math.max(1, Math.floor(fixture.waveform.peakCount / zoom)) /
                  dprScale,
              ) * dprScale,
            );
            const slots = Math.max(1, Math.floor(pixelWidth / barWidth));
            const span = duration / zoom;
            const start = Math.max(
              0,
              Math.min(duration - span, clock - span / 2),
            );
            const scale = (slots * barWidth) / span;
            const step = beatGridSeconds(
              waveformBeatBpm(data.beats),
              scale,
              8 * Math.max(1, Math.round(size.dpr)),
            );
            // At detailed zoom every bar marker must sit on an actual rendered beat.
            if (
              step &&
              Math.round(step / (60 / waveformBeatBpm(data.beats))) === 1
            ) {
              for (const cap of caps) {
                const x = cap[0] + 3 * Math.max(1, Math.round(size.dpr));
                expect(
                  Math.min(...grid.map((g) => Math.abs(g - x))),
                ).toBeLessThan(0.000_001);
              }
            }

            // Sparse overview lines must count from the downbeat, not an arbitrary first beat.
            const stride = Math.round(
              step / (60 / waveformBeatBpm(data.beats)),
            );
            const reference = stride >= 4 ? data.downbeats : data.beats;
            // All beat lines must resolve to saved timestamps, never an average-BPM sequence.
            for (const x of grid) {
              const time = start + (x + offset) / scale;
              expect(
                Math.min(...reference.map((t) => Math.abs(t - time))),
              ).toBeLessThan(0.000_001);
            }

            expect(canvas.width).toBe(pixelWidth);
            frames++;
          }

          // Seek clicks use the same visible timeline as the grid.
          const seekStart = Math.max(
            0,
            Math.min(duration - duration / zoom, clock - duration / zoom / 2),
          );
          canvas.getBoundingClientRect = () => ({
            left: 0,
            width: size.width,
          });
          Object.defineProperty(canvas, 'setPointerCapture', {
            configurable: true,
            value: jest.fn(),
          });
          act(() =>
            Simulate.pointerDown(canvas, {
              clientX: size.width / 2,
              pointerId: 1,
            }),
          );
          expect(seek.mock.calls.at(-1)[0]).toBeCloseTo(
            seekStart + duration / zoom / 2,
            9,
          );
          report.push({
            track: fixture.track.title,
            mode: 'docked',
            zoom,
            ...size,
            frames,
            gridAligned: true,
          });
        }
      } finally {
        act(() => {
          ReactDOM.unmountComponentAtNode(container);
        });
        container.remove();
        raf.mockRestore();
        cancel.mockRestore();
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          value: 1,
        });
      }
    },
  );
});
// eslint-disable-next-line jest/require-top-level-describe
afterAll(() => {
  // Optional artifact destination supplied by the local/CI runner.
  // eslint-disable-next-line n/no-process-env
  if (process.env.BEATGRID_REPORT)
    fs.writeFileSync(
      // eslint-disable-next-line n/no-process-env
      process.env.BEATGRID_REPORT,
      JSON.stringify(
        {
          cases: report.length,
          frames: report.reduce((n, r) => n + r.frames, 0),
          results: report,
        },
        null,
        2,
      ),
    );
});
