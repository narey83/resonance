jest.mock('./api', () => ({ get: jest.fn(), patch: jest.fn() }));

const key = 'resonance-notifications-unread-only';
const pendingKey = 'resonance-pending-preference:' + key;
const reload = (serverValue) => {
  jest.resetModules();
  const api = jest.requireMock('./api');
  api.get.mockResolvedValue({ data: { [key]: serverValue } });
  api.patch.mockResolvedValue({ status: 204 });
  return { api, prefs: jest.requireActual('./prefs') };
};

const settle = async () => {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
};

const flushTimers = async () => {
  jest.advanceTimersByTime(600);
  await settle();
};

describe('durable preference changes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each([true, false])(
    'keeps %s across a reload before the debounced save',
    async (value) => {
      expect.hasAssertions();
      const first = reload(!value);
      first.prefs.set(key, value);
      expect(first.api.patch).not.toHaveBeenCalled();
      jest.clearAllTimers();
      const second = reload(!value);
      await second.prefs.load();
      expect(second.prefs.get(key)).toBe(value);
      expect(JSON.parse(localStorage.getItem(key))).toBe(value);
      await flushTimers();
      expect(second.api.patch).toHaveBeenCalledWith('/preferences', {
        [key]: value,
      });
      expect(localStorage.getItem(pendingKey)).toBeNull();
    },
  );

  it('retains a failed write and retries after reloading stale server preferences', async () => {
    expect.hasAssertions();
    const first = reload(false);
    first.api.patch.mockRejectedValue(new Error('Offline'));
    first.prefs.set(key, true);
    await flushTimers();
    expect(localStorage.getItem(pendingKey)).toBe('true');
    const second = reload(false);
    await second.prefs.load();
    expect(second.prefs.get(key)).toBe(true);
    await flushTimers();
    expect(second.api.patch).toHaveBeenCalledWith('/preferences', {
      [key]: true,
    });
    expect(localStorage.getItem(pendingKey)).toBeNull();
  });

  it('serializes writes and preserves edits made while an earlier save is pending', async () => {
    expect.hasAssertions();
    const { api, prefs } = reload(false);
    let finish;
    api.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    prefs.set(key, true);
    await flushTimers();
    prefs.set(key, false);
    await flushTimers();
    expect(api.patch).toHaveBeenCalledTimes(1);
    finish({ status: 204 });
    await settle();
    expect(localStorage.getItem(pendingKey)).toBe('false');
    await flushTimers();
    expect(api.patch).toHaveBeenLastCalledWith('/preferences', {
      [key]: false,
    });
    expect(localStorage.getItem(pendingKey)).toBeNull();
  });

  it('does not erase a newer pending value written by another tab', async () => {
    expect.hasAssertions();
    const { api, prefs } = reload(false);
    let finish;
    api.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    prefs.set(key, true);
    await flushTimers();
    localStorage.setItem(pendingKey, 'false');
    finish({ status: 204 });
    await settle();
    expect(localStorage.getItem(pendingKey)).toBe('false');
    const second = reload(true);
    await second.prefs.load();
    expect(second.prefs.get(key)).toBe(false);
  });
});
