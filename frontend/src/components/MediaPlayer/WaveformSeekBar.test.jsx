// <copyright file="WaveformSeekBar.test.jsx" company="John Narey">
// SPDX-License-Identifier: AGPL-3.0-only

import * as analysisApi from '../../lib/analysis';
import api from '../../lib/api';
import * as waveformPreview from '../Shared/WaveformPreview';
import WaveformSeekBar from './WaveformSeekBar';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

let mockLibraryRevision = 0;
jest.mock('../../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => ({ libraryRevision: mockLibraryRevision }),
}));

jest.mock('../../lib/api', () => ({ get: jest.fn() }));
jest.mock('../../lib/analysis', () => ({ getWaveform: jest.fn() }));
jest.mock('../Shared/WaveformPreview', () => ({
  analyseTrack: jest.fn(),
  primeWaveformCache: jest.fn(),
}));

const response = {
  analysisDuration: 180,
  beatOffsetSeconds: 0.2,
  beats: [0.2, 0.7],
  overallPeaks: [0.1, 0.5, 0.3],
};

describe('WaveformSeekBar waveform loading', () => {
  let container;
  let mockNow;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    jest.clearAllMocks();
    mockLibraryRevision = 0;
    mockNow = 100_000;
    jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
    api.get.mockResolvedValue({ data: { available: false } });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    window.ResizeObserver = class {
      observe() {}

      disconnect() {}
    };
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const bumpRevision = (elapsedMs = 15_000) => {
    mockNow += elapsedMs;
    mockLibraryRevision += 1;
  };

  const render = async (track, props = {}) => {
    await act(async () => {
      ReactDOM.render(
        <WaveformSeekBar
          {...props}
          duration={180}
          onReady={props.onReady || jest.fn()}
          onSeek={jest.fn()}
          progressPct={0}
          track={{ length: 180, ...track }}
        />,
        container,
      );
    });
  };

  const observeBasicMarkers = () => {
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    return () => {
      const canvas = container.querySelector('canvas');
      Object.defineProperty(canvas, 'clientWidth', {
        configurable: true,
        value: 800,
      });
      Object.defineProperty(canvas, 'clientHeight', {
        configurable: true,
        value: 40,
      });
      context.fillRect.mockClear();
      act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
      return context.fillRect.mock.calls
        .filter(
          ([, y, width, height]) => y === 0 && width === 3 && height === 26,
        )
        .map(([x]) => x);
    };
  };

  it('refreshes Basic markers after analysis updates and retains them while a refresh is pending or fails', async () => {
    expect.hasAssertions();
    const paintedMarkers = observeBasicMarkers();
    const first = {
      ...response,
      basicBarMarkers: [{ seconds: 0.7, level: 2 }],
    };
    const corrected = {
      ...response,
      basicBarMarkers: [{ seconds: 0.2, level: 2 }],
    };
    const onReady = jest.fn();
    const track = { path: '/music/basic.flac' };
    analysisApi.getWaveform.mockResolvedValueOnce(first);
    await render(track, { onReady });
    const originalMarkers = paintedMarkers();
    expect(originalMarkers).toHaveLength(1);
    onReady.mockClear();

    let fail;
    analysisApi.getWaveform.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        fail = reject;
      }),
    );
    bumpRevision();
    await render(track, { onReady });
    expect(paintedMarkers()).toEqual(originalMarkers);
    expect(onReady).not.toHaveBeenCalledWith(false);

    await act(async () => fail(new Error('Temporary waveform failure')));
    expect(paintedMarkers()).toEqual(originalMarkers);
    expect(waveformPreview.analyseTrack).not.toHaveBeenCalled();

    analysisApi.getWaveform.mockResolvedValueOnce(corrected);
    bumpRevision();
    await render(track, { onReady });
    expect(paintedMarkers()).not.toEqual(originalMarkers);
    expect(paintedMarkers()).toHaveLength(1);
    expect(waveformPreview.primeWaveformCache).toHaveBeenLastCalledWith(
      track.path,
      corrected,
    );
    expect(onReady).not.toHaveBeenCalledWith(false);
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(3);
  });

  it('updates the same-track seek scale when the refreshed analysis duration changes', async () => {
    expect.hasAssertions();
    const track = { path: '/music/duration.flac' };
    analysisApi.getWaveform.mockResolvedValueOnce(response);
    await render(track);
    expect(
      container.querySelector('canvas').getAttribute('aria-valuemax'),
    ).toBe('180');

    analysisApi.getWaveform.mockResolvedValueOnce({
      ...response,
      analysisDuration: 181.5,
    });
    bumpRevision();
    await render(track);
    expect(
      container.querySelector('canvas').getAttribute('aria-valuemax'),
    ).toBe('181.5');
  });

  it('clears the analysing indicator after a same-track refresh supersedes its request', async () => {
    expect.hasAssertions();
    const onAnalysing = jest.fn();
    const track = { path: '/music/beat-pending.flac' };
    const peaksWithoutBeats = {
      ...response,
      beatOffsetSeconds: null,
      beats: null,
    };
    let finish;
    waveformPreview.analyseTrack.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    analysisApi.getWaveform.mockResolvedValue(peaksWithoutBeats);
    await render(track, { onAnalysing });
    expect(onAnalysing).toHaveBeenLastCalledWith(true);
    bumpRevision();
    await render(track, { onAnalysing });
    expect(onAnalysing).toHaveBeenLastCalledWith(true);
    expect(waveformPreview.analyseTrack).toHaveBeenCalledTimes(1);

    await act(async () => finish({ error: null, peaks: {} }));
    expect(onAnalysing).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('reuses pending analysis across same-track library updates without losing its result', async () => {
    expect.hasAssertions();
    const onAnalysing = jest.fn();
    const track = { path: '/music/pending.flac' };
    let finish;
    waveformPreview.analyseTrack.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    analysisApi.getWaveform
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(response);
    await render(track, { onAnalysing });
    expect(onAnalysing).toHaveBeenLastCalledWith(true);

    bumpRevision();
    await render(track, { onAnalysing });
    expect(waveformPreview.analyseTrack).toHaveBeenCalledTimes(1);
    expect(container.querySelector('canvas')).toBeNull();

    await act(async () => finish({ error: null, peaks: {} }));
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(onAnalysing).toHaveBeenLastCalledWith(false);
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(3);
  });

  it('bounds repeated global revision fetches and still reads the final update', async () => {
    expect.hasAssertions();
    const track = { path: '/music/scan.flac' };
    analysisApi.getWaveform.mockResolvedValue(response);
    await render(track);
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(1);

    jest.useFakeTimers({
      doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
    bumpRevision(1_000);
    await render(track);
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(2);
    bumpRevision(1_000);
    await render(track);
    bumpRevision(1_000);
    await render(track);
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(2);

    await act(async () => {
      mockNow += 15_000;
      jest.advanceTimersByTime(15_000);
    });
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });

  it('clears analysis status on unmount and ignores a late completion', async () => {
    expect.hasAssertions();
    let finish;
    waveformPreview.analyseTrack.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    analysisApi.getWaveform.mockResolvedValueOnce(null);
    const onAnalysing = jest.fn();
    await render({ path: '/music/unmounted.flac' }, { onAnalysing });
    expect(onAnalysing).toHaveBeenLastCalledWith(true);

    await act(async () => ReactDOM.unmountComponentAtNode(container));
    expect(onAnalysing).toHaveBeenLastCalledWith(false);
    onAnalysing.mockClear();
    await act(async () => finish({ error: null, peaks: {} }));
    expect(onAnalysing).not.toHaveBeenCalled();
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(1);
  });

  it('ignores superseded Basic refreshes and clears the old grid when the track changes', async () => {
    expect.hasAssertions();
    const paintedMarkers = observeBasicMarkers();
    const track = { path: '/music/first.flac' };
    const first = {
      ...response,
      basicBarMarkers: [{ seconds: 0.7, level: 2 }],
    };
    const corrected = {
      ...response,
      basicBarMarkers: [{ seconds: 0.2, level: 2 }],
    };
    analysisApi.getWaveform.mockResolvedValueOnce(first);
    await render(track);

    let finishOld;
    analysisApi.getWaveform.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    bumpRevision();
    await render(track);
    analysisApi.getWaveform.mockResolvedValueOnce(corrected);
    bumpRevision();
    await render(track);
    const correctedMarkers = paintedMarkers();
    await act(async () => finishOld(first));
    expect(paintedMarkers()).toEqual(correctedMarkers);
    expect(waveformPreview.primeWaveformCache).toHaveBeenLastCalledWith(
      track.path,
      corrected,
    );

    let finishPreviousTrack;
    analysisApi.getWaveform.mockReturnValueOnce(
      new Promise((resolve) => {
        finishPreviousTrack = resolve;
      }),
    );
    bumpRevision();
    await render(track);
    analysisApi.getWaveform.mockReturnValueOnce(new Promise(() => {}));
    await render({ path: '/music/second.flac' });
    expect(container.querySelector('canvas')).toBeNull();
    waveformPreview.primeWaveformCache.mockClear();
    await act(async () => finishPreviousTrack(first));
    expect(container.querySelector('canvas')).toBeNull();
    expect(waveformPreview.primeWaveformCache).not.toHaveBeenCalled();
  });

  it('shows the analysis status and vocal legend when current analysis is available', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: {
        available: true,
        djPhrases: [],
        musicalPhrases: [],
        singing: [],
        processedVoice: [],
      },
    });
    analysisApi.getWaveform.mockResolvedValue(response);
    await render({ path: '/music/enhanced.flac' });
    expect(container.querySelector('.mp-vocal-legend')).not.toBeNull();
    expect(container.textContent).toContain('Processed voice');
    expect(api.get).toHaveBeenCalledWith('/analysis/candidates/enhanced', {
      params: { path: '/music/enhanced.flac' },
    });
  });

  it('keeps drawing the enhanced grid during a same-track refresh and a failed refresh', async () => {
    expect.hasAssertions();
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    analysisApi.getWaveform.mockResolvedValue(response);
    api.get.mockResolvedValueOnce({
      data: { available: true, beats: [150, 150.5, 151] },
    });
    const track = { path: '/music/enhanced.flac' };
    const props = { getCurrentTime: () => 150, zoom: 16 };
    await render(track, props);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 40 });
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    const strokes = context.stroke.mock.calls.length;
    expect(strokes).toBeGreaterThan(0);

    let fail;
    api.get.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        fail = reject;
      }),
    );
    bumpRevision();
    await render(track, props);
    context.stroke.mockClear();
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.stroke).toHaveBeenCalledTimes(strokes);
    expect(container.querySelector('.mp-vocal-legend')).not.toBeNull();

    await act(async () => {
      fail(new Error('Temporary network failure'));
    });
    context.stroke.mockClear();
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.stroke).toHaveBeenCalledTimes(strokes);
    expect(container.querySelector('.mp-vocal-legend')).not.toBeNull();
  });

  it('draws backend Basic bar markers only while the grid is enabled', async () => {
    expect.hasAssertions();
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    const markerPaints = [];
    context.fillRect.mockImplementation((x, y, width, height) => {
      markerPaints.push({ x, y, width, height, colour: context.fillStyle });
    });
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    analysisApi.getWaveform.mockResolvedValue({
      ...response,
      basicBarMarkers: [
        { seconds: 0.2, level: 2 },
        { seconds: 30, level: 1 },
      ],
    });
    const track = { path: '/music/basic.flac' };
    await render(track, { showGrid: true });
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 40 });
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.fillRect.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.any(Number), 0, 3, 26]),
        expect.arrayContaining([expect.any(Number), 0, 2, 26]),
      ]),
    );
    expect(markerPaints).toEqual(
      expect.arrayContaining([
        {
          x: expect.any(Number),
          y: 0,
          width: 3,
          height: 26,
          colour: '#6948ad',
        },
        {
          x: expect.any(Number),
          y: 0,
          width: 2,
          height: 26,
          colour: '#a25b00',
        },
      ]),
    );

    await render(track, { showGrid: false });
    context.fillRect.mockClear();
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.fillRect.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.any(Number), 0, 3, 26]),
      ]),
    );
  });

  it('draws observed beats but no coarse bar phase when Basic markers are absent', async () => {
    expect.hasAssertions();
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    analysisApi.getWaveform.mockResolvedValue({
      ...response,
      basicBarMarkers: [],
      basicBarPhaseStatus: 'unresolved',
      barAnchorSeconds: 0.2,
      beats: [0.7, 1.2, 1.7],
      basicGridBeats: [0.2, 0.7, 1.2, 1.7],
    });
    const track = { bpm: 120, path: '/music/no-bar-phase.flac' };
    await render(track);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 40 });
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    // The sparse overview uses actual beat timestamps, without claiming one
    // of them starts a bar.
    expect(context.moveTo.mock.calls.length).toBeGreaterThan(1);
    expect(context.globalAlpha).toBe(0.32);

    await render(track, { zoom: 64 });
    context.moveTo.mockClear();
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    const beatXs = context.moveTo.mock.calls.slice(0, -1).map(([x]) => x);
    expect(beatXs).toHaveLength(4);
    expect(beatXs[0]).toBeCloseTo((0.2 / (180 / 64)) * 800, 3);
  });

  it('uses a supported Basic bar phase for coarse guides without inventing phrase accents', async () => {
    expect.hasAssertions();
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    const strokeAlphas = [];
    context.stroke.mockImplementation(() =>
      strokeAlphas.push(context.globalAlpha),
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    const basicGridBeats = Array.from(
      { length: 20 },
      (_, index) => 0.2 + index * 0.5,
    );
    const barOnly = {
      ...response,
      barAnchorSeconds: 0.2,
      basicBarPhaseStatus: 'supported',
      basicSixteenBarPhaseStatus: 'unresolved',
      basicThirtyTwoBarPhaseStatus: 'unresolved',
      basicBarMarkers: [],
      beats: basicGridBeats,
      basicGridBeats,
    };
    analysisApi.getWaveform.mockResolvedValueOnce(barOnly);
    const track = { bpm: 120, path: '/music/bar-only.flac' };
    await render(track);
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 40 });
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.moveTo.mock.calls.length).toBeGreaterThan(1);
    expect(strokeAlphas[0]).toBe(1);
    expect(context.fillRect.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.any(Number), 0, 3, 26]),
      ]),
    );

    analysisApi.getWaveform.mockResolvedValueOnce({
      ...barOnly,
      basicGridBeats: [
        ...basicGridBeats.slice(0, 6),
        ...basicGridBeats.slice(7),
      ],
      basicSkippedInternalBeats: 1,
      basicSixteenBarPhaseStatus: 'supported',
      basicBarMarkers: [{ seconds: 0.2, level: 1 }],
    });
    bumpRevision();
    await render(track);
    context.moveTo.mockClear();
    context.fillRect.mockClear();
    strokeAlphas.splice(0);
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.moveTo.mock.calls.length).toBeGreaterThan(1);
    expect(strokeAlphas[0]).toBe(0.32);
    expect(context.fillRect.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.any(Number), 0, 2, 26]),
      ]),
    );

    await render(track, { zoom: 64 });
    context.moveTo.mockClear();
    strokeAlphas.splice(0);
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.moveTo.mock.calls.length).toBeGreaterThan(1);
    expect(strokeAlphas[0]).toBe(1);
  });

  it('keeps sampled Basic beat guides visible at desktop and phone overview widths', async () => {
    expect.hasAssertions();
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    const strokeAlphas = [];
    context.stroke.mockImplementation(() =>
      strokeAlphas.push(context.globalAlpha),
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    const duration = 304.536;
    const basicGridBeats = Array.from(
      { length: 733 },
      (_, index) => 0.023_2 + (index * 60) / 145,
    );
    const onBasicGridState = jest.fn();
    analysisApi.getWaveform.mockResolvedValue({
      ...response,
      analysisDuration: duration,
      beatOffsetSeconds: basicGridBeats[0],
      beats: basicGridBeats,
      basicGridBeats,
      basicBarPhaseStatus: 'unresolved',
      basicBarMarkers: [],
      barAnchorSeconds: null,
      overallPeaks: Array.from({ length: 2_048 }, () => 0.5),
    });
    const track = { bpm: 145, path: '/music/vault-stories.flac' };
    await render(track, { onBasicGridState });
    expect(onBasicGridState).toHaveBeenLastCalledWith({
      path: track.path,
      beatCount: basicGridBeats.length,
      barPhaseStatus: 'unresolved',
    });
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientHeight', { value: 40 });
    for (const width of [800, 352]) {
      Object.defineProperty(canvas, 'clientWidth', {
        configurable: true,
        value: width,
      });
      context.moveTo.mockClear();
      strokeAlphas.splice(0);
      act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
      const guideXs = context.moveTo.mock.calls.slice(0, -1).map(([x]) => x);
      expect(guideXs.length).toBeGreaterThan(10);
      expect(strokeAlphas[0]).toBe(0.32);
      for (const x of guideXs)
        expect(
          basicGridBeats.some(
            (time) => Math.abs(time - (x / width) * duration) < 0.001,
          ),
        ).toBe(true);
    }

    await render(track, { zoom: 64, onBasicGridState });
    context.moveTo.mockClear();
    strokeAlphas.splice(0);
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.moveTo.mock.calls.length).toBeGreaterThan(1);
    expect(strokeAlphas[0]).toBe(1);

    await render(track, { zoom: 64, showGrid: false, onBasicGridState });
    context.moveTo.mockClear();
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    expect(context.moveTo).toHaveBeenCalledTimes(1);
  });

  it('clears the old track while loading a new one and ignores stale responses', async () => {
    expect.hasAssertions();
    analysisApi.getWaveform.mockResolvedValue(response);
    api.get.mockResolvedValueOnce({ data: { available: true } });
    await render({ path: '/music/first.flac' });
    let finishOld;
    api.get.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    bumpRevision();
    await render({ path: '/music/first.flac' });
    api.get.mockReturnValueOnce(new Promise(() => {}));
    await render({ path: '/music/second.flac' });
    expect(container.querySelector('.mp-vocal-legend')).toBeNull();
    await act(async () => {
      finishOld({ data: { available: true } });
    });
    expect(container.querySelector('.mp-vocal-legend')).toBeNull();
  });

  it('removes invalidated analysis when a successful refresh says it is unavailable', async () => {
    expect.hasAssertions();
    analysisApi.getWaveform.mockResolvedValue(response);
    api.get.mockResolvedValueOnce({ data: { available: true } });
    await render({ path: '/music/first.flac' });
    expect(container.querySelector('.mp-vocal-legend')).not.toBeNull();
    api.get.mockResolvedValueOnce({ data: { available: false } });
    bumpRevision();
    await render({ path: '/music/first.flac' });
    expect(container.querySelector('.mp-vocal-legend')).toBeNull();
  });

  it('uses an existing cached waveform without starting analysis', async () => {
    expect.hasAssertions();
    analysisApi.getWaveform.mockResolvedValue(response);

    await render({
      bpm: 128,
      hasWaveform: true,
      key: '8A',
      lufs: -12.4,
      path: '/music/already-analysed.flac',
    });

    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(1);
    expect(analysisApi.getWaveform).toHaveBeenCalledWith(
      '/music/already-analysed.flac',
      { cachedOnly: true },
    );
    expect(waveformPreview.analyseTrack).not.toHaveBeenCalled();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('shows cached peaks even when key and BPM are missing', async () => {
    expect.hasAssertions();
    analysisApi.getWaveform.mockResolvedValueOnce(response);
    waveformPreview.analyseTrack.mockResolvedValue({
      error: null,
      peaks: {},
    });

    await render({
      bpm: null,
      hasWaveform: true,
      key: null,
      lufs: -12.4,
      path: '/music/not-analysed.flac',
    });

    expect(waveformPreview.analyseTrack).not.toHaveBeenCalled();
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(1);
    expect(container.querySelector('canvas')).not.toBeNull();
  });
  it('analyses only when no cached waveform exists', async () => {
    expect.hasAssertions();
    analysisApi.getWaveform
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(response);
    waveformPreview.analyseTrack.mockResolvedValue({ error: null, peaks: {} });
    await render({ path: '/music/missing.flac' });
    expect(waveformPreview.analyseTrack).toHaveBeenCalledWith(
      '/music/missing.flac',
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });
  it('draws the real cached grid even when the player snapshot has no BPM', async () => {
    expect.hasAssertions();
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    analysisApi.getWaveform.mockResolvedValue(response);
    await render({
      bpm: null,
      hasWaveform: true,
      path: '/music/cached-beats.flac',
    });
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 40 });
    const callback = window.requestAnimationFrame.mock.calls.at(-1)[0];
    act(() => callback());
    expect(context.stroke).toHaveBeenCalledWith();
    expect(context.fillText).toHaveBeenCalledTimes(6);
    expect(waveformPreview.analyseTrack).not.toHaveBeenCalled();
  });
  it('reserves the timestamp lane instead of covering the lower waveform peaks', async () => {
    expect.hasAssertions();
    const context = Object.fromEntries(
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
      ].map((name) => [name, jest.fn()]),
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    analysisApi.getWaveform.mockResolvedValue(response);
    await render({ path: '/music/timestamp-lane.flac' });
    const canvas = container.querySelector('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(canvas, 'clientHeight', { value: 40 });
    act(() => window.requestAnimationFrame.mock.calls.at(-1)[0]());
    const fills = context.fillRect.mock.calls;
    expect(fills.at(-1)).toEqual([0, 26, 800, 14]);
    expect(
      Math.max(...fills.slice(0, -1).map(([, y, , height]) => y + height)),
    ).toBeLessThanOrEqual(26);
  });
  it('keeps cached peaks visible while missing beat data is analysed', async () => {
    expect.hasAssertions();
    let finish;
    waveformPreview.analyseTrack.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    analysisApi.getWaveform
      .mockResolvedValueOnce({
        ...response,
        beats: null,
        beatOffsetSeconds: null,
      })
      .mockResolvedValueOnce(response);
    await render({ hasWaveform: true, path: '/music/peaks-only.flac' });
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(waveformPreview.analyseTrack).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ error: null, peaks: {} });
    });
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(2);
    expect(waveformPreview.primeWaveformCache).toHaveBeenLastCalledWith(
      '/music/peaks-only.flac',
      response,
    );
  });
});
