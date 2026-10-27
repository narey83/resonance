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
jest.mock('./TrackInspector', () => () => (
  <div data-testid="inspector">Inspector</div>
));
jest.mock('./LibraryMenu', () => () => null);
jest.mock('./PlaylistTools', () => () => null);
jest.mock('../../Shared/WaveformPreview', () => () => null);
jest.mock('react-router-dom', () => ({ useHistory: () => ({}) }));
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 32,
    getVirtualItems: () => [{ index: 0, key: 'one', size: 32, start: 0 }],
    scrollToIndex: jest.fn(),
  }),
}));

describe('Track playback interaction', () => {
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
