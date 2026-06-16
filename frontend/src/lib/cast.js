import api from './api';

// Created once; subsequent calls reuse the same Promise (result is cached inside it).
let streamOriginPromise = null;

// Returns the HTTP origin cast devices should use to fetch media streams.
// The backend exposes its direct HTTP port to avoid TLS certificate issues
// when a reverse proxy uses a local/self-signed cert.
const getStreamOrigin = () => {
  if (!streamOriginPromise) {
    streamOriginPromise = (async () => {
      try {
        const response = await api.get('/cast/stream-origin');
        return response.data.origin;
      } catch {
        return window.location.origin;
      }
    })();
  }

  return streamOriginPromise;
};

export const getAbsoluteStreamUrl = async (streamPath) => {
  const origin = await getStreamOrigin();
  return origin + streamPath;
};
