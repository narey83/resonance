import { useAppMode } from '../store/appModeStore';
import { useAuthStore } from '../store/auth';

export function useRemoteAccess(): boolean {
  const mode = useAppMode(state => state.mode);
  const signedIn = useAuthStore(state => !!state.accessToken && !!state.serverUrl);
  return mode === 'remote' && signedIn;
}
export function remoteAccessEnabled(): boolean {
  const { serverUrl, accessToken } = useAuthStore.getState();
  return useAppMode.getState().mode === 'remote' && !!serverUrl && !!accessToken;
}
