import api from './api';

export const getScanState = async () =>
  (await api.get('/tagsanitization/scan')).data;

export const startScan = async (request) =>
  api.post('/tagsanitization/scan', request);

export const cancelScan = async () => api.delete('/tagsanitization/scan');
