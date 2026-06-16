import api from './api';

export const getLoved = async () => (await api.get('/musiclibrary/loved')).data;

export const loveTrack = async (path) =>
  api.put('/musiclibrary/loved', { path });

export const unloveTrack = async (path) =>
  api.delete('/musiclibrary/loved', { params: { path } });

export const clearAllLoved = async () => api.delete('/musiclibrary/loved/all');

export const recordPlay = async (path) =>
  (await api.post('/musiclibrary/plays', { path })).data;

export const getPlayHistory = async (limit = 100, offset = 0) =>
  (await api.get('/musiclibrary/plays', { params: { limit, offset } })).data;

export const deletePlay = async (id) =>
  api.delete(`/musiclibrary/plays/${encodeURIComponent(id)}`);

export const clearHistory = async () => api.delete('/musiclibrary/plays');

export const getPlayStats = async (paths = null) =>
  (
    await api.get(
      '/musiclibrary/plays/stats',
      paths ? { params: { paths } } : {},
    )
  ).data;
