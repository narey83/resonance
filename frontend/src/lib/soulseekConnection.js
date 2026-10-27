import { getState } from './server';

const failures = {
  LOGIN_REJECTED:
    'Soulseek rejected the username or password. Use your Soulseek credentials, which are separate from your Resonance login. If you are creating an account, the username may already be taken.',
  TIMEOUT:
    'Soulseek did not complete the connection or login in time. The server may be busy. Wait a moment and try again.',
  NETWORK_ERROR:
    'The Resonance server could not reach Soulseek. Check the server’s internet connection, DNS, firewall and VPN settings, then try again.',
  CONNECTION_FAILED:
    'The Resonance server could not complete the Soulseek connection. Check the server logs for the cause, then try again.',
};

export const connectionTestError = (error) => {
  const status = error?.response?.status;
  if (status === 401) {
    return 'Your Resonance session has expired. Sign in again, then retry the Soulseek connection test.';
  }

  if (status === 403) {
    return 'This Resonance account is not allowed to change or test the Soulseek connection.';
  }

  if (status >= 500) {
    return 'The Resonance server encountered an error while testing the Soulseek connection. Check its logs and try again.';
  }

  if (error?.isAxiosError || error?.code === 'ERR_NETWORK') {
    return 'Could not reach the Resonance server. Check that it is running and your connection to it is working.';
  }

  return (
    error?.message || 'The Soulseek connection test failed. Please try again.'
  );
};

export const waitForConnection = async ({
  readState = getState,
  pause = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 1_000);
    }),
  now = Date.now,
  timeout = 20_000,
} = {}) => {
  const deadline = now() + timeout;
  while (true) {
    let state;
    try {
      state = await readState();
    } catch (error) {
      throw new Error(connectionTestError(error));
    }

    // A TCP connection alone does not mean Soulseek accepted the login.
    if (state.isLoggedIn && !state.isTransitioning) {
      return;
    }

    if (state.lastConnectionErrorCode) {
      throw new Error(
        failures[state.lastConnectionErrorCode] || failures.CONNECTION_FAILED,
      );
    }

    if (now() >= deadline) {
      throw new Error(
        state.isConnected
          ? 'Connected to Soulseek, but login has not completed after 20 seconds. The server may be busy; wait a moment and try again.'
          : 'No Soulseek connection was confirmed after 20 seconds. Check the server’s internet connection, firewall and VPN settings. No credential rejection was reported.',
      );
    }

    await pause();
  }
};
