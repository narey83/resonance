/* eslint-disable unicorn/consistent-function-scoping -- Jest factories keep mock implementations isolated. */
import { usePlayer } from '../../../context/PlayerContext';
import TrackTable from './TrackTable';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../context/PlayerContext', () => ({ usePlayer: jest.fn() }));
jest.mock('../../../context/SetPlannerContext', () => ({
  useSetPlanner: () => ({ switching: false }),
}));
jest.mock('../../../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => ({ lovedPaths: new Set(), playStats: new Map() }),
}));
jest.mock('../../../hooks/useAnalysisQueue', () => () => ({ scanning: false }));
jest.mock('./MixCompatibilityPreview', () => ({ useMixPreview: () => ({}) }));
jest.mock('./TrackInspector', () => ({ onSeek }) => (
  <div data-testid="inspector">
    <button
      onClick={() => onSeek(3)}
      type="button"
    >
      Seek inspector
    </button>
  </div>
));
jest.mock('./LibraryMenu', () => () => null);
jest.mock('./PlaylistTools', () => () => null);
jest.mock('../../Shared/WaveformPreview', () => ({ onSeek }) => (
  <button
    onClick={() => onSeek?.(0.5)}
    type="button"
  >
    Seek waveform
  </button>
));
jest.mock('react-router-dom', () => ({ useHistory: () => ({}) }));
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 32,
    getVirtualItems: () => [{ index: 0, key: 'one', size: 32, start: 0 }],
    scrollToIndex: jest.fn(),
  }),
}));

describe('Track playback interaction', () => {
  let originalObserver;
  beforeEach(() => {
    originalObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      observe() {}

      disconnect() {}
    };
  });
  afterEach(() => {
    global.ResizeObserver = originalObserver;
  });
  it.each([
    {
      name: 'play button',
      method: 'playQueue',
      tail: [1],
      activate: async (container) => {
        await act(async () => {
          Simulate.click(container.querySelector('[aria-label="Play Song"]'));
        });
      },
    },
    {
      name: 'double click',
      method: 'playQueue',
      tail: [1],
      activate: async (container) => {
        await act(async () => {
          Simulate.doubleClick(container.querySelector('.jb-track-row'));
        });
      },
    },
    {
      name: 'waveform',
      method: 'seekTrack',
      tail: [1, 5, { replaceQueue: true }],
      activate: async (container) => {
        await act(async () => {
          Simulate.click(
            [...container.querySelectorAll('button')].find(
              (b) => b.textContent === 'Seek waveform',
            ),
          );
        });
      },
    },
    {
      name: 'inspector',
      method: 'seekTrack',
      tail: [1, 3, { replaceQueue: true }],
      activate: async (container) => {
        await act(async () => {
          Simulate.click(container.querySelector('.library-inspect-title'));
        });
        await act(async () => {
          Simulate.click(
            [...container.querySelectorAll('button')].find(
              (b) => b.textContent === 'Seek inspector',
            ),
          );
        });
      },
    },
  ])(
    'uses the resolved collection queue for $name',
    async ({ activate, method, tail }) => {
      expect.hasAssertions();
      const transport = { playQueue: jest.fn(), seekTrack: jest.fn() };
      usePlayer.mockReturnValue(transport);
      const track = {
        path: '/song.mp3',
        filename: 'song.mp3',
        title: 'Song',
        duration: 10,
      };
      const tracks = [{ path: '/before.mp3' }, track, { path: '/after.mp3' }];
      const resolvePlaybackQueue = jest
        .fn()
        .mockResolvedValue({ tracks, index: 1 });
      const container = document.createElement('div');
      document.body.append(container);
      try {
        await act(async () => {
          ReactDOM.render(
            <TrackTable
              resolvePlaybackQueue={resolvePlaybackQueue}
              tracks={[track]}
            />,
            container,
          );
        });
        await activate(container);
        expect(resolvePlaybackQueue).toHaveBeenCalledWith(track, 0);
        expect(transport[method].mock.calls[0][0].map((t) => t.path)).toEqual(
          tracks.map((t) => t.path),
        );
        expect(transport[method].mock.calls[0].slice(1)).toEqual(tail);
      } finally {
        act(() => {
          ReactDOM.unmountComponentAtNode(container);
        });
        container.remove();
      }
    },
  );
  it('plays directly without opening the inspector and starting competing requests', () => {
    const oldObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
      }

      observe() {
        this.callback([{ contentRect: { width: 1_200 } }]);
      }

      disconnect() {}
    };
    const playQueue = jest.fn();
    usePlayer.mockReturnValue({ playQueue });
    const container = document.createElement('div');
    document.body.append(container);
    try {
      act(() => {
        ReactDOM.render(
          <TrackTable
            tracks={[
              {
                path: '/song.mp3',
                filename: 'song.mp3',
                title: 'Song',
                duration: 10,
              },
            ]}
          />,
          container,
        );
      });
      act(() => {
        Simulate.click(container.querySelector('[aria-label="Play Song"]'));
      });
      expect(playQueue).toHaveBeenCalledTimes(1);
      expect(playQueue.mock.calls[0][1]).toBe(0);
      expect(container.querySelector('[data-testid="inspector"]')).toBeNull();
      act(() => {
        Simulate.click(container.querySelector('.library-inspect-title'));
      });
      expect(
        container.querySelector('[data-testid="inspector"]'),
      ).not.toBeNull();
    } finally {
      ReactDOM.unmountComponentAtNode(container);
      container.remove();
      global.ResizeObserver = oldObserver;
    }
  });
});
