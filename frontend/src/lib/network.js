import api from './api';

export const getNetworkInfo = async () => (await api.get('/network/info')).data;

export const lookupIp = async (ip) =>
  (await api.get(`/network/lookup?ip=${encodeURIComponent(ip)}`)).data;

export const batchLookup = async (ips) =>
  (await api.post('/network/batch', ips)).data;
