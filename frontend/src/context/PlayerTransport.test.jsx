import { PlayerProvider, usePlayer } from './PlayerContext';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../lib/musicLibrary', () => ({ getTracks: jest.fn() }));
jest.mock('../lib/streamSignatures', () => ({ ensureSigned: jest.fn() }));

describe('shared player transport', () => {
  it('delegates pause to the existing audio owner without changing the queue', () => {
    expect.hasAssertions();
    sessionStorage.clear();
    const container = document.createElement('div');
    document.body.append(container);
    let player;
    const Probe = () => {
      player = usePlayer();
      return null;
    };

    act(() => {
      ReactDOM.render(
        <PlayerProvider>
          <Probe />
        </PlayerProvider>,
        container,
      );
    });
    const ownerPause = jest.fn();
    act(() => {
      player.playQueue([
        { filename: '/a', path: '/a', bpm: 128, key: 'Am' },
        { filename: '/b', path: '/b' },
      ]);
    });
    const original = player.queue;
    act(() => {
      player.registerPauseHandler(ownerPause);
      player.pausePlayback();
    });
    expect(ownerPause).toHaveBeenCalledTimes(1);
    expect(player.queue).toBe(original);
    expect(player.track.bpm).toBe(128);
    expect(player.track.key).toBe('Am');
    act(() => {
      player.registerPauseHandler(null);
      player.pausePlayback();
    });
    expect(ownerPause).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
});
