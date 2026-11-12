import { requireLocalBridge } from './bridgePresence';

jest.mock('../config', () => ({ urlBase: '' }));

describe('Bridge browser presence', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('accepts a running Bridge paired with this browser instance', async () => {
    expect.hasAssertions();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          application: 'resonance-bridge',
          paired: true,
          instance: window.location.origin,
        }),
      });
    await expect(requireLocalBridge()).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:55460/api/browser-presence',
      expect.objectContaining({
        mode: 'cors',
        credentials: 'omit',
        targetAddressSpace: 'loopback',
      }),
    );
  });

  it('stops before a handoff when Bridge cannot be reached', async () => {
    expect.hasAssertions();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation()
      .mockRejectedValue(new TypeError('connection refused'));
    await expect(requireLocalBridge()).rejects.toThrow(
      'Bridge could not be reached on this computer',
    );
  });

  it('rejects a Bridge paired with another Resonance instance', async () => {
    expect.hasAssertions();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          application: 'resonance-bridge',
          paired: true,
          instance: 'https://other.example/music',
        }),
      });
    await expect(requireLocalBridge()).rejects.toThrow(
      'paired with a different Resonance instance',
    );
  });
});
