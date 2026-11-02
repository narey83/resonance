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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    jest.clearAllMocks();
    mockLibraryRevision = 0;
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
    jest.restoreAllMocks();
  });

  const render = async (track, props = {}) => {
    await act(async () => {
      ReactDOM.render(
        <WaveformSeekBar
          {...props}
          duration={180}
          onReady={jest.fn()}
          onSeek={jest.fn()}
          progressPct={0}
          track={{ length: 180, ...track }}
        />,
        container,
      );
    });
  };

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
    mockLibraryRevision += 1;
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
    mockLibraryRevision += 1;
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
    mockLibraryRevision += 1;
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
