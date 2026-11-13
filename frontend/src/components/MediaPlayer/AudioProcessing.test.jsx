import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import AudioProcessing from './AudioProcessing';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

const mockLifecycle = { mounted: jest.fn(), disposed: jest.fn() };
jest.mock('../../lib/mediaAudioGraph', () => ({
  getMediaAudioGraph: jest.fn(),
}));
jest.mock('../../lib/prefs', () => ({
  get: jest.fn((_key, fallback) => fallback),
  set: jest.fn(),
}));
jest.mock('./PerformanceMode', () => {
  const reactForMock = jest.requireActual('react');
  return () => {
    reactForMock.useEffect(() => {
      mockLifecycle.mounted();
      return () => mockLifecycle.disposed();
    }, []);
    return null;
  };
});
// Jest hoists the module factories above imports, so this mock must be hoisted too.
// eslint-disable-next-line func-style
function mockEmptyProcessor() {
  return null;
}

jest.mock('./EqView', () => mockEmptyProcessor);
jest.mock('./CompressorView', () => mockEmptyProcessor);
jest.mock('./LimiterView', () => mockEmptyProcessor);
jest.mock('./SaturationView', () => mockEmptyProcessor);
jest.mock('./StereoView', () => mockEmptyProcessor);
jest.mock('./FilterView', () => mockEmptyProcessor);

describe('shared processing controls across documents', () => {
  let container;
  let frame;
  let launcherTarget;
  let modalTarget;
  let audioRef;
  let graph;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    frame = document.createElement('iframe');
    document.body.append(container, frame);
    launcherTarget = frame.contentDocument.createElement('div');
    modalTarget = frame.contentDocument.createElement('div');
    frame.contentDocument.body.append(launcherTarget, modalTarget);
    audioRef = { current: document.createElement('audio') };
    let listener;
    let bypassed = true;
    graph = {
      processing: {
        subscribe: jest.fn((callback) => {
          listener = callback;
          callback(bypassed);
          return jest.fn();
        }),
        setBypassed: jest.fn((value) => {
          bypassed = value;
          listener(value);
        }),
      },
      dsp: { performance: { setAdvanced: jest.fn() } },
    };
    getMediaAudioGraph.mockReturnValue(graph);
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
          targetLufs={-9}
        />,
        container,
      );
    });
  };

  it('moves the existing rack between windows without disposing processors or resetting controls', async () => {
    expect.hasAssertions();
    await render();
    const dialog = modalTarget.querySelector('[role="dialog"]');
    act(() => Simulate.click(launcherTarget.querySelector('button')));
    expect(dialog.classList.contains('mp-processing-overlay--hidden')).toBe(
      false,
    );
    const enable = dialog.querySelector(
      '[aria-label="Enable audio processing"]',
    );
    act(() => Simulate.change(enable));
    act(() => Simulate.click(dialog.querySelector('.mp-processing-unlock')));
    expect(enable.checked).toBe(true);
    expect(container.querySelector('button').textContent).toBe('Processing');
    expect(launcherTarget.querySelector('button').textContent).toBe(
      'Processing',
    );
    expect(graph.processing.setBypassed).toHaveBeenCalledWith(false);
    expect(prefs.set).toHaveBeenCalledWith(
      'mediaPlayer.processingAdvanced',
      true,
    );

    await render(false);
    expect(dialog.ownerDocument).toBe(document);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(enable.checked).toBe(true);
    expect(
      dialog
        .querySelector('.mp-processing-unlock')
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await render();
    expect(modalTarget.querySelector('[role="dialog"]')).toBe(dialog);
    expect(mockLifecycle.mounted).toHaveBeenCalledTimes(1);
    expect(mockLifecycle.disposed).not.toHaveBeenCalled();
    expect(graph.processing.subscribe).toHaveBeenCalledTimes(1);
  });

  it('Escape closes processing in its document without handling unrelated window keys', async () => {
    expect.hasAssertions();
    await render();
    act(() => Simulate.click(launcherTarget.querySelector('button')));
    const windowKey = jest.fn();
    frame.contentWindow.addEventListener('keydown', windowKey);
    act(() => {
      frame.contentDocument.activeElement.dispatchEvent(
        new frame.contentWindow.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });
    expect(
      modalTarget
        .querySelector('[role="dialog"]')
        .classList.contains('mp-processing-overlay--hidden'),
    ).toBe(true);
    expect(
      launcherTarget.querySelector('button').getAttribute('aria-expanded'),
    ).toBe('false');
    expect(windowKey).not.toHaveBeenCalled();
    frame.contentWindow.removeEventListener('keydown', windowKey);
  });
});
