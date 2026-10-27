export const connectionStatus = (server, shares, startup) => {
  if (server?.isLoggedIn) return { busy: false, label: null };
  const shareStartup = startup?.services?.find(
    (service) => service.id === 'shares',
  );
  if (shares?.faulted || shareStartup?.state === 'failed')
    return {
      busy: false,
      label: 'Share preparation failed',
      detail: shareStartup?.message,
    };
  if (shares?.scanning || shares?.scanPending) {
    return { busy: true, label: 'Waiting for shares' };
  }

  if (shareStartup?.state === 'starting')
    return {
      busy: true,
      label: 'Preparing shares…',
      detail: shareStartup.message,
    };
  if (server?.isLoggingIn)
    return { busy: true, label: 'Logging in to Soulseek…' };
  if (server?.isConnecting || server?.isTransitioning)
    return { busy: true, label: 'Connecting to Soulseek…' };
  if (
    startup?.services?.some(
      (service) => service.id === 'core' && service.state === 'starting',
    )
  )
    return { busy: true, label: 'Starting services…' };
  return { busy: false, label: 'Offline' };
};
