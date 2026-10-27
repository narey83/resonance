import api from './api';
import * as network from './network';
import * as reports from './reports';

jest.mock('./api', () => ({ get: jest.fn(), post: jest.fn() }));
describe('Map request cancellation', () => {
  it('passes cancellation to peer and event requests without serializing the signal', async () => {
    expect.hasAssertions();
    const signal = new AbortController().signal;
    api.get.mockResolvedValue({
      data: [],
      headers: { 'x-total-count': '6000' },
    });
    api.post.mockResolvedValue({ data: {} });
    const result = await reports.getUserList({ limit: 5_000, signal });
    expect(result.total).toBe(6_000);
    const [url, config] = api.get.mock.calls.at(-1);
    expect(config.signal).toBe(signal);
    expect(url).not.toContain('signal=');
    await reports.getUserEventCounts({
      usernames: ['peer'],
      start: 'start',
      signal,
    });
    expect(api.post).toHaveBeenCalledWith(
      expect.stringContaining('event-counts'),
      ['peer'],
      { signal },
    );
  });
  it('passes cancellation to local batches and fallback lookups', async () => {
    expect.hasAssertions();
    const signal = new AbortController().signal;
    api.get.mockResolvedValue({ data: {} });
    api.post.mockResolvedValue({ data: {} });
    await network.batchLookup(['ip'], { signal });
    expect(api.post).toHaveBeenCalledWith('/network/batch', ['ip'], { signal });
    await network.lookupIp('ip', { signal });
    expect(api.get).toHaveBeenCalledWith('/network/lookup?ip=ip', { signal });
  });
});
