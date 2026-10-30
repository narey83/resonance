import {
  getAlbumPage,
  getArtistPage,
  getLibraryStats,
  getRecentlyAdded,
} from '../lib/musicLibrary';
import useLibraryHomeData from './useLibraryHomeData';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../lib/musicLibrary', () => ({
  getAlbumPage: jest.fn(),
  getArtistPage: jest.fn(),
  getLibraryStats: jest.fn(),
  getRecentlyAdded: jest.fn(),
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
};

describe('library home request priority', () => {
  let container;
  let data;
  let recent;
  const Probe = ({ limit, revision = 0 }) => {
    data = useLibraryHomeData(revision, limit);
    return (
      <div>{data.recentlyAdded.map((album) => album.album).join(', ')}</div>
    );
  };

  const render = async (props = {}) => {
    await act(async () => {
      ReactDOM.render(<Probe {...props} />, container);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    recent = deferred();
    getRecentlyAdded.mockReturnValue(recent.promise);
    getLibraryStats.mockResolvedValue({ total: 100 });
    getArtistPage.mockResolvedValue({ total: 20 });
    getAlbumPage.mockResolvedValue({ total: 30 });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('requests only the 16 displayed albums before starting full-library aggregates', async () => {
    expect.hasAssertions();
    await render();
    expect(getRecentlyAdded).toHaveBeenCalledWith(16);
    expect(getLibraryStats).toHaveBeenCalledTimes(1);
    expect(getArtistPage).not.toHaveBeenCalled();
    expect(getAlbumPage).not.toHaveBeenCalled();
    expect(data.libraryStats.total).toBe(100);
    await act(async () => {
      recent.resolve([{ album: 'Newest release' }]);
    });
    expect(container.textContent).toBe('Newest release');
    expect(getArtistPage).toHaveBeenCalledWith({ limit: 1 });
    expect(getAlbumPage).toHaveBeenCalledWith({ limit: 1 });
    expect(data.artistCount).toBe(20);
    expect(data.albumCount).toBe(30);
  });

  it('renders recent albums without waiting for count requests to complete', async () => {
    expect.hasAssertions();
    const artists = deferred();
    const albums = deferred();
    getArtistPage.mockReturnValue(artists.promise);
    getAlbumPage.mockReturnValue(albums.promise);
    await render();
    await act(async () => {
      recent.resolve([{ album: 'Already visible' }]);
    });
    expect(container.textContent).toBe('Already visible');
    expect(data.albumCount).toBe(0);
    await act(async () => {
      artists.resolve({ total: 40 });
      albums.resolve({ total: 50 });
    });
    expect(data.albumCount).toBe(50);
  });

  it('allows the dedicated recent view to request its larger list', async () => {
    expect.hasAssertions();
    await render({ limit: 48 });
    expect(getRecentlyAdded).toHaveBeenCalledWith(48);
    await act(async () => {
      recent.resolve([]);
    });
    expect(getAlbumPage).toHaveBeenCalledTimes(1);
  });

  it('keeps stats and counts available when recent albums fail', async () => {
    expect.hasAssertions();
    getRecentlyAdded.mockRejectedValue(new Error('temporary failure'));
    await render();
    expect(data.libraryStats.total).toBe(100);
    expect(data.artistCount).toBe(20);
    expect(data.albumCount).toBe(30);
    expect(data.recentlyAdded).toEqual([]);
  });

  it('discards stale refresh results and does not start their aggregate requests', async () => {
    expect.hasAssertions();
    await render();
    getRecentlyAdded.mockResolvedValue([{ album: 'Current' }]);
    await render({ revision: 1 });
    await act(async () => {
      recent.resolve([{ album: 'Stale' }]);
    });
    expect(container.textContent).toBe('Current');
    expect(getAlbumPage).toHaveBeenCalledTimes(1);
  });

  it('stops secondary requests when the library unmounts during the initial fetch', async () => {
    expect.hasAssertions();
    await render();
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    await act(async () => {
      recent.resolve([{ album: 'Late' }]);
    });
    expect(getArtistPage).not.toHaveBeenCalled();
    expect(getAlbumPage).not.toHaveBeenCalled();
  });
});
