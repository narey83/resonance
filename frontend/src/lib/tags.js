import api from './api';

export const getTagged = async () => {
  return (await api.get('/tags/tagged')).data;
};

export const getUntagged = async () => {
  return (await api.get('/tags/untagged')).data;
};

export const getIncomplete = async () => {
  return (await api.get('/tags/incomplete')).data;
};

export const writeTags = async ({ maskedFilename, tags } = {}) => {
  if (!maskedFilename)
    throw new Error('unable to write tags: maskedFilename is missing');
  return (await api.put(`/tags/${encodeURIComponent(maskedFilename)}`, tags))
    .data;
};

export const renameDirectory = async ({ maskedDirectory, newName } = {}) => {
  if (!maskedDirectory) throw new Error('maskedDirectory is required');
  if (!newName) throw new Error('newName is required');
  return (
    await api.post('/tags/directories/rename', { maskedDirectory, newName })
  ).data;
};
