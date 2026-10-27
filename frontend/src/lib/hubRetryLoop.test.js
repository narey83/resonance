import { createHubRetryLoop } from './hubRetryLoop';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('hub retry loop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('backs off repeated closes after successful handshakes without flashing online', async () => {
    expect.hasAssertions();
    const start = jest.fn(async () => {});
    const onRetry = jest.fn();
    const onOnline = jest.fn();
    const loop = createHubRetryLoop({ start, onRetry, onOnline });
    await loop.start();
    loop.closed();
    expect(start).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(999);
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(start).toHaveBeenCalledTimes(2);
    loop.closed();
    jest.advanceTimersByTime(1_999);
    await flush();
    expect(start).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    await flush();
    expect(start).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    expect(onOnline).not.toHaveBeenCalled();
    loop.dispose();
  });

  it('keeps retrying initial failures and cancels late starts after disposal', async () => {
    expect.hasAssertions();
    const onRetry = jest.fn();
    const onOnline = jest.fn();
    const start = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const loop = createHubRetryLoop({ start, onRetry, onOnline });
    await loop.start();
    expect(onRetry).toHaveBeenCalledWith(1);
    jest.advanceTimersByTime(1_000);
    await flush();
    loop.dispose();
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(onOnline).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('shows online after a stable connection and manual retry skips the backoff', async () => {
    expect.hasAssertions();
    const start = jest.fn(async () => {});
    const onOnline = jest.fn();
    const loop = createHubRetryLoop({ start, onOnline, onRetry: jest.fn() });
    await loop.start();
    jest.advanceTimersByTime(1_000);
    expect(onOnline).toHaveBeenCalledTimes(1);
    loop.closed();
    await loop.retryNow();
    expect(start).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1_000);
    expect(onOnline).toHaveBeenCalledTimes(2);
    loop.dispose();
  });
  it('ignores a handshake that completes after disposal', async () => {
    expect.hasAssertions();
    let finish;
    const start = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const onOnline = jest.fn();
    const loop = createHubRetryLoop({ start, onOnline, onRetry: jest.fn() });
    const pending = loop.start();
    loop.dispose();
    finish();
    await pending;
    jest.advanceTimersByTime(60_000);
    expect(onOnline).not.toHaveBeenCalled();
  });
});
