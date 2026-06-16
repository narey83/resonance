import api from './api';

export const list = async () => (await api.get('/accounts')).data;

export const create = async ({ username, password, role }) =>
  (await api.post('/accounts', { username, password, role })).data;

export const get = async (username) =>
  (await api.get(`/accounts/${username}`)).data;

export const changePassword = async (username, password) =>
  api.put(`/accounts/${username}/password`, { password });

export const changeUsername = async (username, newUsername) =>
  (await api.put(`/accounts/${username}/username`, { username: newUsername }))
    .data;

export const changeFullName = async (username, fullName) =>
  api.put(`/accounts/${username}/fullname`, { fullName });

export const changeRole = async (username, role) =>
  api.put(`/accounts/${username}/role`, { role });

export const remove = async (username) => api.delete(`/accounts/${username}`);
