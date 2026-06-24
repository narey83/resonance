import api from './api';
import { signedQuery } from './streamSignatures';
import { getToken, isPassthroughEnabled } from './token';

export const getLocalStreamUrl = (path) => {
  // Absolute paths are music library tracks; relative paths are downloaded files
  if (path.startsWith('/')) {
    // Library tracks authenticate via a path-scoped signature (warmed by the library fetchers),
    // not the account token.
    return `/api/v0/musiclibrary/stream?path=${encodeURIComponent(path)}${signedQuery(path)}`;
  }

  const token = isPassthroughEnabled() ? null : getToken();
  const tokenParameter = token
    ? `&access_token=${encodeURIComponent(token)}`
    : '';
  return `/api/v0/files/downloads/stream?path=${encodeURIComponent(path)}${tokenParameter}`;
};

export const browseDirectories = async (path = '/') => {
  const response = await api.get('/files/directories', { params: { path } });
  return response.data;
};

export const createDirectory = async (path) => {
  const response = await api.post('/files/directories', { path });
  return response.data;
};

export const list = async ({ root, subdirectory = '' }) => {
  const response = (
    await api.get(`/files/${root}/directories/${btoa(subdirectory)}`)
  ).data;

  return response;
};

export const deleteDirectory = async ({ root, path }) => {
  const response = await api.delete(`/files/${root}/directories/${btoa(path)}`);

  return response;
};

export const deleteFile = async ({ root, path }) => {
  const response = await api.delete(`/files/${root}/files/${btoa(path)}`);

  return response;
};
