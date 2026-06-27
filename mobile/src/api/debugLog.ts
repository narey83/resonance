import { apiClient } from './client';
import { useAppSettings } from '../store/appSettingsStore';

// Diagnostic logger for library load/sync performance. Gated behind the "Library sync debug"
// setting (Settings → Debugging); when ON it posts the timeline straight to the backend logs
// (POST /logs, context "Mobile/SyncDebug"), readable server-side via `docker logs` or the log
// viewer. Fire-and-forget, and a no-op when the toggle is off so it costs nothing in normal use.
export const isSyncDebugOn = (): boolean => useAppSettings.getState().librarySyncDebug;

export const dbg = (msg: string) => {
  if (!isSyncDebugOn()) return;
   
  apiClient.post('/logs', { level: 'info', message: msg, context: 'Mobile/SyncDebug' }).catch(() => {});
};
