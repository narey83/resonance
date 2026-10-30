import { connectionStatus } from './connectionStatus';

describe('Soulseek connection phase', () => {
  it('keeps scan percentage in the share indicator only', () => {
    expect(connectionStatus({}, { scanning: true, scanProgress: 0.3 })).toEqual(
      { busy: true, label: 'Waiting for shares' },
    );
  });
  it('waits for a pending share scan', () => {
    expect(connectionStatus({}, { scanPending: true })).toEqual({
      busy: true,
      label: 'Waiting for shares',
    });
  });
  it('shows preparation errors instead of an endless busy indicator', () => {
    expect(connectionStatus({}, { faulted: true })).toMatchObject({
      busy: false,
      label: 'Share preparation failed',
    });
  });
  it('distinguishes connection, login, and a deliberately offline client', () => {
    expect(connectionStatus({ isConnecting: true })).toMatchObject({
      busy: true,
      label: 'Connecting to Soulseek…',
    });
    expect(connectionStatus({ isLoggingIn: true })).toMatchObject({
      busy: true,
      label: 'Logging in to Soulseek…',
    });
    expect(connectionStatus({})).toMatchObject({
      busy: false,
      label: 'Offline',
    });
    expect(connectionStatus({ isLoggedIn: true })).toMatchObject({
      busy: false,
      label: null,
    });
  });
});
