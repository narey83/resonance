import api from './api';
import { getAll, getStatus, getUploadsPage } from './transfers';

jest.mock('./api', () => ({ get: jest.fn() }));

describe('Paged uploads API', () => {
  beforeEach(() => jest.resetAllMocks());
  it('requests a bounded pending page and keeps the full queue count', async () => {
    expect.hasAssertions();
    const signal = new AbortController().signal;
    const data = [{ username: 'peer', directories: [] }];
    api.get.mockResolvedValue({
      data,
      headers: { 'x-uploads-total-pending': '35013' },
    });
    await expect(getUploadsPage({ page: 2, signal })).resolves.toStrictEqual({
      totalPending: 35_013,
      transfers: data,
    });
    expect(api.get).toHaveBeenCalledWith(
      '/transfers/uploads?page=2&pageSize=250',
      { signal, timeout: 10_000 },
    );
  });
  it.each([undefined, '', '-1', '1.5', 'broken'])(
    'rejects invalid queue counts: %s',
    async (value) => {
      expect.hasAssertions();
      api.get.mockResolvedValue({
        data: [],
        headers: { 'x-uploads-total-pending': value },
      });
      await expect(getUploadsPage()).rejects.toThrow(
        'Invalid paged uploads response',
      );
    },
  );
  it('accepts an empty queue and refuses malformed file lists', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValueOnce({
      data: [],
      headers: { 'x-uploads-total-pending': '0' },
    });
    await expect(getUploadsPage()).resolves.toStrictEqual({
      transfers: [],
      totalPending: 0,
    });
    api.get.mockResolvedValueOnce({
      data: {},
      headers: { 'x-uploads-total-pending': '1' },
    });
    await expect(getUploadsPage()).rejects.toThrow(
      'Invalid paged uploads response',
    );
  });
  it('loads whole-queue counters without requesting file lists', async () => {
    expect.hasAssertions();
    const data = {
      downloads: { activeCount: 0, queuedCount: 0, transfers: [] },
      uploads: {
        activeCount: 1,
        queuedCount: 35_007,
        transfers: [{ id: 'live', state: 'InProgress', bytesTransferred: 42 }],
      },
    };
    api.get.mockResolvedValue({ data });
    await expect(getStatus()).resolves.toStrictEqual(data);
    expect(api.get).toHaveBeenCalledWith(
      '/transfers/status',
      expect.objectContaining({ timeout: 10_000 }),
    );
  });
  it('rejects malformed status rather than inventing zero counts', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: { uploads: {}, downloads: {} } });
    await expect(getStatus()).rejects.toThrow(
      'Invalid transfer status response',
    );
  });
  it('keeps the unpaged API contract for other callers', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: [] });
    await expect(getAll({ direction: 'upload' })).resolves.toStrictEqual([]);
    expect(api.get).toHaveBeenCalledWith(
      '/transfers/uploads',
      expect.objectContaining({ timeout: 10_000 }),
    );
  });
});
