// <copyright file="WaveformPreview.test.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import * as analysisApi from '../../lib/analysis';
import { drawWaveform } from '../../lib/waveform';
import WaveformPreview, { primeWaveformCache } from './WaveformPreview';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../../lib/analysis', () => ({ getWaveform: jest.fn() }));
jest.mock('../../lib/musicLibrary', () => ({
  ALL_METRICS: 'Bpm, Key, Waveform, Loudness',
  analyzeTrack: jest.fn(),
}));

// Only the drawing is stubbed — jsdom canvases have no 2d context. toPeaks is
// the real one, since converting the API's arrays is part of what
// primeWaveformCache does.
jest.mock('../../lib/waveform', () => ({
  ...jest.requireActual('../../lib/waveform'),
  drawWaveform: jest.fn(),
}));

const waveformResponse = {
  highPeaks: [0.1, 0.2],
  lowPeaks: [0.5, 0.6],
  midPeaks: [0.3, 0.4],
  overallPeaks: [0.5, 0.6],
};

describe('WaveformPreview', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    jest.clearAllMocks();
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  // Each test needs its own path: the peaks cache is module-level and lives for
  // the session, which is the point of it.
  const render = (path, hasWaveform) =>
    act(() => {
      ReactDOM.render(
        <WaveformPreview
          hasWaveform={hasWaveform}
          path={path}
        />,
        container,
      );
    });

  it('draws peaks that arrive after the row mounted', () => {
    const path = '/downloads/HATE/late-analysis.mp3';

    render(path, false);

    expect(container.querySelector('.jb-wave-analyse')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();

    // What playing the track does: the player analyses the file on its way to
    // drawing its own seek bar, then hands the peaks over.
    act(() => primeWaveformCache(path, waveformResponse));

    expect(container.querySelector('.jb-wave-analyse')).toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('redraws cached peaks on theme changes without requesting audio again', async () => {
    expect.hasAssertions();
    const path = '/downloads/HATE/theme-redraw.mp3';
    render(path, false);
    act(() => primeWaveformCache(path, waveformResponse));
    drawWaveform.mockClear();
    await act(async () => {
      document.documentElement.classList.add('violet');
      await Promise.resolve();
    });
    expect(drawWaveform).toHaveBeenCalledWith(
      container.querySelector('canvas'),
      expect.any(Object),
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );
    expect(analysisApi.getWaveform).not.toHaveBeenCalled();
    await act(async () => {
      document.documentElement.classList.remove('violet');
      await Promise.resolve();
    });
  });

  it('does not ask the server when the list said there are no peaks', () => {
    render('/downloads/HATE/never-analysed.mp3', false);

    expect(analysisApi.getWaveform).not.toHaveBeenCalled();
  });

  it('ignores an empty response rather than caching a blank waveform', () => {
    const path = '/downloads/HATE/empty-response.mp3';

    render(path, false);
    act(() => primeWaveformCache(path, { overallPeaks: [] }));

    expect(container.querySelector('.jb-wave-analyse')).not.toBeNull();
  });

  it("reports the fraction clicked, not a seek time — that conversion is the caller's job", () => {
    const path = '/downloads/HATE/click-to-seek.mp3';
    const onSeek = jest.fn();

    act(() => {
      ReactDOM.render(
        <WaveformPreview
          hasWaveform={false}
          onSeek={onSeek}
          path={path}
          width={100}
        />,
        container,
      );
    });
    act(() => primeWaveformCache(path, waveformResponse));

    const preview = container.querySelector('.jb-wave-preview');
    preview.getBoundingClientRect = () => ({ left: 0, width: 100 });
    act(() => {
      preview.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 25 }),
      );
    });

    expect(onSeek).toHaveBeenCalledWith(0.25);
  });

  it('does not attach a click handler when no onSeek is given', () => {
    const path = '/downloads/HATE/no-seek.mp3';

    render(path, false);
    act(() => primeWaveformCache(path, waveformResponse));

    const preview = container.querySelector('.jb-wave-preview');
    preview.getBoundingClientRect = () => ({ left: 0, width: 100 });
    // A click without a handler must be a no-op, not a throw.
    act(() => {
      preview.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 25 }),
      );
    });
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});
