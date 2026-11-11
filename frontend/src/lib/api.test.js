import api, { attemptRefresh } from './api';
import { check, login } from './session';
import axios, { AxiosError } from 'axios';

const response = (config, data, status = 200) => ({
  config,
  data: JSON.stringify(data),
  headers: { 'content-type': 'application/json' },
  status,
  statusText: String(status),
});

const unauthorized = (config) =>
  Promise.reject(
    new AxiosError(
      'Unauthorized',
      AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response(config, {}, 401),
    ),
  );

describe('HTTP client compatibility', () => {
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('resonance-token', 'initial-token');
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    jest.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('preserves authenticated JSON requests and response decoding', async () => {
    expect.hasAssertions();
    const adapter = jest.fn(async (config) => {
      expect(config.headers.get('Authorization')).toBe('Bearer initial-token');
      expect(config.headers.get('Content-Type')).toBe('application/json');
      expect(config.withCredentials).toBe(true);
      expect(JSON.parse(config.data)).toEqual({ searchText: 'music' });
      return response(config, { id: 'search-id' });
    });
    api.defaults.adapter = adapter;
    const result = await api.post('/searches', { searchText: 'music' });
    expect(result.data).toEqual({ id: 'search-id' });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('shares one token refresh across concurrent unauthorized requests', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-refresh-token', 'refresh-token');
    const refresh = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { token: 'renewed-token', refreshToken: 'next-refresh' },
    });
    const adapter = jest
      .fn(async (config) => {
        expect(config.headers.get('Authorization')).toBe(
          'Bearer renewed-token',
        );
        return response(config, { ready: true });
      })
      .mockImplementationOnce(unauthorized)
      .mockImplementationOnce(unauthorized);
    api.defaults.adapter = adapter;
    const results = await Promise.all([
      api.get('/rooms'),
      api.get('/searches'),
    ]);
    expect(results.map((result) => result.data)).toEqual([
      { ready: true },
      { ready: true },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('session/refresh', {
      refreshToken: 'refresh-token',
    });
    expect(sessionStorage.getItem('resonance-refresh-token')).toBe(
      'next-refresh',
    );
  });

  it('does not overwrite a newer sign-in with a late refresh response', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-refresh-token', 'old-refresh');
    let finishRefresh;
    jest.spyOn(axios, 'post').mockReturnValue(
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
    );
    const pending = attemptRefresh();
    sessionStorage.setItem('resonance-token', 'new-access');
    sessionStorage.setItem('resonance-refresh-token', 'new-refresh');
    finishRefresh({
      data: { token: 'late-access', refreshToken: 'late-refresh' },
    });
    await pending;
    expect(sessionStorage.getItem('resonance-token')).toBe('new-access');
    expect(sessionStorage.getItem('resonance-refresh-token')).toBe(
      'new-refresh',
    );
  });

  it('removes only the rejected session after a late refresh rejection', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-refresh-token', 'old-refresh');
    localStorage.setItem('resonance-token', 'new-access');
    localStorage.setItem('resonance-refresh-token', 'new-refresh');
    jest.spyOn(axios, 'post').mockRejectedValue({ response: { status: 401 } });
    await expect(attemptRefresh()).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(sessionStorage.getItem('resonance-token')).toBeNull();
    expect(sessionStorage.getItem('resonance-refresh-token')).toBeNull();
    expect(localStorage.getItem('resonance-token')).toBe('new-access');
    expect(localStorage.getItem('resonance-refresh-token')).toBe('new-refresh');
  });

  it('does not submit a rejected refresh token again after clearing it', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-refresh-token', 'invalid-refresh');
    const refresh = jest.spyOn(axios, 'post').mockRejectedValue({
      response: { status: 401 },
    });
    await expect(attemptRefresh()).rejects.toMatchObject({
      response: { status: 401 },
    });
    await attemptRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('resonance-refresh-token')).toBeNull();
  });

  it('can refresh after an earlier call had no saved token', async () => {
    expect.hasAssertions();
    const refresh = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { token: 'new-access', refreshToken: 'rotated-refresh' },
    });
    await attemptRefresh();
    sessionStorage.setItem('resonance-refresh-token', 'valid-refresh');
    await attemptRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('resonance-token')).toBe('new-access');
  });

  it('retries an old 401 with an access token another request already refreshed', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-session-id', 'same-session');
    const refresh = jest.spyOn(axios, 'post');
    const adapter = jest
      .fn(async (config) => {
        expect(config.headers.get('Authorization')).toBe('Bearer new-access');
        return response(config, { ready: true });
      })
      .mockImplementationOnce((config) => {
        sessionStorage.setItem('resonance-token', 'new-access');
        return unauthorized(config);
      });
    api.defaults.adapter = adapter;
    await expect(api.get('/rooms')).resolves.toMatchObject({
      data: { ready: true },
    });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('never replays an old request under a different sign-in', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-session-id', 'old-session');
    sessionStorage.setItem('resonance-refresh-token', 'old-refresh');
    const refresh = jest.spyOn(axios, 'post');
    const adapter = jest.fn((config) => {
      sessionStorage.setItem('resonance-token', 'new-access');
      sessionStorage.setItem('resonance-refresh-token', 'new-refresh');
      sessionStorage.setItem('resonance-session-id', 'new-session');
      return unauthorized(config);
    });
    api.defaults.adapter = adapter;
    await expect(
      api.post('/rooms', { message: 'old action' }),
    ).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('resonance-token')).toBe('new-access');
    expect(sessionStorage.getItem('resonance-refresh-token')).toBe(
      'new-refresh',
    );
  });

  it('keeps a newer sign-in when an older startup check is rejected', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-session-id', 'old-session');
    const adapter = jest.fn((config) => {
      sessionStorage.setItem('resonance-token', 'new-access');
      sessionStorage.setItem('resonance-session-id', 'new-session');
      return unauthorized(config);
    });
    api.defaults.adapter = adapter;
    await expect(check()).resolves.toBe(true);
    expect(sessionStorage.getItem('resonance-token')).toBe('new-access');
    expect(sessionStorage.getItem('resonance-session-id')).toBe('new-session');
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a saved session after a failed login', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-refresh-token', 'old-refresh');
    const refresh = jest.spyOn(axios, 'post');
    const adapter = jest.fn(async (config) => {
      expect(config.headers.get('Authorization')).toBeUndefined();
      return unauthorized(config);
    });
    api.defaults.adapter = adapter;
    await expect(
      api.post('/session', { username: 'alice', password: 'wrong' }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(refresh).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('resonance-refresh-token')).toBe(
      'old-refresh',
    );
  });

  it('replaces old session storage when a new login uses remember me', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-refresh-token', 'old-refresh');
    localStorage.setItem('resonance_browser_id', 'browser-id');
    const adapter = jest.fn(async (config) =>
      response(config, {
        token: 'new-access',
        refreshToken: 'new-refresh',
        sessionId: 'new-session',
      }),
    );
    api.defaults.adapter = adapter;
    await login({ username: 'alice', password: 'correct', rememberMe: true });
    expect(sessionStorage.getItem('resonance-token')).toBeNull();
    expect(sessionStorage.getItem('resonance-refresh-token')).toBeNull();
    expect(localStorage.getItem('resonance-token')).toBe('new-access');
    expect(localStorage.getItem('resonance-refresh-token')).toBe('new-refresh');
  });

  it('propagates forbidden responses without refreshing or retrying', async () => {
    expect.hasAssertions();
    const refresh = jest.spyOn(axios, 'post');
    const adapter = jest.fn(async (config) => {
      throw new AxiosError(
        'Forbidden',
        AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        response(config, {}, 403),
      );
    });
    api.defaults.adapter = adapter;
    await expect(api.get('/rooms')).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('cancels an aborted request before contacting the adapter', async () => {
    expect.hasAssertions();
    const controller = new AbortController();
    controller.abort();
    const adapter = jest.fn();
    api.defaults.adapter = adapter;
    await expect(
      api.get('/rooms', { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
    expect(adapter).not.toHaveBeenCalled();
  });
});
