import { resolveFailedTrackPaths } from './analysisRetry';
import api from './api';

jest.mock('./api', () => ({ get: jest.fn(), post: jest.fn() }));

describe('resolving failed tracks', () => {
  beforeEach(() => jest.clearAllMocks());
  it('resolves exact library paths in one batch and deduplicates selection', async () => {
    expect.hasAssertions();
    api.post.mockResolvedValue({ data: [{ path: '/music/one.mp3' }] });
    await expect(
      resolveFailedTrackPaths([
        { path: '/music/one.mp3' },
        { path: '/music/one.mp3' },
      ]),
    ).resolves.toEqual(['/music/one.mp3']);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
  });
  it('resolves historic basenames against actual library directories', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: [{ path: '/one' }, { path: '/two/' }] });
    api.post.mockResolvedValue({ data: [{ path: '/two/song.mp3' }] });
    await expect(
      resolveFailedTrackPaths([{ path: 'song.mp3' }]),
    ).resolves.toEqual(['/two/song.mp3']);
    expect(api.post).toHaveBeenCalledWith(
      '/musiclibrary/resolve',
      ['/one/song.mp3', '/two/song.mp3'],
      expect.anything(),
    );
  });
  it('refuses ambiguous filenames rather than choosing an album', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: [{ path: '/one' }, { path: '/two' }] });
    api.post.mockResolvedValue({
      data: [{ path: '/one/song.mp3' }, { path: '/two/song.mp3' }],
    });
    await expect(
      resolveFailedTrackPaths([{ path: 'song.mp3' }]),
    ).rejects.toThrow('Several library tracks');
  });
  it('does not collapse paths that differ only in letter case', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: [{ path: '/music' }] });
    api.post.mockResolvedValue({
      data: [{ path: '/music/Song.mp3' }, { path: '/music/song.mp3' }],
    });
    await expect(
      resolveFailedTrackPaths([{ path: 'song.mp3' }]),
    ).rejects.toThrow('Several library tracks');
  });
  it('bounds path resolution requests to 200 candidates', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({
      data: Array.from({ length: 201 }, (_, i) => ({ path: `/folder${i}` })),
    });
    api.post
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ path: '/folder200/song.mp3' }] });
    await expect(
      resolveFailedTrackPaths([{ path: 'song.mp3' }]),
    ).resolves.toEqual(['/folder200/song.mp3']);
    expect(api.post.mock.calls.map((call) => call[1].length)).toEqual([200, 1]);
  });
  it('refuses missing paths, empty selections and oversized selections', async () => {
    expect.hasAssertions();
    api.post.mockResolvedValue({ data: [] });
    await expect(
      resolveFailedTrackPaths([{ path: '/music/missing.mp3' }]),
    ).rejects.toThrow('could not be found');
    await expect(resolveFailedTrackPaths([])).rejects.toThrow(
      'between 1 and 100',
    );
    await expect(
      resolveFailedTrackPaths(
        Array.from({ length: 101 }, (_, i) => ({ path: `${i}.mp3` })),
      ),
    ).rejects.toThrow('between 1 and 100');
  });
});
