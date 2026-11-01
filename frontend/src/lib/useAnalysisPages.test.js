import { createAnalysisPageCache } from './useAnalysisPages';

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe('analysis track page cache', () => {
  it('requests only the needed exact folder window and deduplicates it', async () => {
    expect.hasAssertions();
    const fetchPage = jest.fn(async () => ({
      items: [{ path: 'last.mp3' }],
      total: 25_330,
    }));
    const cache = createAnalysisPageCache(
      { sort: 'title', analysis: 'incomplete' },
      jest.fn(),
      fetchPage,
    );
    cache.request('/music/Huge', 25_329, 0);
    cache.request('/music/Huge', 25_320, 0);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: '/music/Huge',
        recursive: false,
        limit: 200,
        offset: 25_200,
        analysis: 'incomplete',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    cache.dispose();
  });

  it('limits concurrent requests to two and cancels active and queued work on disposal', async () => {
    expect.hasAssertions();
    const pending = [];
    const fetchPage = jest.fn(
      (query, { signal }) =>
        new Promise((resolve) => {
          pending.push({ done: resolve, signal });
        }),
    );
    const notify = jest.fn();
    const cache = createAnalysisPageCache({}, notify, fetchPage);
    cache.request('a', 0, 0);
    cache.request('b', 0, 0);
    cache.request('c', 0, 0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    pending[0].done({ items: [], total: 0 });
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(3);
    cache.dispose();
    notify.mockClear();
    expect(pending[1].signal.aborted).toBe(true);
    pending[1].done({ items: [], total: 0 });
    pending[2].done({ items: [], total: 0 });
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('drops queued offscreen work and aborts requests after the viewport moves', async () => {
    expect.hasAssertions();
    const pending = [];
    const fetchPage = jest.fn(
      (query, { signal }) =>
        new Promise((resolve) => {
          pending.push({ resolve, signal, folder: query.folder });
        }),
    );
    const cache = createAnalysisPageCache({}, jest.fn(), fetchPage);
    for (const directory of ['a', 'b', 'unused', 'visible'])
      cache.request(directory, 0, 0);
    cache.setVisible([{ directory: 'visible', index: 0 }], 0);
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(true);
    pending[0].resolve({ items: [], total: 0 });
    pending[1].resolve({ items: [], total: 0 });
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(pending[2].folder).toBe('visible');
    expect(cache.get('unused', 0)).toBeUndefined();
    pending[2].resolve({ items: [], total: 0 });
    await settle();
    cache.dispose();
  });

  it('evicts old windows instead of retaining a complete large library', async () => {
    expect.hasAssertions();
    const cache = createAnalysisPageCache({}, jest.fn(), async () => ({
      items: [{ path: 'track' }],
      total: 20_000,
    }));
    for (let index = 0; index < 40; index += 1) {
      cache.request('large', index * 200, 0);
      await settle();
    }

    expect(cache.size).toBe(32);
    expect(cache.get('large', 0)).toBeUndefined();
    expect(cache.get('large', 7_800).items).toHaveLength(1);
    cache.dispose();
  });

  it('retains rows during refresh and retries failures only when requested', async () => {
    expect.hasAssertions();
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ path: 'a' }], total: 1 })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [{ path: 'updated' }], total: 1 });
    const cache = createAnalysisPageCache({}, jest.fn(), fetchPage);
    cache.request('folder', 0, 0);
    await settle();
    cache.request('folder', 0, 1);
    expect(cache.get('folder', 0).items[0].path).toBe('a');
    await settle();
    expect(cache.get('folder', 0).error.message).toBe('offline');
    cache.request('folder', 0, 1);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    cache.retry('folder', 0, 1);
    await settle();
    expect(cache.get('folder', 0).items[0].path).toBe('updated');
    cache.dispose();
  });

  it('surfaces malformed page responses as retryable errors', async () => {
    expect.hasAssertions();
    const cache = createAnalysisPageCache({}, jest.fn(), async () => ({
      items: null,
    }));
    cache.request('folder', 0, 0);
    await settle();
    expect(cache.get('folder', 0).error.message).toBe('Invalid folder page');
    cache.dispose();
  });
});
