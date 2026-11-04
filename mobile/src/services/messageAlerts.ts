import { getSessionScope, sessionGuard } from '../lib/sessionScope';

type MessageKind = 'pm' | 'room';
type AlertData = Record<string, unknown>;

let notificationsModule: typeof import('expo-notifications') | undefined;

export async function getNotificationsModule() {
  if (notificationsModule) return notificationsModule;
  try {
    const { requireOptionalNativeModule } = await import('expo');
    if (!requireOptionalNativeModule('ExpoNotificationScheduler')) return undefined;
    notificationsModule = await import('expo-notifications');
    return notificationsModule;
  } catch {
    return undefined;
  }
}

const threadKey = (kind: MessageKind, name: string) => {
  const account = getSessionScope();
  return account ? JSON.stringify([account, kind, name]) : undefined;
};

export function messageAlertData(kind: MessageKind, name: string): AlertData | undefined {
  const thread = threadKey(kind, name);
  return thread ? { resonanceMessageThread: thread, receivedAt: Date.now() } : undefined;
}

// A foreground alert can reach the native handler after its thread was read.
const readThroughByThread = new Map<string, number>();

export function wasMessageAlertRead(data: AlertData | null | undefined) {
  const { resonanceMessageThread: thread, receivedAt } = data ?? {};
  return typeof thread === 'string' && typeof receivedAt === 'number' &&
    receivedAt <= (readThroughByThread.get(thread) ?? -1);
}

export async function dismissMessageAlerts(kind: MessageKind, name: string, readThrough = Date.now()) {
  const thread = threadKey(kind, name);
  if (!thread) return;
  const current = sessionGuard();
  const cutoff = Math.max(readThrough, readThroughByThread.get(thread) ?? -1);
  readThroughByThread.delete(thread);
  readThroughByThread.set(thread, cutoff);
  if (readThroughByThread.size > 128) {
    const oldest = readThroughByThread.keys().next();
    if (!oldest.done) readThroughByThread.delete(oldest.value);
  }

  try {
    const notifications = await getNotificationsModule();
    if (!notifications || !current()) return;
    const presented = await notifications.getPresentedNotificationsAsync();
    if (!current()) return;
    await Promise.allSettled(presented
      .filter(({ request: { content: { data } } }) =>
        data?.resonanceMessageThread === thread &&
        typeof data.receivedAt === 'number' && data.receivedAt <= cutoff)
      .map(({ request }) => notifications.dismissNotificationAsync(request.identifier)));
  } catch {
    // The OS tray is best effort and must not undo a successful read.
  }
}
