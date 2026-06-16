import {
  refreshTokenKey,
  sessionIdKey,
  tokenKey,
  tokenPassthroughValue,
} from '../config';

export const getToken = () =>
  sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey);
export const setToken = (storage, token) => storage.setItem(tokenKey, token);
export const clearToken = () => {
  localStorage.removeItem(tokenKey);
  sessionStorage.removeItem(tokenKey);
};

export const getRefreshToken = () =>
  sessionStorage.getItem(refreshTokenKey) ||
  localStorage.getItem(refreshTokenKey);
export const setRefreshToken = (storage, token) =>
  storage.setItem(refreshTokenKey, token);
export const clearRefreshToken = () => {
  localStorage.removeItem(refreshTokenKey);
  sessionStorage.removeItem(refreshTokenKey);
};

export const getRefreshTokenStorage = () =>
  sessionStorage.getItem(refreshTokenKey) !== null
    ? sessionStorage
    : localStorage;

export const getSessionId = () =>
  sessionStorage.getItem(sessionIdKey) || localStorage.getItem(sessionIdKey);
export const setSessionId = (storage, id) => storage.setItem(sessionIdKey, id);
export const clearSessionId = () => {
  localStorage.removeItem(sessionIdKey);
  sessionStorage.removeItem(sessionIdKey);
};

export const isPassthroughEnabled = () => getToken() === tokenPassthroughValue;

const decodeJwtPayload = () => {
  try {
    const token = getToken();
    if (!token || token === tokenPassthroughValue) return null;
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
};

export const getRole = () => {
  const p = decodeJwtPayload();
  // ASP.NET Core uses the long claim URI for role
  return (
    p?.['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ??
    p?.role ??
    null
  );
};

export const getUsername = () => {
  const p = decodeJwtPayload();
  return (
    p?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ??
    p?.name ??
    null
  );
};

export const isAdmin = () => getRole() === 'Administrator';
