import api from './api';

export const getAll = async ({ direction, activeOnly = false }) => {
  const qs = activeOnly ? '?activeOnly=true' : '';
  const response = (
    await api.get(`/transfers/${encodeURIComponent(direction)}s${qs}`)
  ).data;

  if (!Array.isArray(response)) {
    console.warn('got non-array response from transfers API', response);
    return undefined;
  }

  return response;
};

export const download = ({ username, files = [], destinationFolder = '' }) => {
  const body = files.map((f) => ({
    ...f,
    destinationFolder: destinationFolder || undefined,
  }));
  return api.post(`/transfers/downloads/${encodeURIComponent(username)}`, body);
};

export const cancel = ({ direction, username, id, remove = false }) => {
  return api.delete(
    `/transfers/${direction}s/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=${remove}`,
  );
};

export const clearCompleted = ({ direction }) => {
  return api.delete(`/transfers/${direction}s/all/completed`);
};

// 'Requested'
// 'Queued, Remotely'
// 'Queued, Locally'
// 'Initializing'
// 'InProgress'
// 'Completed, Succeeded'
// 'Completed, Cancelled'
// 'Completed, TimedOut'
// 'Completed, Errored'
// 'Completed, Rejected'

export const listDownloadFolders = async (path = '') => {
  const response = await api.get('/transfers/downloads/folders', {
    params: { path },
  });
  return response.data;
};

export const createDownloadFolder = async (path) => {
  return api.post('/transfers/downloads/folders', { path });
};

export const getPlaceInQueue = ({ username, id }) => {
  return api.get(
    `/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}/position`,
  );
};

export const isStateRetryable = (state) =>
  state.includes('Completed') && state !== 'Completed, Succeeded';

export const isStateCancellable = (state) =>
  [
    'InProgress',
    'Requested',
    'Queued',
    'Queued, Remotely',
    'Queued, Locally',
    'Initializing',
  ].find((s) => s === state);

export const isStateRemovable = (state) => state.includes('Completed');
