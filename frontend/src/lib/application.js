import { apiBaseUrl } from '../config';
import api from './api';
import { getToken, isPassthroughEnabled } from './token';

export const getState = async () => {
  return (await api.get('/application')).data;
};

export const restart = async () => {
  return api.put('/application');
};

export const shutdown = async () => {
  return api.delete('/application');
};

export const getVersion = async ({ forceCheck = false }) => {
  return (await api.get(`/application/version/latest?forceCheck=${forceCheck}`))
    .data;
};

export const collectGarbage = async () => {
  return api.post('/application/gc');
};

export const loopback = async (body) => {
  return (await api.post('/application/loopback', body ?? { ping: true })).data;
};

export const getDumpUrl = () => {
  const token = isPassthroughEnabled() ? null : getToken();
  const tokenParameter = token
    ? `?access_token=${encodeURIComponent(token)}`
    : '';
  return `${apiBaseUrl}/application/dump${tokenParameter}`;
};
