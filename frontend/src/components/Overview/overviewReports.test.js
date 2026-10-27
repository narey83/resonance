import * as reports from '../../lib/reports';
import { loadOverviewReports, overviewTasks } from './overviewReports';

jest.mock('../../lib/reports', () => ({
  getSummary: jest.fn(),
  getHistogram: jest.fn(),
  getSocialActivity: jest.fn(),
  getExceptionsPareto: jest.fn(),
  getRetryFunnel: jest.fn(),
  getQueueWait: jest.fn(),
  getLeaderboard: jest.fn(),
  getDirectories: jest.fn(),
  getTopFiles: jest.fn(),
  getGeography: jest.fn(),
  getPeerRetention: jest.fn(),
}));
const window = {
  start: '2026-10-26T00:00:00Z',
  end: '2026-10-27T00:00:00Z',
  interval: 15,
};
const deferred = () => {
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: finish };
};

const keys = (direction, section) =>
  overviewTasks({ ...window, direction, section }).map((task) => task.key);

describe('Overview report loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of Object.values(reports).filter(jest.isMockFunction))
      method.mockResolvedValue({});
  });
  it('loads only the selected directional glance and its comparison', async () => {
    expect.hasAssertions();
    const signal = new AbortController().signal;
    const tasks = overviewTasks({
      ...window,
      direction: 'download',
      section: 'glance',
    });
    expect(tasks.map((task) => task.key)).toEqual(['summary', 'prevSummary']);
    await loadOverviewReports(tasks, { signal, onResult: jest.fn() });
    expect(reports.getSummary).toHaveBeenCalledTimes(2);
    expect(
      reports.getSummary.mock.calls.every(
        ([options]) => options.includeTimings === false,
      ),
    ).toBe(true);
    expect(reports.getSummary).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'download', signal }),
    );
    expect(reports.getHistogram).not.toHaveBeenCalled();
    expect(reports.getGeography).not.toHaveBeenCalled();
  });
  it('keeps upload-only reports out of Downloads and shared peers out of upload geography', () => {
    expect.hasAssertions();

    expect(keys('download', 'top')).toEqual(['leaderboard']);
    expect(keys('upload', 'top')).toEqual([
      'leaderboard',
      'directories',
      'topFiles',
    ]);
    expect(keys('download', 'reliability')).toEqual([
      'summary',
      'exceptions',
      'retries',
    ]);
    expect(keys('upload', 'reliability')).toEqual([
      'summary',
      'exceptions',
      'queueWait',
    ]);
    expect(keys('upload', 'geography')).toEqual(['geography']);
    expect(keys(null, 'glance')).toContain('peers');
  });
  it('publishes a fast result while another report is still pending', async () => {
    expect.hasAssertions();
    const slow = deferred();
    const onResult = jest.fn();
    const loading = loadOverviewReports(
      [
        { key: 'slow', load: () => slow.promise },
        { key: 'fast', load: () => Promise.resolve('ready') },
      ],
      { signal: new AbortController().signal, onResult },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onResult).toHaveBeenCalledWith('fast', 'ready');
    expect(onResult).not.toHaveBeenCalledWith('slow', expect.anything());
    slow.resolve('later');
    await loading;
    expect(onResult).toHaveBeenCalledWith('slow', 'later');
  });
  it('does not start queued reports or publish old results after a range is cancelled', async () => {
    expect.hasAssertions();
    const controller = new AbortController();
    const first = deferred();
    const queued = jest.fn();
    const onResult = jest.fn();
    const loading = loadOverviewReports(
      [
        { key: 'first', load: () => first.promise },
        { key: 'queued', load: queued },
      ],
      { signal: controller.signal, concurrency: 1, onResult },
    );
    controller.abort();
    first.resolve('obsolete');
    await loading;
    expect(queued).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
  it('retains successful results when a different report fails', async () => {
    expect.hasAssertions();
    const onError = jest.fn();
    const onResult = jest.fn();
    await loadOverviewReports(
      [
        { key: 'broken', load: () => Promise.reject(new Error('unavailable')) },
        { key: 'good', load: () => Promise.resolve(42) },
      ],
      { signal: new AbortController().signal, onResult, onError },
    );
    expect(onResult).toHaveBeenCalledWith('good', 42);
    expect(onError).toHaveBeenCalledWith('broken', expect.any(Error));
  });
});
