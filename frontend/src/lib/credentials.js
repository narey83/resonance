import api from './api';

export const getSoulseekCredentials = async () =>
  (await api.get('/credentials/soulseek')).data;

export const updateSoulseekCredentials = async (data) =>
  (await api.put('/credentials/soulseek', data)).data;
