import api from './api';

export const getState = async () => {
  return (await api.get('/server')).data;
};

export const getApplicationState = async () => {
  return (await api.get('/application')).data;
};

export const connect = () => {
  return api.put('/server');
};

export const disconnect = ({
  message = 'client disconnected from web UI',
} = {}) => {
  return api.delete('/server', { data: JSON.stringify(message) });
};

export const getBrowseRateLimitUsers = async () => {
  return (await api.get('/browse-rate-limit/users')).data;
};

export const unblockBrowseRateLimitUser = (username) => {
  return api.delete(`/browse-rate-limit/users/${encodeURIComponent(username)}`);
};

export const getTransferErrorNotifications = async () => {
  return (await api.get('/transfer-error-notifications')).data;
};

export const checkPort = async () => {
  return (await api.get('/server/port-check')).data;
};
