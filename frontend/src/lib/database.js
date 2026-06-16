import api from './api';

export const listDatabases = async () => (await api.get('/database')).data;

export const getSchema = async (name) =>
  (await api.get(`/database/${name}/schema`)).data;

export const runQuery = async (name, sql, limit = 500) =>
  (await api.post(`/database/${name}/query`, { sql, limit })).data;
