import api from './api';

export const getMatrix = async () => (await api.get('/permissions')).data;

export const createRole = async (name) =>
  (await api.post('/permissions/roles', { name })).data;

export const deleteRole = async (name) =>
  api.delete(`/permissions/roles/${encodeURIComponent(name)}`);

export const setPermission = async (roleName, featureKey, allowed) =>
  api.put(
    `/permissions/${encodeURIComponent(roleName)}/${encodeURIComponent(featureKey)}`,
    { allowed },
  );
