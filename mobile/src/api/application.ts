import { apiClient } from './client';

export interface AppState {
  version: {
    full:              string;
    current:           string;
    latest:            string | null;
    isUpdateAvailable: boolean;
    isCanary:          boolean;
    isDevelopment:     boolean;
  };
  server: {
    address:     string;
    state:       string;
    isConnected: boolean;
    isLoggedIn:  boolean;
  };
  user: {
    username:   string;
    privileges: { isPrivileged: boolean; privilegesRemaining: number };
    statistics: { averageSpeed: number; directoryCount: number; fileCount: number; uploadCount: number };
  };
  shares: {
    ready:       boolean;
    scanning:    boolean;
    scanPending: boolean;
    faulted:     boolean;
    directories: number;
    files:       number;
  };
}

export interface KpiMetric {
  name:     string;
  help:     string;
  type:     string;
  sum?:     number;
  count?:   number;
  samples?: Array<{ value?: number; labels: Record<string, string> }>;
}

export const getApplicationState = () =>
  apiClient.get<AppState>('/application').then(r => r.data);

export const getKpis = () =>
  apiClient.get<Record<string, KpiMetric>>('/telemetry/metrics/kpis').then(r => r.data);
