import api from './api';

export const getKpis = async () => {
  return (await api.get('/telemetry/metrics/kpis')).data;
};

export const getMetrics = async () => {
  return (await api.get('/telemetry/metrics')).data;
};
