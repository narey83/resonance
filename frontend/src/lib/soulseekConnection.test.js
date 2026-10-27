import { connectionTestError, waitForConnection } from './soulseekConnection';

jest.mock('./server', () => ({ getState: jest.fn() }));

describe('Soulseek connection test', () => {
  it('reports a rejected login immediately rather than waiting for a timeout', async () => {
    expect.hasAssertions();
    const pause = jest.fn();
    await expect(
      waitForConnection({
        readState: async () => ({ lastConnectionErrorCode: 'LOGIN_REJECTED' }),
        pause,
      }),
    ).rejects.toThrow('Soulseek rejected the username or password');
    expect(pause).not.toHaveBeenCalled();
  });

  it('waits for login, not just the TCP connection', async () => {
    expect.hasAssertions();
    const readState = jest
      .fn()
      .mockResolvedValueOnce({ isConnected: true, isLoggedIn: false })
      .mockResolvedValueOnce({ isConnected: true, isLoggedIn: true });
    await waitForConnection({ readState, pause: async () => {} });
    expect(readState).toHaveBeenCalledTimes(2);
  });

  it.each(['NETWORK_ERROR', 'TIMEOUT', 'CONNECTION_FAILED'])(
    'explains %s without exposing exception text',
    async (code) => {
      expect.hasAssertions();
      await expect(
        waitForConnection({
          readState: async () => ({ lastConnectionErrorCode: code }),
        }),
      ).rejects.toThrow(/Soulseek/);
    },
  );

  it('distinguishes a real timeout from rejected credentials', async () => {
    expect.hasAssertions();
    await expect(
      waitForConnection({ readState: async () => ({}), timeout: 0 }),
    ).rejects.toThrow('No credential rejection was reported');
  });

  it('explains a backend outage', async () => {
    expect.hasAssertions();
    await expect(
      waitForConnection({
        readState: async () => {
          throw Object.assign(new Error('Network Error'), {
            isAxiosError: true,
          });
        },
      }),
    ).rejects.toThrow('Could not reach the Resonance server');
  });

  it.each([
    [401, 'session has expired'],
    [403, 'not allowed'],
    [500, 'encountered an error'],
  ])('explains HTTP %s', (status, message) => {
    expect(connectionTestError({ response: { status } })).toContain(message);
  });
});
