import { apiClient } from './client';
import { remoteLog } from './remoteLogger';

// Path-scoped signatures for stream/artwork URLs. The server signs each library path with a
// secret we never see; we cache the resulting { exp, sig } and append it to media URLs instead
// of the account JWT. Signatures are valid ~24h and reused, so we only call the server for
// paths we haven't signed yet (or that are about to expire).

interface Signature {
  exp: number; // unix seconds
  sig: string;
}

const cache = new Map<string, Signature>();

// Re-sign a little before expiry so a baked player-queue URL never goes stale mid-use.
const REFRESH_SKEW_SEC = 300;

// Local (on-device) and live-Soulseek paths are not server library paths and need no signature.
const isServerLibraryPath = (path: string): boolean =>
  !!path &&
  !path.startsWith('file://') &&
  !path.startsWith('content://') &&
  !path.startsWith('soulseek://');

const needsSigning = (path: string, nowSec: number): boolean => {
  if (!isServerLibraryPath(path)) return false;
  const existing = cache.get(path);
  return !existing || existing.exp - nowSec < REFRESH_SKEW_SEC;
};

/**
 * Ensure every given server library path has a fresh signature cached. Fetches only the paths
 * that are missing or near expiry. Never throws — on failure the URLs simply stay unsigned and
 * the caller can retry.
 */
export const ensureSigned = async (paths: (string | null | undefined)[]): Promise<void> => {
  const nowSec = Math.floor(Date.now() / 1000);
  const todo = Array.from(
    new Set(paths.filter((p): p is string => !!p && needsSigning(p, nowSec))),
  );
  if (todo.length === 0) return;

  try {
    const { data } = await apiClient.post<Record<string, Signature>>('/musiclibrary/sign', { paths: todo });
    for (const [path, sig] of Object.entries(data)) {
      if (sig?.sig) cache.set(path, sig);
    }
  } catch (err: unknown) {
    remoteLog('warn', `[sign] failed to sign ${todo.length} path(s) — ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Seed the cache with signatures the server embedded in a list response (artist/album/track/
 * folder rows now carry their own { sig, exp }). This replaces the separate POST /sign round-trip
 * the list fetchers used to block on. Rows without a usable signature are skipped silently.
 */
export const seedSignatures = (
  entries: { path?: string | null; sig?: string | null; exp?: number | null }[],
): void => {
  for (const e of entries) {
    if (e.path && e.sig && typeof e.exp === 'number') {
      cache.set(e.path, { exp: e.exp, sig: e.sig });
    }
  }
};

/** Synchronous read of a cached signature, or undefined if the path isn't signed yet. */
export const getSignature = (path: string | null | undefined): Signature | undefined =>
  path ? cache.get(path) : undefined;

/** The `&exp=...&sig=...` query fragment for a path, or '' if not signed. */
export const signedQuery = (path: string): string => {
  const s = cache.get(path);
  return s ? `&exp=${s.exp}&sig=${encodeURIComponent(s.sig)}` : '';
};

/** Forget specific paths' signatures so the next ensureSigned re-fetches them (e.g. after a 401). */
export const invalidateSignatures = (paths: (string | null | undefined)[]): void => {
  for (const p of paths) {
    if (p) cache.delete(p);
  }
};

/** Drop all cached signatures (e.g. on logout / server change). */
export const clearSignatures = (): void => cache.clear();
