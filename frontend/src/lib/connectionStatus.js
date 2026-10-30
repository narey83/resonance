export const connectionStatus = (server, shares) => {
  if (server?.isLoggedIn) return { busy: false, label: null };
  if (shares?.faulted)
    return { busy: false, label: 'Share preparation failed' };
  if (shares?.scanning || shares?.scanPending) {
    return { busy: true, label: 'Waiting for shares' };
  }

  if (server?.isLoggingIn)
    return { busy: true, label: 'Logging in to Soulseek…' };
  if (server?.isConnecting || server?.isTransitioning)
    return { busy: true, label: 'Connecting to Soulseek…' };
  return { busy: false, label: 'Offline' };
};
