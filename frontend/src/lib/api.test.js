import api from './api';
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
