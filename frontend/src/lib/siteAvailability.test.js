import { createSiteAvailability } from './siteAvailability';

const unavailable = (state, gateway = 'caddy') => ({
  status: 503,
  headers: {
    'x-resonance-gateway': gateway,
    'x-resonance-site-state': state,
  },
});

describe('Caddy availability handoff', () => {
  it.each([
    'maintenance',
    'restarting',
    'starting',
    'unavailable',
    'frontend-unavailable',
  ])('hands the existing route back to Caddy once for %s', (state) => {
    expect.hasAssertions();
    const reload = jest.fn();
    const handler = createSiteAvailability({ reload });
    expect(handler.handleResponse(unavailable(state))).toBe(true);
    handler.handleResponse(unavailable(state));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('keeps normal API errors, auth failures and local network errors in the app', async () => {
    expect.hasAssertions();
    const reload = jest.fn();
    const handler = createSiteAvailability({
      reload,
      request: async () => {
        throw new Error('offline');
      },
    });
    expect(handler.handleResponse({ status: 401 })).toBe(false);
    expect(handler.handleResponse({ status: 503 })).toBe(false);
    expect(handler.handleResponse(unavailable('unknown'))).toBe(false);
    expect(
      handler.handleResponse(unavailable('maintenance', 'unrelated-proxy')),
    ).toBe(false);
    await expect(handler.check()).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('coalesces hub failures and follows native fetch headers without reading backend diagnostics', async () => {
    expect.hasAssertions();
    const reload = jest.fn();
    const request = jest.fn(async () => ({
      status: 503,
      headers: {
        get: (name) =>
          ({
            'X-Resonance-Gateway': 'caddy',
            'X-Resonance-Site-State': 'restarting',
          })[name],
      },
    }));
    const handler = createSiteAvailability({ reload, request });
    await Promise.all([handler.check(), handler.check()]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('does not reload a healthy site', async () => {
    expect.hasAssertions();
    const reload = jest.fn();
    const handler = createSiteAvailability({
      reload,
      request: async () => ({ status: 200 }),
    });
    await expect(handler.check()).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
