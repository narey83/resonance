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

  it('summarizes thousands of artists without rendering individual links', async () => {
    expect.hasAssertions();
    getTracks.mockResolvedValue({
      tracks: Array.from({ length: 3_000 }, (_, index) => ({
        artist: `Artist ${index}`,
      })),
    });
    await act(async () => {
      ReactDOM.render(
        <AlbumDetail album={{ album: 'Compilation' }} />,
        container,
      );
    });
    expect(container.querySelector('.jb-album-hero-title').textContent).toBe(
      'Compilation',
    );
    expect(
      container.querySelector('.jb-album-hero-artist-summary').textContent,
    ).toBe('Various Artists');
    expect(container.querySelectorAll('.jb-album-hero-artist')).toHaveLength(0);
    expect(container.textContent).not.toContain('Artist 0');
  });

  it('keeps a single artist clickable and ignores duplicate casing and whitespace', async () => {
    expect.hasAssertions();
    getTracks.mockResolvedValue({
      tracks: [{ artist: ' Zed ' }, { artist: 'zed' }, {}],
    });
    const onArtist = jest.fn();
    await act(async () => {
      ReactDOM.render(
        <AlbumDetail
          album={{ album: 'Solo album' }}
          onArtist={onArtist}
        />,
        container,
      );
    });
    const artist = container.querySelector('.jb-album-hero-artist');
    expect(artist.textContent).toBe('Zed');
    act(() => Simulate.click(artist));
    expect(onArtist).toHaveBeenCalledWith({ artist: 'Zed' });
  });

  it('honours Various Artists album metadata even when only one artist is loaded', async () => {
    expect.hasAssertions();
    getTracks.mockResolvedValue({ tracks: [{ artist: 'Zed' }] });
    await act(async () => {
      ReactDOM.render(
        <AlbumDetail
          album={{ album: 'Compilation', albumArtist: 'Various Artists' }}
        />,
        container,
      );
    });
    expect(
      container.querySelector('.jb-album-hero-artist-summary').textContent,
    ).toBe('Various Artists');
    expect(container.querySelector('.jb-album-hero-artist')).toBeNull();
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
    expect(container.querySelector('.jb-album-hero-artist')).toBeNull();
    expect(container.querySelector('.jb-album-hero-artist-summary')).toBeNull();
    expect(container.querySelector('.jb-album-hero-title').textContent).toBe(
      'Untitled release',
    );
  });
});
