import { PlayerProvider, usePlayer } from '../../context/PlayerContext';
import { useCast } from '../../hooks/useCast';
import { getTracks } from '../../lib/musicLibrary';
import { ensureSigned } from '../../lib/streamSignatures';
import MediaPlayer from '.';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => null,
}));
jest.mock('../../hooks/useCast', () => ({ useCast: jest.fn() }));
jest.mock('../../hooks/usePlayerMetadata', () => mockMetadata);
jest.mock('../../hooks/useTrackLoudness', () => mockEmpty);
jest.mock('../../lib/musicLibrary', () => ({
  getTracks: jest.fn(),
  getArtworkUrl: jest.fn(),
  recordPlaybackActivity: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../lib/streamSignatures', () => ({ ensureSigned: jest.fn() }));
jest.mock('../../lib/files', () => ({
  getLocalStreamUrl: (path) => `/stream/${path}`,
}));
jest.mock('../../lib/cast', () => ({
  getAbsoluteStreamUrl: jest.fn((path) => Promise.resolve(path)),
}));
jest.mock('../../lib/mediaAudioGraph', () => ({
  peekMediaAudioGraph: jest.fn(),
}));
jest.mock('./AudioProcessing', () => mockEmpty);
jest.mock('./LoudnessMeter', () => mockEmpty);
jest.mock('./PlaybackSyncMonitor', () => mockEmpty);
jest.mock('./WaveformSeekBar', () => mockEmpty);
jest.mock('../Library/components/AlbumArt', () => mockEmpty);

// Jest hoists these factories, so their shared component stubs must be hoisted.
// eslint-disable-next-line func-style
function mockEmpty() {
  return null;
}

// eslint-disable-next-line func-style
function mockMetadata() {
  return {};
}

const tracks = ['first', 'second'].map((name) => ({
  filename: `/music/${name}.mp3`,
  path: `/music/${name}.mp3`,
  localRelativePath: `/music/${name}.mp3`,
  title: name,
  length: 180,
}));

describe('player startup and playback intent', () => {
  let container;
  let player;
  let cast;
  let play;
  let pause;
  let finishValidation;
  const Probe = () => {
    player = usePlayer();
    return null;
  };

  const render = async (showPlayer = true) => {
    await act(async () => {
      ReactDOM.render(
        <PlayerProvider>
          <Probe />
          {showPlayer && <MediaPlayer />}
        </PlayerProvider>,
        container,
      );
    });
  };

  const restore = async () => {
    sessionStorage.setItem(
      'resonance-player-session',
      JSON.stringify({
        track: tracks[0],
        queue: tracks,
        queueIndex: 0,
        // Old/foreign saved flags must never authorize playback.
        isPlaying: true,
        playing: true,
      }),
    );
    await render();
    await act(async () => finishValidation({ tracks }));
  };

  const click = async (title) => {
    await act(async () =>
      Simulate.click(container.querySelector(`[title="${title}"]`)),
    );
  };

  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    cast = {
      connected: false,
      castCurrentTime: 0,
      castDuration: 0,
      castVolumeLevel: 1,
      castIsMuted: false,
      castIsPaused: true,
      castMedia: jest.fn(() => Promise.resolve()),
      castTogglePlay: jest.fn(),
    };
    useCast.mockImplementation(() => cast);
    getTracks.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishValidation = resolve;
        }),
    );
    ensureSigned.mockResolvedValue();
    play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    pause = jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });

  it('keeps the closing frame briefly, then unmounts it without playback', async () => {
    expect.hasAssertions();
    await restore();
    expect(container.querySelector('.media-player-dock--open')).not.toBeNull();
    await click('Close player');
    expect(container.querySelector('.media-player-dock--open')).toBeNull();
    expect(
      container.querySelector('.media-player-dock').getAttribute('aria-hidden'),
    ).toBe('true');
    expect(container.querySelector('.media-player')).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 700);
      });
    });
    expect(container.querySelector('.media-player')).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it('stays paused when a saved queue arrives after asynchronous validation', async () => {
    expect.hasAssertions();
    await restore();
    expect(player.track).toEqual(tracks[0]);
    expect(player.queue).toEqual(tracks);
    expect(player.isPlaying).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector('audio').getAttribute('src')).toBeNull();
    expect(container.querySelector('[title="Play"]')).not.toBeNull();
  });

  it.each([null, '{invalid json'])(
    'starts empty and paused with saved state %s',
    async (saved) => {
      expect.hasAssertions();
      sessionStorage.setItem('resonance-player-session', saved);
      await render();
      expect(player.track).toBeNull();
      expect(player.isPlaying).toBe(false);
      expect(play).not.toHaveBeenCalled();
    },
  );

  it('stays paused when a saved track is available immediately without queue validation', async () => {
    expect.hasAssertions();
    sessionStorage.setItem(
      'resonance-player-session',
      JSON.stringify({ track: tracks[0] }),
    );
    await render();
    expect(player.track).toEqual(tracks[0]);
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores incidental media events and metadata/queue updates until play is requested', async () => {
    expect.hasAssertions();
    await restore();
    await act(async () => {
      const audio = container.querySelector('audio');
      audio.dispatchEvent(new Event('canplay'));
      audio.dispatchEvent(new Event('loadedmetadata'));
      audio.dispatchEvent(new Event('playing'));
      audio.dispatchEvent(new Event('ended'));
      player.enqueueTrack(tracks[0]);
      player.toggleShuffle();
    });
    expect(player.track).toEqual(tracks[0]);
    expect(player.isPlaying).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledWith();
  });

  it('manually resumes the restored position, then pauses again on reload', async () => {
    expect.hasAssertions();
    sessionStorage.setItem(
      'resonance-player-position',
      JSON.stringify({ path: tracks[0].path, time: 42 }),
    );
    await restore();
    await click('Play');
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('audio').currentTime).toBe(42);
    expect(player.isPlaying).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    await render();
    await act(async () => finishValidation({ tracks }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(player.isPlaying).toBe(false);
    expect(player.queue).toEqual(tracks);
  });

  it('plays manual selections, ended transitions, repeat, and queue navigation', async () => {
    expect.hasAssertions();
    await render();
    expect(play).not.toHaveBeenCalled();
    await act(async () => player.playQueue(tracks));
    expect(play).toHaveBeenCalledTimes(1);
    await act(async () =>
      container.querySelector('audio').dispatchEvent(new Event('ended')),
    );
    expect(player.track).toBe(tracks[1]);
    expect(play).toHaveBeenCalledTimes(2);
    await click('Repeat: off');
    await act(async () =>
      container.querySelector('audio').dispatchEvent(new Event('ended')),
    );
    expect(player.track).toBe(tracks[1]);
    expect(play).toHaveBeenCalledTimes(3);
    await act(async () => player.prev());
    expect(player.track).toBe(tracks[0]);
    expect(play).toHaveBeenCalledTimes(4);
  });

  it('plays the same restored track when selected explicitly', async () => {
    expect.hasAssertions();
    await restore();
    await act(async () => player.playQueue(player.queue));
    expect(play).toHaveBeenCalledTimes(1);
    expect(player.isPlaying).toBe(true);
    await click('Pause');
    await act(async () => player.playQueue(player.queue));
    expect(play).toHaveBeenCalledTimes(2);
    expect(player.isPlaying).toBe(true);
  });

  it('loads and plays an unloaded restored track at an explicitly clicked waveform position', async () => {
    expect.hasAssertions();
    sessionStorage.setItem(
      'resonance-player-position',
      JSON.stringify({ path: tracks[0].path, time: 42 }),
    );
    await restore();
    await act(async () => player.seekTrack(player.queue, 0, 75));
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('audio').currentTime).toBe(75);
    expect(player.isPlaying).toBe(true);
  });

  it('keeps a rejected manual play paused and allows a later retry', async () => {
    expect.hasAssertions();
    await restore();
    play.mockRejectedValueOnce(new Error('Autoplay blocked'));
    await click('Play');
    expect(player.isPlaying).toBe(false);
    await render();
    expect(play).toHaveBeenCalledTimes(1);
    await click('Play');
    expect(player.isPlaying).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('replaces a previous queue when a crate waveform selects the same track and honours the clicked position', async () => {
    expect.hasAssertions();
    sessionStorage.setItem(
      'resonance-player-position',
      JSON.stringify({ path: tracks[0].path, time: 42 }),
    );
    await restore();
    const crateTracks = [
      player.track,
      { ...tracks[1], title: 'Crate successor' },
    ];
    await act(async () =>
      player.seekTrack(crateTracks, 0, 75, { replaceQueue: true }),
    );
    expect(player.queue).toBe(crateTracks);
    expect(container.querySelector('audio').currentTime).toBe(75);
    await act(async () => {
      container.querySelector('audio').dispatchEvent(new Event('ended'));
    });
    expect(player.track.title).toBe('Crate successor');
    expect(player.isPlaying).toBe(true);
  });

  it('does not replay a consumed selection when the audio owner remounts', async () => {
    expect.hasAssertions();
    await render();
    await act(async () => player.playQueue(tracks));
    await click('Pause');
    await render(false);
    await render();
    expect(play).toHaveBeenCalledTimes(1);
    expect(player.isPlaying).toBe(false);
    expect(pause).toHaveBeenCalledWith();
  });

  it('does not start local audio when an automatically rejoined Cast session disconnects', async () => {
    expect.hasAssertions();
    await restore();
    cast = {
      ...cast,
      connected: true,
      sessionType: 'resumed',
      castPlayerState: 'PAUSED',
      castIsPaused: true,
    };
    await render();
    cast = { ...cast, connected: false };
    await render();
    expect(cast.castMedia).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(player.isPlaying).toBe(false);
  });

  it('does not advance an automatically rejoined Cast queue, but allows a manual selection', async () => {
    expect.hasAssertions();
    await restore();
    cast = {
      ...cast,
      connected: true,
      sessionType: 'resumed',
      castPlayerState: 'PLAYING',
      castIsPaused: false,
    };
    await render();
    cast = { ...cast, castPlayerState: 'IDLE' };
    await render();
    expect(player.track).toEqual(tracks[0]);
    expect(cast.castMedia).not.toHaveBeenCalled();
    await act(async () => player.jumpTo(1));
    expect(cast.castMedia).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });

  it('cancels a pending signed-stream start when paused or closed', async () => {
    expect.hasAssertions();
    let finishSigning;
    ensureSigned.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSigning = resolve;
        }),
    );
    await render();
    await act(async () => player.play(tracks[0]));
    await act(async () => player.pausePlayback());
    await act(async () => finishSigning());
    expect(play).not.toHaveBeenCalled();
    await act(async () => player.play(tracks[1]));
    await act(async () => player.stop());
    await act(async () => finishSigning());
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector('audio')).toBeNull();
  });
});
