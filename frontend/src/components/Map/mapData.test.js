import * as network from '../../lib/network';
import * as reports from '../../lib/reports';
import { loadMapPeers, locateLivePeers, lookupLocations } from './mapData';

jest.mock('../../lib/network', () => ({
  batchLookup: jest.fn(),
  lookupIp: jest.fn(),
}));
jest.mock('../../lib/reports', () => ({
  getUserList: jest.fn(),
  getUserEventCounts: jest.fn(),
}));
const deferred = () => {
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: finish };
};

const options = () => ({
  start: 'start',
  end: 'end',
  signal: new AbortController().signal,
  onPeers: jest.fn(),
  onTotal: jest.fn(),
  onReady: jest.fn(),
});
describe('Map peer loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    network.batchLookup.mockResolvedValue({});
    reports.getUserEventCounts.mockResolvedValue({});
  });
  it('aggregates once and publishes stored coordinates before optional details finish', async () => {
    expect.hasAssertions();
    const events = deferred();
    reports.getUserList.mockResolvedValue({
      items: [{ username: 'equator', lat: 0, lon: 0 }],
      total: 6_000,
    });
    reports.getUserEventCounts.mockReturnValue(events.promise);
    const ready = deferred();
    const settings = options();
    settings.onReady.mockImplementation(() => ready.resolve());
    const loading = loadMapPeers(settings);
    await ready.promise;
    expect(reports.getUserList).toHaveBeenCalledTimes(1);
    expect(reports.getUserList).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5_000,
        offset: 0,
        signal: settings.signal,
      }),
    );
    expect(settings.onPeers).toHaveBeenCalledWith([
      expect.objectContaining({ username: 'equator' }),
    ]);
    expect(settings.onReady).toHaveBeenCalledWith();
    expect(settings.onTotal).toHaveBeenCalledWith(6_000);
    events.resolve({});
    await loading;
  });
  it('keeps event counts when locations arrive later and deduplicates shared IPs', async () => {
    expect.hasAssertions();
    const locations = deferred();
    reports.getUserList.mockResolvedValue({
      items: [
        { username: 'a', ipAddress: 'one' },
        { username: 'b', ipAddress: 'one' },
      ],
      total: 2,
    });
    network.batchLookup.mockReturnValue(locations.promise);
    reports.getUserEventCounts.mockResolvedValue({ a: { chatCount: 3 } });
    const settings = options();
    const loading = loadMapPeers(settings);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    locations.resolve({ one: { lat: 0, lon: 10 } });
    await loading;
    expect(network.batchLookup).toHaveBeenCalledWith(['one'], {
      signal: settings.signal,
    });
    expect(settings.onPeers.mock.calls.at(-1)[0]).toEqual([
      expect.objectContaining({ username: 'a', chatCount: 3, lat: 0 }),
      expect.objectContaining({ username: 'b', lat: 0 }),
    ]);
  });
  it('does not publish or enrich an obsolete range', async () => {
    expect.hasAssertions();
    const peers = deferred();
    reports.getUserList.mockReturnValue(peers.promise);
    const controller = new AbortController();
    const settings = { ...options(), signal: controller.signal };
    const loading = loadMapPeers(settings);
    controller.abort();
    peers.resolve({ items: [], total: 0 });
    await loading;
    expect(settings.onPeers).not.toHaveBeenCalled();
    expect(network.batchLookup).not.toHaveBeenCalled();
  });
  it('chunks locations at the server limit without dropping the final batch', async () => {
    expect.hasAssertions();
    const signal = new AbortController().signal;
    await lookupLocations(
      Array.from({ length: 4_500 }, (_, index) => String(index)),
      signal,
    );
    expect(network.batchLookup.mock.calls.map(([ips]) => ips.length)).toEqual([
      2_000, 2_000, 500,
    ]);
  });
  it('batches live peers and remembers misses without repeated lookups', async () => {
    expect.hasAssertions();
    const peers = [
      { ip: 'one', username: 'a', active: true },
      { ip: 'missing', username: 'b', active: true },
    ];
    network.batchLookup.mockResolvedValue({ one: { lat: 0, lon: 0 } });
    network.lookupIp.mockRejectedValue(new Error('unavailable'));
    const cache = new Map();
    const signal = new AbortController().signal;
    const first = await locateLivePeers(peers, cache, signal);
    const second = await locateLivePeers(peers, cache, signal);
    expect(first).toEqual([
      expect.objectContaining({ username: 'a', lat: 0, lon: 0 }),
    ]);
    expect(second).toEqual(first);
    expect(network.batchLookup).toHaveBeenCalledTimes(1);
    expect(network.lookupIp).toHaveBeenCalledTimes(1);
  });
  it('publishes local live locations before a slow fallback completes', async () => {
    expect.hasAssertions();
    const fallback = deferred();
    const published = deferred();
    network.batchLookup.mockResolvedValue({ local: { lat: 1, lon: 2 } });
    network.lookupIp.mockReturnValue(fallback.promise);
    const onLocations = jest.fn((locations) => published.resolve(locations));
    const loading = locateLivePeers(
      [{ ip: 'local' }, { ip: 'remote' }],
      new Map(),
      new AbortController().signal,
      onLocations,
    );
    await expect(published.promise).resolves.toEqual([
      expect.objectContaining({ ip: 'local', lat: 1 }),
    ]);
    fallback.resolve(null);
    await loading;
  });
});
