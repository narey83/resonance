import api from './api';

export const list = async ({ offset, limit, type, from, to }) => {
  const parameters = new URLSearchParams({ offset, limit });
  if (type) parameters.append('type', type);
  if (from) parameters.append('from', from);
  if (to) parameters.append('to', to);

  const response = await api.get(`/events?${parameters}`);

  const events = response.data;
  const totalCount = response.headers['x-total-count'];

  return { events, totalCount };
};
