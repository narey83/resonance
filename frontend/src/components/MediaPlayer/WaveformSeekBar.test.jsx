// <copyright file="WaveformSeekBar.test.jsx" company="John Narey">
// SPDX-License-Identifier: AGPL-3.0-only

import * as analysisApi from '../../lib/analysis';
import * as waveformPreview from '../Shared/WaveformPreview';
import WaveformSeekBar from './WaveformSeekBar';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

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

  const render = async (track) => {
    await act(async () => {
      ReactDOM.render(
        <WaveformSeekBar
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

  it('starts analysis when another analysis metric is missing', async () => {
    expect.hasAssertions();
    analysisApi.getWaveform.mockResolvedValueOnce(response);
    waveformPreview.analyseTrack.mockResolvedValue({
      error: null,
      peaks: {},
    });

    await render({
      bpm: 128,
      hasWaveform: true,
      key: null,
      lufs: -12.4,
      path: '/music/not-analysed.flac',
    });

    expect(waveformPreview.analyseTrack).toHaveBeenCalledTimes(1);
    expect(waveformPreview.analyseTrack).toHaveBeenCalledWith(
      '/music/not-analysed.flac',
    );
    expect(analysisApi.getWaveform).toHaveBeenCalledTimes(1);
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});
