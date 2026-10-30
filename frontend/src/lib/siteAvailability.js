import { rootUrl } from '../config';

const unavailableStates = new Set([
  'maintenance',
  'restarting',
  'starting',
  'unavailable',
  'frontend-unavailable',
]);
const header = (response, name) =>
  response?.headers?.get?.(name) ?? response?.headers?.[name.toLowerCase()];

// Caddy decides availability. An already-open app simply hands its current URL
// back to Caddy on a classified 503; auth storage and the route are retained.
export const createSiteAvailability = ({
  reload = () => window.location.reload(),
  request = (...args) => fetch(...args),
} = {}) => {
  let handingOff = false;
  let pending = null;
  const handleResponse = (response) => {
    if (
      response?.status !== 503 ||
      header(response, 'X-Resonance-Gateway') !== 'caddy' ||
      !unavailableStates.has(header(response, 'X-Resonance-Site-State'))
    )
      return false;
    if (!handingOff) {
      handingOff = true;
      reload();
    }

    return true;
  };

  const check = () => {
    if (handingOff) return Promise.resolve(true);
    if (pending) return pending;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    pending = Promise.resolve()
      .then(() =>
        request(`${rootUrl}/__site/status`, {
          cache: 'no-store',
          signal: controller.signal,
        }),
      )
      .then(handleResponse)
      .catch(() => false)
      .finally(() => {
        clearTimeout(timeout);
        pending = null;
      });
    return pending;
  };

  return { handleResponse, check };
};

export const siteAvailability = createSiteAvailability();
