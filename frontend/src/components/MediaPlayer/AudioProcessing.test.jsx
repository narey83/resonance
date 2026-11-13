import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import AudioProcessing from './AudioProcessing';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/mediaAudioGraph', () => ({
  getMediaAudioGraph: jest.fn(),
}));
jest.mock('../../lib/prefs', () => ({
  get: jest.fn((_key, fallback) => fallback),
  set: jest.fn(),
}));

describe('Studio in the player', () => {
  let container;
  let frame;
  let launcherTarget;
  let modalTarget;
  let graph;
  let audioRef;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    frame = document.createElement('iframe');
    document.body.append(container, frame);
    launcherTarget = frame.contentDocument.createElement('div');
    modalTarget = frame.contentDocument.createElement('div');
    frame.contentDocument.body.append(launcherTarget, modalTarget);
    graph = {
      studio: { configure: jest.fn(), setMode: jest.fn().mockResolvedValue() },
    };
    getMediaAudioGraph.mockReturnValue(graph);
    audioRef = { current: document.createElement('audio') };
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    frame.remove();
  });

  const render = async (inPlayerWindow = true) => {
    await act(async () => {
      ReactDOM.render(
        <AudioProcessing
          audioRef={audioRef}
          launcherTarget={inPlayerWindow ? launcherTarget : null}
          modalTarget={inPlayerWindow ? modalTarget : null}
        />,
        container,
      );
    });
  };

  it('replaces Processing and keeps Studio state when the player moves windows', async () => {
    expect.hasAssertions();
    await render();
    const dialog = modalTarget.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Resonance Studio');
    expect(dialog.textContent).not.toContain('Audio Processing');
    expect(
      launcherTarget.querySelector('button').getAttribute('aria-label'),
    ).toBe('Open Resonance Studio');
    expect(
      launcherTarget
        .querySelector('[role="group"]')
        .classList.contains('mp-processing-btn--off'),
    ).toBe(true);
    await act(async () =>
      Simulate.click(launcherTarget.querySelector('button')),
    );
    expect(graph.studio.setMode).toHaveBeenCalledWith(true);
    expect(dialog.classList.contains('mp-processing-overlay--hidden')).toBe(
      false,
    );
    act(() =>
      Simulate.change(
        dialog.querySelector('[aria-label="Studio processing rack"]'),
        { target: { checked: true } },
      ),
    );
    expect(graph.studio.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect(
      launcherTarget
        .querySelector('.mp-processing-power')
        .getAttribute('aria-label'),
    ).toBe('Turn Studio off');
    expect(
      launcherTarget
        .querySelector('[role="group"]')
        .classList.contains('mp-processing-btn--on'),
    ).toBe(true);
    expect(prefs.set).toHaveBeenCalledWith(
      'mediaPlayer.studio.v1',
      expect.any(Object),
    );
    await render(false);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(
      dialog.querySelector('[aria-label="Studio processing rack"]').checked,
    ).toBe(true);
  });

  it('opens settings separately from the power switch and preserves the profile', async () => {
    expect.hasAssertions();
    await render();
    const dialog = modalTarget.querySelector('[role="dialog"]');
    const openButton = launcherTarget.querySelector('.mp-processing-btn');
    const powerButton = launcherTarget.querySelector('.mp-processing-power');
    const rack = dialog.querySelector('[aria-label="Studio processing rack"]');

    act(() => Simulate.click(powerButton));
    expect(rack.checked).toBe(true);
    expect(dialog.classList.contains('mp-processing-overlay--hidden')).toBe(
      true,
    );
    expect(powerButton.getAttribute('aria-pressed')).toBe('true');
    expect(graph.studio.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );

    await act(async () => Simulate.click(openButton));
    expect(rack.checked).toBe(true);
    expect(dialog.classList.contains('mp-processing-overlay--hidden')).toBe(
      false,
    );

    act(() => Simulate.click(powerButton));
    expect(rack.checked).toBe(false);
    expect(dialog.classList.contains('mp-processing-overlay--hidden')).toBe(
      false,
    );
    expect(powerButton.getAttribute('aria-pressed')).toBe('false');
    expect(graph.studio.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('changes output profiles and keeps their rack values separate', async () => {
    expect.hasAssertions();
    await render();
    const dialog = modalTarget.querySelector('[role="dialog"]');
    act(() =>
      Simulate.click(
        [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent === 'Warm pressing',
        ),
      ),
    );
    expect(graph.studio.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        values: expect.arrayContaining([0.22]),
      }),
    );
    act(() =>
      Simulate.click(
        [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent === 'Speakers',
        ),
      ),
    );
    expect(graph.studio.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    act(() =>
      Simulate.click(
        [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent === 'Headphones',
        ),
      ),
    );
    expect(graph.studio.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('keeps A/B temporary and requires confirmation for wider ranges', async () => {
    expect.hasAssertions();
    await render();
    const dialog = modalTarget.querySelector('[role="dialog"]');
    const button = (label) =>
      [...dialog.querySelectorAll('button')].find(
        (item) => item.textContent === label,
      );
    act(() => Simulate.click(button('Warm pressing')));
    act(() => Simulate.click(button('B / Processed')));
    expect(graph.studio.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ bypass: true }),
    );
    expect(
      launcherTarget.querySelector('.mp-processing-power').textContent,
    ).toBe('Bypassed');
    expect(
      launcherTarget
        .querySelector('[role="group"]')
        .classList.contains('mp-processing-btn--bypassed'),
    ).toBe(true);
    act(() => Simulate.click(button('Push it')));
    expect(dialog.textContent).toContain('This can get ugly.');
    act(() => Simulate.click(button('Keep it controlled')));
    act(() => Simulate.click(button('Mastering')));
    const exciter = dialog.querySelector('[aria-label="Harmonic exciter"]');
    expect(exciter.max).toBe('0.35');
    act(() => Simulate.click(button('Push it')));
    act(() => Simulate.click(button('Push it — I accept')));
    expect(exciter.max).toBe('1');
    act(() => Simulate.click(button('Return to controlled')));
    expect(exciter.max).toBe('0.35');
  });

  it('closes with Escape in the portal document', async () => {
    expect.hasAssertions();
    await render();
    await act(async () =>
      Simulate.click(launcherTarget.querySelector('button')),
    );
    const dialog = modalTarget.querySelector('[role="dialog"]');
    act(() => {
      dialog.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });
    expect(dialog.classList.contains('mp-processing-overlay--hidden')).toBe(
      true,
    );
  });

  it('reports worklet startup failure while retaining the Studio controls', async () => {
    expect.hasAssertions();
    graph.studio.setMode.mockRejectedValue(new Error('Worklet unavailable'));
    await render();
    await act(async () =>
      Simulate.click(launcherTarget.querySelector('button')),
    );
    const dialog = modalTarget.querySelector('[role="dialog"]');
    expect(dialog.querySelector('[role="alert"]').textContent).toBe(
      'Worklet unavailable',
    );
    expect(
      dialog.querySelector('[aria-label="Studio processing rack"]'),
    ).not.toBeNull();
  });

  it('returns the rack to Off if the power switch cannot start Studio', async () => {
    expect.hasAssertions();
    graph.studio.setMode.mockRejectedValue(new Error('Worklet unavailable'));
    await render();
    await act(async () =>
      Simulate.click(launcherTarget.querySelector('.mp-processing-power')),
    );
    const dialog = modalTarget.querySelector('[role="dialog"]');
    expect(dialog.classList.contains('mp-processing-overlay--hidden')).toBe(
      false,
    );
    expect(dialog.querySelector('[role="alert"]').textContent).toBe(
      'Worklet unavailable',
    );
    expect(
      dialog.querySelector('[aria-label="Studio processing rack"]').checked,
    ).toBe(false);
  });
});
