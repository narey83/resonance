import api from './api';

export const getAll = async () => (await api.get('/keyanalysis')).data;

export const getScanState = async () =>
  (await api.get('/keyanalysis/scan')).data;

export const startScan = async (request) =>
  api.post('/keyanalysis/scan', request);

export const cancelScan = async () => api.delete('/keyanalysis/scan');

export const setKey = async (maskedFilename, key, writeToTags = true) =>
  api.put(`/keyanalysis/${encodeURIComponent(maskedFilename)}`, {
    key,
    writeToTags,
  });

export const clearKey = async (maskedFilename, writeToTags = true) =>
  api.delete(
    `/keyanalysis/${encodeURIComponent(maskedFilename)}/key?writeToTags=${writeToTags}`,
  );
