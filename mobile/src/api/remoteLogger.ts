import type { HubConnection } from '@microsoft/signalr';
import { apiClient } from './client';
import { getDeviceName } from '../store/auth';
import { useAppSettings } from '../store/appSettingsStore';

type LogLevel = 'info' | 'warn' | 'error';

interface QueuedEntry {
  level: LogLevel;
  message: string;
}

let logContext = 'Mobile';
let queue: QueuedEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let intercepting = false;

// Capture originals before any interception so the flush path never loops back through our wrappers.
const originalConsole = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
};

const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE    = 100;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
}

function enqueue(level: LogLevel, message: string) {
  if (!useAppSettings.getState().remoteLogging) return;
  if (queue.length >= MAX_QUEUE_SIZE) queue.shift();
  queue.push({ level, message });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

async function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const entries = queue.splice(0, queue.length);
  try {
    await Promise.all(
      entries.map((e) =>
        apiClient.post('/logs', { level: e.level, message: e.message, context: logContext }),
      ),
    );
  } catch {
    // Fire-and-forget: drop on network error to avoid feedback loops.
  }
}

// Direct enqueue — use this for infrastructure/connection events that are
// too important to lose through the console-intercept path.
export function remoteLog(level: LogLevel, message: string) {
  enqueue(level, message);
}

// Attaches close/reconnecting/reconnected lifecycle logs to any hub connection.
export function attachHubLogging(hub: HubConnection, name: string) {
  hub.onclose((err) => {
    remoteLog('warn', `[hub:${name}] closed${err ? ` — ${err.message}` : ''}`);
  });
  hub.onreconnecting((err) => {
    remoteLog('warn', `[hub:${name}] reconnecting${err ? ` — ${err.message}` : ''}`);
  });
  hub.onreconnected((connectionId) => {
    remoteLog('info', `[hub:${name}] reconnected (id=${connectionId ?? 'unknown'})`);
  });
}

export async function enableRemoteLogging() {
  logContext = `Mobile / ${await getDeviceName()}`;
  if (intercepting) return;
  intercepting = true;

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    enqueue('info', formatArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    enqueue('warn', formatArgs(args));
  };
  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    enqueue('error', formatArgs(args));
  };
}

export function disableRemoteLogging() {
  if (!intercepting) return;
  intercepting = false;
  console.log   = originalConsole.log;
  console.warn  = originalConsole.warn;
  console.error = originalConsole.error;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  queue = [];
}
