import PlaybackSyncMonitor from './PlaybackSyncMonitor';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/mediaAudioGraph', () => ({
  peekMediaAudioGraph: () => ({
    context: {
      state: 'running',
      currentTime: 20,
      getOutputTimestamp: () => ({
        contextTime: 19.8,
        performanceTime: performance.now(),
      }),
    },
  }),
}));

describe('waveform sync monitor', () => {
  let container;
  beforeEach(() => {
    jest.spyOn(performance, 'now').mockReturnValue(1_000);
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });
  it('reports delay and makes compensation an explicit choice', () => {
    expect.hasAssertions();
    const onCompensated = jest.fn();
    act(() => {
      ReactDOM.render(
        <PlaybackSyncMonitor
          audioRef={{
            current: {
              currentTime: 10,
              readyState: 4,
              paused: false,
              playbackRate: 1,
            },
          }}
          compensated={false}
          onCompensated={onCompensated}
          remote={false}
        />,
        container,
      );
    });
    expect(container.textContent).toContain(
      'Reported audio output delay: 200 ms',
    );
    expect(container.querySelector('input').checked).toBe(false);
    act(() => {
      Simulate.change(container.querySelector('input'), {
        target: { checked: true },
      });
    });
    expect(onCompensated).toHaveBeenCalledWith(true);
  });
  it('disables compensation for remote playback', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <PlaybackSyncMonitor
          audioRef={{ current: null }}
          compensated={false}
          onCompensated={() => {}}
          remote
        />,
        container,
      );
    });
    expect(container.textContent).toContain('unavailable for casting');
    expect(container.querySelector('input').disabled).toBe(true);
  });
});
