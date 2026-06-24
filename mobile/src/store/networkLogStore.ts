import { create } from 'zustand';

// Where a captured entry came from. 'http' = REST via apiClient; 'img' = native artwork
// load (expo-image, bypasses axios); 'stream' = audio buffering latency (track-player).
export type NetworkLogKind = 'http' | 'img' | 'stream';

// A single captured request/load. Recorded into a bounded in-memory ring buffer for the
// on-device Network Log debug screen. Never persisted — cleared on app restart.
export interface NetworkLogEntry {
  id:         number;
  kind:       NetworkLogKind;
  method:     string;        // GET, POST, … for http; 'IMG' / 'STREAM' for media loads
  url:        string;        // compact display label (request path or media basename)
  status:     number | null; // HTTP status, or null when no response was received (timeout / native error)
  ok:         boolean;
  durationMs: number;        // wall-clock latency from send to settle
  startedAt:  number;        // epoch ms when the request was sent
  error?:     string;        // axios error code / message for failures
  // Detail shown when a row is expanded:
  fullUrl?:         string;
  requestHeaders?:  Record<string, string>;
  responseHeaders?: Record<string, string>;
}

interface NetworkLogState {
  entries:   NetworkLogEntry[];
  paused:    boolean;
  record:    (entry: Omit<NetworkLogEntry, 'id'>) => void;
  clear:     () => void;
  setPaused: (paused: boolean) => void;
}

const MAX_ENTRIES = 200;
let nextId = 1;

export const useNetworkLog = create<NetworkLogState>((set) => ({
  entries: [],
  paused:  false,

  record: (entry) =>
    set((state) => {
      if (state.paused) return state;
      // Newest first so the list renders most-recent-at-top without re-sorting.
      const next = [{ ...entry, id: nextId++ }, ...state.entries];
      if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
      return { entries: next };
    }),

  clear:     () => set({ entries: [] }),
  setPaused: (paused) => set({ paused }),
}));

// Compact, readable label for a media URL/path: server media URLs carry the real file in a
// `path` / `filename` query param, so prefer that over the long signed URL.
function mediaLabel(raw: string): string {
  try {
    const q = raw.match(/[?&](?:path|filename)=([^&]+)/);
    const p = q ? decodeURIComponent(q[1]) : raw.split('?')[0];
    return p.split(/[\\/]/).pop() || p;
  } catch {
    return raw;
  }
}

/**
 * Record a non-HTTP media load (native artwork render or audio stream buffering) that bypasses
 * the axios pipeline. Call with the time the load was kicked off so latency is measured end-to-end.
 */
export function recordMediaLoad(
  kind: Exclude<NetworkLogKind, 'http'>,
  rawUrl: string,
  startedAt: number,
  ok: boolean,
  opts: { error?: string } = {},
): void {
  useNetworkLog.getState().record({
    kind,
    method:     kind === 'img' ? 'IMG' : 'STREAM',
    url:        mediaLabel(rawUrl),
    fullUrl:    rawUrl,
    status:     ok ? 200 : null,
    ok,
    durationMs: Date.now() - startedAt,
    startedAt,
    error:      opts.error,
  });
}
