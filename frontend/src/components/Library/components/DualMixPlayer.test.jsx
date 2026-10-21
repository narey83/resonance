import { renderMixDeck } from '../../../lib/prepareMixAudio';
import DualMixPlayer from './DualMixPlayer';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/prepareMixAudio', () => ({ renderMixDeck: jest.fn() }));
const plan = {
  available: true,
  bpm: 128,
  bars: 8,
  duration: 30,
  leadBars: 4,
  tailBars: 4,
  handoverStart: 7.5,
  handoverEnd: 22.5,
  decks: ['a', 'b'].map((path, index) => ({
    timelineStart: index === 0 ? 0 : 7.5,
    path,
    knots: Array.from({ length: 9 }, (_, i) => i * 2),
  })),
};
const buffer = { length: 1_323_000, sampleRate: 44_100, duration: 30 };
let instances;
class AudioContextStub {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
    this.sources = [];
    this.gains = [];
    instances.push(this);
  }

  resume = jest.fn().mockResolvedValue();

  close = jest.fn(async () => {
    this.state = 'closed';
  });

  createGain = () => {
    const gain = {
      gain: {
        value: 1,
        setTargetAtTime: jest.fn(),
        cancelScheduledValues: jest.fn(),
        setValueAtTime: jest.fn(),
        setValueCurveAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    this.gains.push(gain);
    return gain;
  };

  createBufferSource = () => {
    const source = {
      start: jest.fn(),
      stop: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    this.sources.push(source);
    return source;
  };
}
const button = (name) =>
  [...document.querySelectorAll('.mix-dual-player button')].find(
    (node) =>
      node.textContent.trim() === name ||
      node.getAttribute('aria-label') === name,
  );

describe('ending-to-opening transition controls', () => {
  let container;
  let onBeforePlay;
  beforeEach(() => {
    jest.clearAllMocks();
    instances = [];
    window.AudioContext = AudioContextStub;
    renderMixDeck.mockResolvedValue(buffer);
    container = document.createElement('div');
    document.body.append(container);
    onBeforePlay = jest.fn();
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    delete window.AudioContext;
  });
  const render = (mainPlaying = false) =>
    act(() => {
      ReactDOM.render(
        <DualMixPlayer
          mainPlaying={mainPlaying}
          onBeforePlay={onBeforePlay}
          plan={plan}
        />,
        container,
      );
    });
  // This helper groups the gesture and React async settling for each test.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const clickPlay = async () => {
    await act(async () => {
      Simulate.click(button('Preview transition'));
    });
  };

  it('loads only after a click, pauses normal playback and starts both stems on the master clock', async () => {
    expect.hasAssertions();
    render();
    // eslint-disable-next-line jest/prefer-called-with
    expect(renderMixDeck).not.toHaveBeenCalled();
    expect(document.querySelector('[type=checkbox]').checked).toBe(true);
    expect(document.querySelector('[aria-label="Crossfader"]').value).toBe('0');
    expect(button('Crossfader B only').disabled).toBe(true);
    await clickPlay();
    expect(instances[0].gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(
      0,
      0.04,
    );
    expect(
      instances[0].gains[0].gain.setValueCurveAtTime.mock.calls.at(-1)[1],
    ).toBeCloseTo(7.54);
    expect(onBeforePlay).toHaveBeenCalledTimes(1);
    expect(renderMixDeck).toHaveBeenCalledTimes(2);
    expect(
      renderMixDeck.mock.calls.map((call) => [call[1].path, call[2]]),
    ).toEqual([
      ['a', 128],
      ['b', 128],
    ]);
    expect(
      instances[0].sources.map((source) => source.start.mock.calls),
    ).toEqual([[[0.04, 0]], [[0.04, 0]]]);
    expect(document.querySelector('.mix-dual-state').textContent).toContain(
      'A ending · B cued',
    );
    act(() => Simulate.click(button('Pause transition')));
    expect(instances[0].sources[0].stop).toHaveBeenCalledWith(0);
    expect(instances[0].sources[1].stop).toHaveBeenCalledWith(0);
  });
  it('moves the real gain nodes with the crossfader and volume controls', async () => {
    expect.hasAssertions();
    render();
    await clickPlay();
    act(() =>
      Simulate.change(document.querySelector('[type=checkbox]'), {
        target: { checked: false },
      }),
    );
    act(() => Simulate.click(button('Crossfader B only')));
    expect(
      instances[0].gains[0].gain.setTargetAtTime.mock.calls.at(-1)[0],
    ).toBeLessThan(1e-10);
    expect(
      instances[0].gains[1].gain.setTargetAtTime.mock.calls.at(-1)[0],
    ).toBeCloseTo(1 / Math.SQRT2);
    act(() =>
      Simulate.change(
        document.querySelector('[aria-label="Mix preview volume"]'),
        { target: { value: '0.3' } },
      ),
    );
    expect(instances[0].gains[2].gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0.3,
      0,
      0.012,
    );
    act(() => Simulate.click(button('Centre crossfader')));
    expect(
      instances[0].gains[0].gain.setTargetAtTime.mock.calls.at(-1)[0],
    ).toBeCloseTo(0.5);
  });
  it('stops both stems when normal player playback resumes or the preview closes', async () => {
    expect.hasAssertions();
    render();
    await clickPlay();
    render(true);
    expect(instances[0].sources[0].stop).toHaveBeenCalledWith(0);
    expect(instances[0].sources[1].stop).toHaveBeenCalledWith(0);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });
  it('cancels preparation without starting either deck and permits a retry', async () => {
    expect.hasAssertions();
    renderMixDeck.mockImplementationOnce(
      (_ctx, _deck, _bpm, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Cancelled', 'AbortError'));
          });
        }),
    );
    render();
    await clickPlay();
    expect(button('Cancel preparation')).toBeTruthy();
    await act(async () => Simulate.click(button('Cancel preparation')));
    expect(instances[0].sources).toHaveLength(0);
    expect(instances[0].close).toHaveBeenCalledWith();
    await clickPlay();
    expect(instances[1].sources).toHaveLength(2);
  });
  it('does not autoplay a late audio response after closing', async () => {
    expect.hasAssertions();
    let finish;
    renderMixDeck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await clickPlay();
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    await act(async () => finish(buffer));
    expect(instances[0].sources).toHaveLength(0);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending render when normal playback starts', async () => {
    expect.hasAssertions();
    renderMixDeck.mockImplementationOnce(
      (_ctx, _deck, _bpm, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Cancelled', 'AbortError'));
          });
        }),
    );
    render();
    await clickPlay();
    await act(async () => {
      render(true);
    });
    expect(instances[0].sources).toHaveLength(0);
    expect(instances[0].close).toHaveBeenCalledWith();
  });
  it('uses the latest fader setting after preparation completes', async () => {
    expect.hasAssertions();
    let finish;
    renderMixDeck.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await clickPlay();
    act(() =>
      Simulate.change(document.querySelector('[type=checkbox]'), {
        target: { checked: false },
      }),
    );
    act(() => Simulate.click(button('Crossfader B only')));
    await act(async () => {
      finish(buffer);
    });
    expect(
      instances[0].gains[0].gain.setTargetAtTime.mock.calls.at(-1)[0],
    ).toBeLessThan(1e-10);
    expect(instances[0].sources).toHaveLength(2);
  });
  it('reports an audio error without leaving a running context', async () => {
    expect.hasAssertions();
    renderMixDeck.mockRejectedValueOnce(new Error('Missing track'));
    render();
    await clickPlay();
    expect(document.querySelector('[role="alert"]').textContent).toBe(
      'Missing track',
    );
    expect(instances[0].close).toHaveBeenCalledWith();
    expect(instances[0].sources).toHaveLength(0);
  });
  it('reuses one unlocked context across automatic handovers and disposes old sources', async () => {
    expect.hasAssertions();
    const contextRef = { current: null };
    const volumeRef = { current: 0.8 };
    const complete = jest.fn();
    const started = jest.fn();
    await act(async () => {
      ReactDOM.render(
        <DualMixPlayer
          contextRef={contextRef}
          key="first"
          mainPlaying={false}
          onBeforePlay={onBeforePlay}
          onComplete={complete}
          onStarted={started}
          plan={plan}
          volumeRef={volumeRef}
        />,
        container,
      );
    });
    act(() => {
      Simulate.change(
        document.querySelector('[aria-label="Mix preview volume"]'),
        {
          target: { value: '0.25' },
        },
      );
    });
    await clickPlay();
    expect(volumeRef.current).toBe(0.25);
    const ended = instances[0].sources.map((source) => source.onended);
    instances[0].currentTime = 30.04;
    act(() => {
      ended[0]();
      ended[1]();
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({ fullyPlayed: true });
    const old = instances[0].sources[0];
    await act(async () => {
      ReactDOM.render(
        <DualMixPlayer
          contextRef={contextRef}
          key="second"
          mainPlaying={false}
          onBeforePlay={onBeforePlay}
          onComplete={complete}
          onStarted={started}
          plan={plan}
          playRequest={1}
          volumeRef={volumeRef}
        />,
        container,
      );
    });
    expect(instances).toHaveLength(1);
    expect(
      document.querySelector('[aria-label="Mix preview volume"]').value,
    ).toBe('0.25');
    expect(instances[0].close).not.toHaveBeenCalled();
    expect(old.stop).toHaveBeenCalledWith(30.04);
    expect(started).toHaveBeenCalledTimes(2);
    expect(renderMixDeck).toHaveBeenCalledTimes(4);
    await act(async () => {
      ReactDOM.render(
        <DualMixPlayer
          contextRef={contextRef}
          key="second"
          mainPlaying={false}
          onBeforePlay={onBeforePlay}
          onComplete={complete}
          onStarted={started}
          plan={plan}
          playRequest={1}
        />,
        container,
      );
    });
    expect(renderMixDeck).toHaveBeenCalledTimes(4);
  });
  it('marks seeking as partial and does not complete just by seeking to the end', async () => {
    expect.hasAssertions();
    const complete = jest.fn();
    const suspend = jest.fn();
    await act(async () => {
      ReactDOM.render(
        <DualMixPlayer
          mainPlaying={false}
          onBeforePlay={onBeforePlay}
          onComplete={complete}
          onSuspend={suspend}
          plan={{ ...plan, duration: 30.006 }}
        />,
        container,
      );
    });
    await clickPlay();
    await act(async () =>
      Simulate.change(
        document.querySelector('[aria-label="Seek transition"]'),
        { target: { value: '20' } },
      ),
    );
    const ended = instances[0].sources.at(-1).onended;
    instances[0].currentTime = 10.04;
    act(() => ended());
    expect(complete).toHaveBeenCalledWith({ fullyPlayed: false });
    await act(async () =>
      Simulate.change(
        document.querySelector('[aria-label="Seek transition"]'),
        { target: { value: '30' } },
      ),
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(suspend).toHaveBeenLastCalledWith('seek-end');
  });
});
