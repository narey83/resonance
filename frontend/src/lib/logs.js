import api from './api';

export const postLog = (level, ...args) => {
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }

      return String(a);
    })
    .join(' ');

  api.post('/logs', { level, message }).catch(() => {});
};

export const getLogs = async ({
  offset = 0,
  limit = 100,
  level,
  context,
  search,
  from,
  to,
} = {}) => {
  const params = new URLSearchParams({ offset, limit });

  if (level?.length) {
    for (const l of level) params.append('level', l);
  }

  if (context) params.append('context', context);
  if (search) params.append('search', search);
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const response = await api.get(`/logs?${params}`);

  return {
    logs: response.data,
    totalCount: Number(response.headers['x-total-count'] ?? 0),
  };
};
