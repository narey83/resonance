import { apiBaseUrl } from '../config';
import api from './api';
import { getToken, isPassthroughEnabled } from './token';

// btoa only handles Latin-1; encode to UTF-8 bytes first so paths with non-ASCII chars work
const pathToBase64 = (s) => btoa(unescape(encodeURIComponent(s)));

export const getSyncState = async () =>
  (await api.get('/musiclibrary/sync')).data;

export const triggerSync = async () => api.post('/musiclibrary/sync');

export const getTracks = async (queryParameters) =>
  (await api.get('/musiclibrary/tracks', { params: queryParameters })).data;

export const getIssueTracks = async (issue, limit = 5_000) =>
  (await api.get('/musiclibrary/tracks', { params: { [issue]: true, limit } }))
    .data;

export const getAlbums = async (artist) =>
  (await api.get('/musiclibrary/albums', { params: artist ? { artist } : {} }))
    .data;

export const getArtists = async () =>
  (await api.get('/musiclibrary/artists')).data;

export const getRecentlyAdded = async (limit = 20) =>
  (await api.get('/musiclibrary/recentlyadded', { params: { limit } })).data;

export const getKeyedTracks = async () =>
  (await api.get('/musiclibrary/keyed')).data;

export const getGenres = async () =>
  (await api.get('/musiclibrary/genres')).data;

export const getYears = async () => (await api.get('/musiclibrary/years')).data;

export const getFolders = async () =>
  (await api.get('/musiclibrary/folders')).data;

export const analyzeTrack = async (path, { key = true, bpm = true } = {}) =>
  api.post('/musiclibrary/tracks/analyze', {
    path,
    analyzeKey: key,
    analyzeBpm: bpm,
  });

export const analyzeFolder = async (path, { key = true, bpm = true } = {}) =>
  api.post('/musiclibrary/folders/analyze', {
    path,
    analyzeKey: key,
    analyzeBpm: bpm,
  });

export const deleteTrack = async (path) =>
  api.delete('/musiclibrary/tracks', { params: { path: pathToBase64(path) } });

export const deleteFolder = async (path) =>
  api.delete('/musiclibrary/folders', { params: { path: pathToBase64(path) } });

export const renameFolder = async (path, newName) =>
  api.patch('/musiclibrary/folders', { path, newName });

export const renameTrack = async (path, newFilename) =>
  api.patch('/musiclibrary/tracks', { path, newFilename });

export const deleteTrackBatch = async (maskedPaths) =>
  (await api.post('/musiclibrary/tracks/delete-batch', { maskedPaths })).data;

export const deleteTrackBatchLocal = async (paths) =>
  (
    await api.post('/musiclibrary/tracks/delete-batch-local', {
      paths: paths.map(pathToBase64),
    })
  ).data;

// Returns a URL for use in <img src={...}> — includes auth token when required.
export const getArtworkUrl = (path) => {
  if (!path) return null;

  const token = isPassthroughEnabled() ? null : getToken();
  const tokenParameter = token
    ? `&access_token=${encodeURIComponent(token)}`
    : '';

  return `${apiBaseUrl}/musiclibrary/artwork?path=${encodeURIComponent(path)}${tokenParameter}`;
};
