import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const actualSetImmediate = jest.requireActual('node:timers').setImmediate;
const flush = () =>
  new Promise((resolve) => {
    actualSetImmediate(resolve);
  });

const script = fs.readFileSync(
  path.resolve(__dirname, '../../../ops/caddy/status/recovery.js'),
  'utf8',
);
const response = (status, state, gateway = 'caddy', retry = '5') => ({
  status,
  headers: {
    get: (name) =>
      ({
        'X-Resonance-Gateway': gateway,
        'X-Resonance-Site-State': state,
        'Retry-After': retry,
      })[name],
  },
});
const start = (fetch, reload) => {
  vm.runInNewContext(script, {
    window: { location: { reload } },
    document,
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
  });
};

describe('independent Caddy status page recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML =
      '<p id="recovery" role="status"></p><button id="retry">Try again</button>';
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });
  it.each(['available', 'degraded'])(
    'returns to the original URL only when Caddy reports %s',
    async (state) => {
      expect.hasAssertions();
      const reload = jest.fn();
      const fetch = jest.fn().mockResolvedValue(response(200, state));
      start(fetch, reload);
      await flush();
      expect(reload).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps waiting on 503 and recovers without the React app', async () => {
    expect.hasAssertions();
    const reload = jest.fn();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(response(503, 'restarting'))
      .mockResolvedValueOnce(response(200, 'available'));
    start(fetch, reload);
    await flush();
    expect(reload).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5_000);
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it.each([response(200, 'available', 'other'), response(200, 'unknown')])(
    'does not mistake an arbitrary 200 page for readiness',
    async (value) => {
      expect.hasAssertions();
      const reload = jest.fn();
      start(jest.fn().mockResolvedValue(value), reload);
      await flush();
      expect(reload).not.toHaveBeenCalled();
    },
  );
  it('handles local network failure and keeps retrying', async () => {
    expect.hasAssertions();
    const reload = jest.fn();
    const fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(200, 'available'));
    start(fetch, reload);
    await flush();
    expect(document.querySelector('#recovery').textContent).toContain(
      'Waiting for a connection',
    );
    jest.advanceTimersByTime(5_000);
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('offers a manual retry while leaving the server in charge', async () => {
    expect.hasAssertions();
    const reload = jest.fn();
    start(jest.fn().mockResolvedValue(response(503, 'maintenance')), reload);
    await flush();
    document.querySelector('#retry').click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
