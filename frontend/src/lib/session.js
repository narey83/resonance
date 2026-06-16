import { tokenPassthroughValue } from '../config';
import api from './api';
import {
  clearRefreshToken,
  clearSessionId,
  clearToken,
  getRefreshToken,
  getSessionId,
  getToken,
  setRefreshToken,
  setSessionId,
  setToken,
} from './token';

export const getInitialized = async () => {
  return (await api.get('/session/initialized')).data;
};

const getDeviceName = () => {
  const ua = navigator.userAgent;
  let os;
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Macintosh/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  else os = 'Browser';

  const key = 'resonance_browser_id';
  let browserId = localStorage.getItem(key);
  if (!browserId) {
    browserId = crypto.randomUUID();
    localStorage.setItem(key, browserId);
  }

  return `${os} (${browserId.slice(0, 8)})`;
};

export const setup = async ({ username, password }) => {
  const { token, refreshToken, sessionId } = (
    await api.post('/session/setup', {
      password,
      username,
      deviceName: getDeviceName(),
      existingSessionId: getSessionId(),
    })
  ).data;
  setToken(localStorage, token);
  if (refreshToken) setRefreshToken(localStorage, refreshToken);
  if (sessionId) setSessionId(localStorage, sessionId);
  return token;
};

export const enablePassthrough = () => {
  console.debug(
    'enabling token passthrough.  api calls will not be authenticated',
  );
  setToken(sessionStorage, tokenPassthroughValue);
};

export const isLoggedIn = () => {
  const token = getToken();
  return (
    token !== undefined && token !== null && token !== tokenPassthroughValue
  );
};

export const login = async ({ username, password, rememberMe = false }) => {
  const storage = rememberMe ? localStorage : sessionStorage;
  const { token, refreshToken, sessionId } = (
    await api.post('/session', {
      password,
      username,
      deviceName: getDeviceName(),
      existingSessionId: getSessionId(),
    })
  ).data;
  setToken(storage, token);
  if (refreshToken) setRefreshToken(storage, refreshToken);
  if (sessionId) setSessionId(storage, sessionId);
  return token;
};

export const logout = async () => {
  const refreshToken = getRefreshToken();
  clearToken();
  clearRefreshToken();
  clearSessionId();
  if (refreshToken) {
    try {
      await api.delete('/session', { data: { refreshToken } });
    } catch {
      // best-effort — token is already cleared locally
    }
  }
};

export const getSessions = async () => {
  return (await api.get('/session/sessions')).data;
};

export const revokeSession = async (id) => {
  return api.delete(`/session/sessions/${id}`);
};

export const revokeAllSessions = async () => {
  return api.delete('/session/sessions');
};

export const getStatus = async () => {
  return (await api.get('/server/status')).data;
};

export const setStatus = async ({ presence, description }) => {
  return (await api.put('/server/status', { presence, description })).data;
};

export const check = async () => {
  try {
    await api.get('/session');
    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      clearToken();
      clearRefreshToken();
      clearSessionId();
      return false;
    } else {
      throw error;
    }
  }
};
