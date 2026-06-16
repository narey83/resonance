import api from './api';

const buildParameters = (parameters) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(parameters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }

  return qs.toString();
};

export const getSummary = async ({ start, end, direction, username } = {}) => {
  const q = buildParameters({ start, end, direction, username });
  return (await api.get(`/telemetry/reports/transfers/summary?${q}`)).data;
};

export const getHistogram = async ({
  start,
  end,
  interval = 60,
  direction,
  username,
} = {}) => {
  const q = buildParameters({ start, end, interval, direction, username });
  return (await api.get(`/telemetry/reports/transfers/histogram?${q}`)).data;
};

export const getLeaderboard = async ({
  direction,
  start,
  end,
  sortBy = 'TotalBytes',
  limit = 10,
  offset = 0,
} = {}) => {
  const q = buildParameters({ direction, start, end, sortBy, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/leaderboard?${q}`)).data;
};

export const getDirectories = async ({
  start,
  end,
  limit = 10,
  offset = 0,
} = {}) => {
  const q = buildParameters({ start, end, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/directories?${q}`)).data;
};

export const getTopFiles = async ({
  start,
  end,
  limit = 10,
  offset = 0,
} = {}) => {
  const q = buildParameters({ start, end, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/files?${q}`)).data;
};

export const getExceptionsPareto = async ({
  direction,
  start,
  end,
  limit = 10,
  offset = 0,
} = {}) => {
  if (!direction) return [];
  const q = buildParameters({ direction, start, end, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/exceptions/pareto?${q}`))
    .data;
};

export const getUserDetail = async ({ username, start, end } = {}) => {
  const q = buildParameters({ start, end });
  return (
    await api.get(
      `/telemetry/reports/transfers/users/${encodeURIComponent(username)}?${q}`,
    )
  ).data;
};

export const getExceptions = async ({
  direction,
  start,
  end,
  username,
  limit = 50,
  offset = 0,
} = {}) => {
  const q = buildParameters({ direction, start, end, username, limit, offset });
  return (await api.get(`/telemetry/reports/transfers/exceptions?${q}`)).data;
};

export const getUserList = async ({
  start,
  end,
  search,
  sortBy = 'LastSeen',
  sortOrder = 'DESC',
  limit = 25,
  offset = 0,
} = {}) => {
  const q = buildParameters({
    start,
    end,
    search,
    sortBy,
    sortOrder,
    limit,
    offset,
  });
  const res = await api.get(`/telemetry/reports/transfers/users?${q}`);
  return {
    items: res.data,
    total: Number.parseInt(res.headers['x-total-count'] ?? '0', 10),
  };
};

export const getUserTransfers = async ({
  username,
  direction,
  start,
  end,
  sortOrder = 'DESC',
  limit = 25,
  offset = 0,
} = {}) => {
  const q = buildParameters({
    direction,
    start,
    end,
    sortOrder,
    limit,
    offset,
  });
  const res = await api.get(
    `/telemetry/reports/transfers/users/${encodeURIComponent(username)}/transfers?${q}`,
  );
  return {
    items: res.data,
    total: Number.parseInt(res.headers['x-total-count'] ?? '0', 10),
  };
};

export const getUserEventCounts = async ({ usernames, start } = {}) => {
  const q = start ? `?start=${encodeURIComponent(start)}` : '';
  return (
    await api.post(`/telemetry/reports/users/event-counts${q}`, usernames)
  ).data;
};

export const getUserNetworkInfo = async ({ username } = {}) => {
  try {
    return (
      await api.get(
        `/telemetry/reports/transfers/users/${encodeURIComponent(username)}/network`,
      )
    ).data;
  } catch {
    return null;
  }
};

export const getUserBrowseEvents = async ({
  username,
  start,
  end,
  limit = 50,
  offset = 0,
} = {}) => {
  const q = buildParameters({ start, end, limit, offset });
  const res = await api.get(
    `/telemetry/reports/transfers/users/${encodeURIComponent(username)}/browse?${q}`,
  );
  return {
    items: res.data,
    total: Number.parseInt(res.headers['x-total-count'] ?? '0', 10),
  };
};
