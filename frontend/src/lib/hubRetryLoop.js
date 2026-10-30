// A successful transport handshake can still be followed by a server OnConnected failure.
// Keep backoff across those brief connections, and only show online after a stable handshake.
export const createHubRetryLoop = ({ start, onOnline, onRetry }) => {
  let disposed = false;
  let starting = false;
  let attempt = 0;
  let connectedAt = null;
  let generation = 0;
  let retryTimer;
  let onlineTimer;
  const runner = {};
  const clearTimers = () => {
    clearTimeout(retryTimer);
    clearTimeout(onlineTimer);
  };

  const connected = () => {
    if (disposed) return;
    clearTimers();
    connectedAt = Date.now();
    onlineTimer = setTimeout(() => {
      if (!disposed) onOnline?.();
    }, 1_000);
  };

  const failed = () => {
    if (disposed) return;
    generation += 1;
    clearTimers();
    if (connectedAt !== null && Date.now() - connectedAt >= 10_000) attempt = 0;
    connectedAt = null;
    attempt += 1;
    onRetry(attempt);
    retryTimer = setTimeout(
      () => runner.run(),
      Math.min(2 ** Math.min(attempt, 6) * 500, 30_000),
    );
  };

  const run = async () => {
    if (disposed || starting) return;
    starting = true;
    const current = generation;
    try {
      await start();
      if (!disposed && current === generation) connected();
    } catch {
      if (!disposed && current === generation) failed();
    } finally {
      if (starting) starting = false;
    }
  };

  runner.run = run;
  return {
    start: run,
    closed: failed,
    reconnecting: () => {
      clearTimeout(onlineTimer);
      if (connectedAt !== null && Date.now() - connectedAt >= 10_000)
        attempt = 0;
      connectedAt = null;
      if (!disposed) onRetry(attempt + 1);
    },
    connected,
    pause: () => {
      generation += 1;
      clearTimers();
    },
    retryNow: () => {
      clearTimers();
      generation += 1;
      attempt = 0;
      connectedAt = null;
      return run();
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      clearTimers();
    },
  };
};
