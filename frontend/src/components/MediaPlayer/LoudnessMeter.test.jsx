// <copyright file="LoudnessMeter.test.jsx" company="John Narey">
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

import LoudnessMeter from './LoudnessMeter';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

// A constant 0.5 amplitude is a mean square of 0.25, so the meter should read
// -0.691 + 10 * log10(0.25) = -6.7 LUFS. A fixed sample value keeps the
// assertion an exact number rather than a range.
const SAMPLE_AMPLITUDE = 0.5;
const EXPECTED_LABEL = 'live -6.7 LUFS';

// Every plain node in the graph is only ever configured and connected, so
// one shape covers the source, filters and gains.
const stubParam = () => ({ setTargetAtTime: jest.fn(), value: 0 });

const stubNode = () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
  frequency: stubParam(),
  gain: { ...stubParam(), value: 1 },
  Q: stubParam(),
  type: '',
});

// jsdom has no Web Audio, so there is nothing to spy on — and it has to be a
// class rather than an arrow function because the graph module calls it with
// `new`. Covers everything mediaAudioGraph.js builds, including the DSP
// processing rack (see lib/dsp/) — getMediaAudioGraph() always builds the
// full chain, not just the analyser this component actually reads.
class AudioContextStub {
  createAnalyser = () => ({
    connect: jest.fn(),
    fftSize: 32,
    getFloatTimeDomainData: (buffer) => buffer.fill(SAMPLE_AMPLITUDE),
    smoothingTimeConstant: 0,
  });

  createBiquadFilter = stubNode;

  createChannelMerger = () => ({ connect: jest.fn(), disconnect: jest.fn() });

  createChannelSplitter = () => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  });

  createDynamicsCompressor = () => ({
    attack: stubParam(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    knee: stubParam(),
    ratio: stubParam(),
    release: stubParam(),
    threshold: stubParam(),
  });

  createGain = stubNode;

  createMediaElementSource = stubNode;

  createWaveShaper = () => ({
    connect: jest.fn(),
    curve: null,
    disconnect: jest.fn(),
    oversample: '',
  });

  currentTime = 0;

  destination = {};

  resume = () => Promise.resolve();

  state = 'running';
}

describe('LoudnessMeter', () => {
  let container;
  let frame;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    window.AudioContext = AudioContextStub;

    // Driven by hand rather than by jsdom's timer-backed rAF: the meter
    // throttles itself to ~15fps, so waiting for real frames makes the test
    // a timing race for no gain.
    frame = null;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frame = cb;
      return 1;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    jest.restoreAllMocks();
  });

  const render = async (
    loudness,
    showLive = false,
    orientation = 'horizontal',
  ) => {
    const audioRef = { current: document.createElement('audio') };

    await act(async () => {
      ReactDOM.render(
        <LoudnessMeter
          audioRef={audioRef}
          loudness={loudness ?? null}
          orientation={orientation}
          showLive={showLive}
        />,
        container,
      );
    });

    return container.querySelector('.mp-loudness-meter-label');
  };

  it('shows a live reading on a track with no cached loudness', async () => {
    expect.hasAssertions();

    const label = await render(null);

    expect(label).not.toBeNull();

    act(() => frame(1_000));

    expect(label.textContent).toBe(EXPECTED_LABEL);
  });

  it("shows the track's overall level once it has been analysed", async () => {
    expect.hasAssertions();

    const label = await render({
      integratedLufs: -14.9,
      loudnessRange: 7.3,
      truePeak: -0.2,
    });

    // The redraw loop must leave the integrated figure alone — it is the whole
    // point of showing it, and the live reading would overwrite it 15x/sec.
    act(() => frame(1_000));

    expect(label.textContent).toBe('avg -14.9 LUFS');
  });

  it('keeps reading while the meter is silent', async () => {
    expect.hasAssertions();

    const label = await render(null);

    act(() => frame(1_000));

    // Second frame inside the 65ms throttle window: skipped, so the label must
    // hold its last value rather than reset.
    act(() => frame(1_010));

    expect(label.textContent).toBe(EXPECTED_LABEL);
  });

  it('shows a live readout beside an analysed track’s separate integrated reference', async () => {
    expect.hasAssertions();
    const label = await render({ integratedLufs: -14.9 }, true);
    act(() => frame(1_000));
    expect(label.textContent).toBe(EXPECTED_LABEL);
    expect(
      container.querySelector('[role="meter"]').getAttribute('aria-valuenow'),
    ).toBe('-6.7');
    expect(container.querySelector('.mp-loudness-meter').title).toContain(
      'Integrated: -14.9 LUFS',
    );
  });

  it('fills the vertical meter from the bottom while keeping the same calibrated reading', async () => {
    expect.hasAssertions();
    const label = await render({ integratedLufs: -14.9 }, true, 'vertical');
    act(() => frame(1_000));
    const meter = container.querySelector('[role="meter"]');
    const fill = container.querySelector('.mp-loudness-meter-fill');
    expect(
      meter.parentElement.classList.contains('mp-loudness-meter--vertical'),
    ).toBe(true);
    expect(fill.style.width).toBe('100%');
    expect(Number.parseFloat(fill.style.height)).toBeCloseTo(83.22, 2);
    expect(label.textContent).toBe(EXPECTED_LABEL);
  });

  it('uses the player window’s animation clock while sharing the parent audio graph', async () => {
    expect.hasAssertions();
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const popupContainer = iframe.contentDocument.createElement('div');
    iframe.contentDocument.body.append(popupContainer);
    let popupFrame;
    jest
      .spyOn(iframe.contentWindow, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        popupFrame = callback;
        return 2;
      });
    const cancelPopup = jest
      .spyOn(iframe.contentWindow, 'cancelAnimationFrame')
      .mockImplementation(() => {});
    const createContext = jest
      .spyOn(window, 'AudioContext')
      .mockImplementation(() => new AudioContextStub());
    const audioRef = { current: document.createElement('audio') };
    const loudness = { integratedLufs: -14.9 };
    await act(async () => {
      ReactDOM.render(
        <>
          <LoudnessMeter
            audioRef={audioRef}
            loudness={loudness}
          />
          {ReactDOM.createPortal(
            <LoudnessMeter
              audioRef={audioRef}
              loudness={loudness}
              showLive
            />,
            popupContainer,
          )}
        </>,
        container,
      );
    });
    act(() => popupFrame(1_000));
    expect(
      popupContainer.querySelector('.mp-loudness-meter-label').textContent,
    ).toBe(EXPECTED_LABEL);
    expect(
      container.querySelector('.mp-loudness-meter-label').textContent,
    ).toBe('avg -14.9 LUFS');
    expect(createContext).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(cancelPopup).toHaveBeenCalledWith(2);
    iframe.remove();
  });
});
