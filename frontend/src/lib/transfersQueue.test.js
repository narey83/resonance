import api from './api';
import { getUploadsQueue } from './transfers';

jest.mock('./api', () => ({ get: jest.fn() }));
const response = () => ({
  users: [
    {
      username: 'listener',
      pendingCount: 1_000,
      waitingCount: 999,
      activeCount: 1,
    },
  ],
  username: 'listener',
  page: 0,
  totalPending: 1_000,
  userTotalPending: 1_000,
  transfers: [],
});
describe('Recipient upload queue API', () => {
  it('requests a bounded recipient page with cancellation support', async () => {
    expect.hasAssertions();
    const data = response();
    api.get.mockResolvedValue({ data });
    const controller = new AbortController();
    await expect(
      getUploadsQueue({
        username: 'listener',
        page: 2,
        signal: controller.signal,
      }),
    ).resolves.toEqual(data);
    expect(api.get).toHaveBeenCalledWith('/transfers/upload-queue', {
      params: { username: 'listener', page: 2, pageSize: 250 },
      signal: controller.signal,
      timeout: 10_000,
    });
  });
  it('accepts an empty queue when the API omits its null username', async () => {
    expect.hasAssertions();
    const data = {
      users: [],
      page: 0,
      totalPending: 0,
      userTotalPending: 0,
      transfers: [],
      folders: [],
    };
    api.get.mockResolvedValue({ data });
    await expect(getUploadsQueue({ folders: true })).resolves.toEqual({
      ...data,
      username: null,
    });
  });
  it('rejects a missing username when uploads are pending', async () => {
    expect.hasAssertions();
    const data = response();
    delete data.username;
    api.get.mockResolvedValue({ data });
    await expect(getUploadsQueue()).rejects.toThrow(
      'Invalid upload recipient queue response',
    );
  });
  it.each(['totalPending', 'userTotalPending', 'page'])(
    'rejects invalid %s',
    async (field) => {
      expect.hasAssertions();
      api.get.mockResolvedValue({ data: { ...response(), [field]: -1 } });
      await expect(getUploadsQueue()).rejects.toThrow(
        'Invalid upload recipient queue response',
      );
    },
  );
  it('rejects totals that do not reconcile with recipient counts', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: { ...response(), totalPending: 250 } });
    await expect(getUploadsQueue()).rejects.toThrow(
      'Invalid upload recipient queue response',
    );
  });
});
