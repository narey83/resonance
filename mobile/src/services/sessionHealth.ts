import { AppState } from 'react-native';
import { apiClient, getValidToken } from '../api/client';
import { sessionGuard } from '../lib/sessionScope';

// Public reachability is not authentication. Validate the current login independently.
export function startSessionHealth(): () => void {
  const current = sessionGuard();
  let stopped = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = async () => {
    if (stopped || !current() || pending) return;
    if (timer) clearTimeout(timer);
    pending = true;
    try {
      if (AppState.currentState === 'active') {
        const token = await getValidToken();
        if (!stopped && current() && token) await apiClient.get('/session');
      }
    } catch { /* Network errors keep credentials; definitive rejection is handled by the API. */ }
    finally {
      pending = false;
      if (!stopped && current()) timer = setTimeout(() => { void check(); }, 60_000);
    }
  };
  const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
  void check();
  return () => { stopped = true; if (timer) clearTimeout(timer); subscription.remove(); };
}
