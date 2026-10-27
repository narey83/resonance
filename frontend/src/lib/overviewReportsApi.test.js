import api from './api';
import * as reports from './reports';

jest.mock('./api', () => ({ get: jest.fn() }));
describe('Overview request cancellation', () => {
  it('forwards the abort signal without adding it to report query parameters', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: {} });
    const signal = new AbortController().signal;
    for (const name of [
      'getSummary',
      'getHistogram',
      'getLeaderboard',
      'getDirectories',
      'getTopFiles',
      'getExceptionsPareto',
      'getHeatmap',
      'getGeography',
      'getRetryFunnel',
      'getQueueWait',
      'getPeerRetention',
      'getSocialActivity',
      'getCoverage',
    ]) {
      await reports[name]({
        direction: 'upload',
        start: 'start',
        end: 'end',
        signal,
      });
      const [url, config] = api.get.mock.calls.at(-1);
      expect(config.signal).toBe(signal);
      expect(url).not.toContain('signal=');
    }
  });
});
