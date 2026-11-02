import { getCompleteUploadsQueue } from './completeUploadQueue';
import { getUploadsQueue } from './transfers';

jest.mock('./transfers', () => ({ getUploadsQueue: jest.fn() }));
const makeFile = (index, state = 'Queued') => ({
  id: `id-${index}`,
  username: 'listener',
  filename: `Music/Album/Track ${index}.flac`,
  direction: 'Upload',
  state,
});
const snapshot = (files, count, page = 0) => ({
  users: [
    {
      username: 'listener',
      pendingCount: count,
      waitingCount: count,
      activeCount: 0,
    },
  ],
  username: 'listener',
  page,
  totalPending: count,
  userTotalPending: count,
  transfers: files.length
    ? [
        {
          username: 'listener',
          directories: [{ directory: 'Music/Album', files }],
        },
      ]
    : [],
});
const filesFrom = (result) =>
  result.transfers.flatMap((user) =>
    user.directories.flatMap((directory) => directory.files),
  );
const serve = (all) =>
  getUploadsQueue.mockImplementation(async ({ page }) =>
    snapshot(all.slice(page * 500, (page + 1) * 500), all.length, page),
  );

describe('Complete recipient upload queue', () => {
  it('loads all 8,053 tracks without exposing a page limit and limits concurrent requests', async () => {
    expect.hasAssertions();
    const all = Array.from({ length: 8_053 }, (_, i) => makeFile(i));
    let inFlight = 0;
    let maximum = 0;
    getUploadsQueue.mockImplementation(async ({ page }) => {
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      await Promise.resolve();
      inFlight--;
      return snapshot(
        all.slice(page * 500, (page + 1) * 500),
        all.length,
        page,
      );
    });
    const result = await getCompleteUploadsQueue({ username: 'listener' });
    expect(filesFrom(result)).toHaveLength(8_053);
    expect(filesFrom(result).at(-1).id).toBe('id-8052');
    expect(new Set(filesFrom(result).map((f) => f.id)).size).toBe(8_053);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(
      new Set(getUploadsQueue.mock.calls.map(([args]) => args.page)).size,
    ).toBe(17);
  });
  it('refreshes progress without repeatedly fetching an unchanged backlog', async () => {
    expect.hasAssertions();
    const all = Array.from({ length: 1_200 }, (_, i) => makeFile(i));
    serve(all);
    const previous = await getCompleteUploadsQueue();
    getUploadsQueue.mockClear();
    all[0] = makeFile(0, 'InProgress');
    serve(all);
    const result = await getCompleteUploadsQueue({ previous });
    expect(getUploadsQueue).toHaveBeenCalledTimes(1);
    expect(filesFrom(result)).toHaveLength(1_200);
    expect(filesFrom(result)[0].state).toBe('InProgress');
    expect(result.detailsLoadedAt).toBe(previous.detailsLoadedAt);
  });
  it('reloads the whole list when membership counts change', async () => {
    expect.hasAssertions();
    const all = Array.from({ length: 1_200 }, (_, i) => makeFile(i));
    serve(all);
    const previous = await getCompleteUploadsQueue();
    getUploadsQueue.mockClear();
    all.splice(800, 1);
    serve(all);
    const result = await getCompleteUploadsQueue({ previous });
    expect(filesFrom(result)).toHaveLength(1_199);
    expect(filesFrom(result).some((f) => f.id === 'id-800')).toBe(false);
    expect(getUploadsQueue.mock.calls.length).toBeGreaterThan(1);
  });
  it('periodically reconciles membership even when the count stays the same', async () => {
    expect.hasAssertions();
    const all = Array.from({ length: 1_200 }, (_, i) => makeFile(i));
    serve(all);
    const previous = await getCompleteUploadsQueue();
    previous.detailsLoadedAt -= 31_000;
    all[1_199] = makeFile(9_000);
    getUploadsQueue.mockClear();
    serve(all);
    const result = await getCompleteUploadsQueue({ previous });
    expect(filesFrom(result).some((f) => f.id === 'id-9000')).toBe(true);
    expect(getUploadsQueue.mock.calls.length).toBeGreaterThan(1);
  });
  it('retries a moving queue instead of returning a list with missing tracks', async () => {
    expect.hasAssertions();
    const all = Array.from({ length: 1_000 }, (_, i) => makeFile(i));
    getUploadsQueue
      .mockResolvedValueOnce(snapshot(all.slice(0, 500), 1_000))
      .mockResolvedValueOnce(snapshot(all.slice(0, 500), 1_000, 1))
      .mockResolvedValueOnce(snapshot(all.slice(0, 500), 1_000))
      .mockResolvedValueOnce(snapshot(all.slice(500), 1_000, 1))
      .mockResolvedValueOnce(snapshot(all.slice(0, 500), 1_000));
    expect(filesFrom(await getCompleteUploadsQueue())).toHaveLength(1_000);
    expect(
      getUploadsQueue.mock.calls.filter(([args]) => args.page === 1),
    ).toHaveLength(2);
  });
  it('rejects a persistently inconsistent queue rather than publishing a partial list', async () => {
    expect.hasAssertions();
    getUploadsQueue.mockResolvedValue(
      snapshot(
        Array.from({ length: 500 }, (_, i) => makeFile(i)),
        1_000,
      ),
    );
    await expect(getCompleteUploadsQueue()).rejects.toThrow(
      'Upload queue changed while loading the complete list',
    );
  });
  it('aborts remaining transport work when the recipient changes', async () => {
    expect.hasAssertions();
    const controller = new AbortController();
    let pendingSignal;
    let onStarted;
    const started = new Promise((resolve) => {
      onStarted = resolve;
    });
    getUploadsQueue
      .mockResolvedValueOnce(
        snapshot(
          Array.from({ length: 500 }, (_, i) => makeFile(i)),
          1_000,
        ),
      )
      .mockImplementationOnce(({ signal }) => {
        pendingSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('Cancelled')),
            { once: true },
          );
          onStarted();
        });
      });
    const result = getCompleteUploadsQueue({ signal: controller.signal });
    await started;
    controller.abort();
    await expect(result).rejects.toThrow('Cancelled');
    expect(pendingSignal.aborted).toBe(true);
  });
  it('does not combine another recipient into the selected user list', async () => {
    expect.hasAssertions();
    getUploadsQueue
      .mockResolvedValueOnce(
        snapshot(
          Array.from({ length: 500 }, (_, i) => makeFile(i)),
          1_000,
        ),
      )
      .mockResolvedValueOnce({ ...snapshot([], 1_000, 1), username: 'other' });
    await expect(getCompleteUploadsQueue()).rejects.toThrow(
      'Unexpected upload recipient',
    );
  });
});
