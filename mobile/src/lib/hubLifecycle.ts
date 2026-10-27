import { LogLevel, type HubConnection, type ILogger } from '@microsoft/signalr';
import { onSessionReset, sessionGuard } from './sessionScope';

// A connection belongs to the mounted screen/login that created it. SignalR logs a
// cancelled start as an error even when stop() was intentional; close that logging
// scope before stopping, while preserving errors from connections still in use.
export function createHubLogger(name: string) {
  const current = sessionGuard();
  let disposed = false;
  return {
    dispose() { disposed = true; },
    log(level: LogLevel, message: string) {
      if (disposed || !current() || level < LogLevel.Information) return;
      const detail = `[connection:${name}] ${message}`;
      if (level >= LogLevel.Error) console.error(detail);
      else if (level === LogLevel.Warning) console.warn(detail);
      else console.info(detail);
    },
  } satisfies ILogger & { dispose: () => void };
}

const connections = new WeakMap<HubConnection, { logger: ReturnType<typeof createHubLogger>; unsubscribe: () => void }>();

export function trackHubConnection(hub: HubConnection, logger: ReturnType<typeof createHubLogger>): HubConnection {
  const unsubscribe = onSessionReset(() => { void stopHubConnection(hub); });
  connections.set(hub, { logger, unsubscribe });
  return hub;
}

export async function stopHubConnection(hub: HubConnection): Promise<void> {
  const scope = connections.get(hub);
  scope?.logger.dispose();
  scope?.unsubscribe();
  connections.delete(hub);
  await hub.stop().catch(() => {});
}
