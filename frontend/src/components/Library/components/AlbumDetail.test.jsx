import { getTracks } from '../../../lib/musicLibrary';
import AlbumDetail from './AlbumDetail';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/musicLibrary', () => ({ getTracks: jest.fn() }));
jest.mock('../../../context/PlayerContext', () => ({
  usePlayer: () => ({ playQueue: jest.fn() }),
}));
jest.mock('../../../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => null,
}));
jest.mock('./TrackTable', () => mockTrackTable);

// eslint-disable-next-line func-style
function mockTrackTable() {
  return null;
}

describe('album contributing artists', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    jest.clearAllMocks();
  });

  it('keeps the album title and lists unique track artists with navigation', async () => {
    expect.hasAssertions();
    getTracks.mockResolvedValue({
      tracks: [
        { artist: ' Zed ' },
        { artist: 'Alpha' },
        { artist: 'alpha' },
        { artist: 'Various Artists' },
        { artist: '' },
        {},
      ],
    });
    const onArtist = jest.fn();
    await act(async () => {
      ReactDOM.render(
        <AlbumDetail
          album={{
            album: 'Compilation',
            artist: 'Summary artist',
            directory: '/album',
          }}
          onArtist={onArtist}
        />,
        container,
      );
    });
    expect(container.querySelector('.jb-album-hero-title').textContent).toBe(
      'Compilation',
    );
    const artists = [
      ...container.querySelectorAll('[aria-label="Album artists"] button'),
    ];
    expect(artists.map((artist) => artist.textContent)).toEqual([
      'Alpha',
      'Zed',
    ]);
    expect(container.textContent).not.toContain('Summary artist');
    act(() => Simulate.click(artists[1]));
    expect(onArtist).toHaveBeenCalledWith({ artist: 'Zed' });
    expect(getTracks).toHaveBeenCalledWith({
      album: 'Compilation',
      folder: '/album',
      limit: 5_000,
    });
  });

  it('does not invent artists when tracks have no artist metadata', async () => {
    expect.hasAssertions();
    getTracks.mockResolvedValue({ tracks: [{ artist: ' ' }, {}] });
    await act(async () => {
      ReactDOM.render(
        <AlbumDetail album={{ album: 'Untitled release' }} />,
        container,
      );
    });
    expect(container.querySelector('[aria-label="Album artists"]')).toBeNull();
    expect(container.querySelector('.jb-album-hero-title').textContent).toBe(
      'Untitled release',
    );
  });
});
