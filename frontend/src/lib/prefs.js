import api from './api';

// In-memory cache of all preferences. null = not yet loaded from server.
let cache = null;

// Accumulated writes waiting to be flushed to the server.
let pending = {};
let flushTimer = null;

const flush = () => {
  const patch = { ...pending };
  pending = {};
  api.patch('/preferences', patch).catch(() => {});
};

const schedulFlush = () => {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 600);
};

// Load all preferences from the server and populate the in-memory cache.
// Syncs server values back to localStorage so any component that still reads
// localStorage directly picks up the correct value on the next page load.
export const load = async () => {
  try {
    const { data } = await api.get('/preferences');
    cache = data ?? {};
    for (const [key, value] of Object.entries(cache)) {
      try {
        localStorage.setItem(
          key,
          typeof value === 'string' ? value : JSON.stringify(value),
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    cache = {};
  }

  return cache;
};

// Read a preference.  Falls back to localStorage then `defaultValue` until
// the server load completes.
export const get = (key, defaultValue = null) => {
  if (cache !== null && Object.prototype.hasOwnProperty.call(cache, key)) {
    return cache[key];
  }

  const raw = localStorage.getItem(key);
  if (raw !== null) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return defaultValue;
};

// Write a preference: updates the cache, localStorage, and schedules a
// debounced PATCH to the server.
export const set = (key, value) => {
  if (cache === null) cache = {};
  cache[key] = value;
  try {
    localStorage.setItem(
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  } catch {
    /* ignore */
  }

  pending[key] = value;
  schedulFlush();
};
