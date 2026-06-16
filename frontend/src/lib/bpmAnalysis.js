import api from './api';

export const getAll = async () => (await api.get('/bpmanalysis')).data;

export const getScanState = async () =>
  (await api.get('/bpmanalysis/scan')).data;

export const startScan = async (request) =>
  api.post('/bpmanalysis/scan', request);

export const cancelScan = async () => api.delete('/bpmanalysis/scan');

export const setBpm = async (maskedFilename, bpm) =>
  api.put(`/bpmanalysis/${encodeURIComponent(maskedFilename)}`, { bpm });

export const clearBpm = async (maskedFilename) =>
  api.delete(`/bpmanalysis/${encodeURIComponent(maskedFilename)}/bpm`);
