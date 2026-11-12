import { useEffect } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { useAuthStore } from '../store/auth';
import { useAppSettings } from '../store/appSettingsStore';
import { initNotifications } from './notificationService';
import { remoteLog } from '../api/remoteLogger';

type BackgroundChatNative = {
  start: (url: string, token: string, sessionId: string, privateMessages: boolean, roomMentions: boolean) => Promise<boolean>;
  update: (token: string, privateMessages: boolean, roomMentions: boolean) => void;
  setAppActive: (active: boolean) => void;
  stop: () => void;
};

const native = Platform.OS === 'android' ? NativeModules.BackgroundChat as BackgroundChatNative | undefined : undefined;

/** Mount only for the signed-in remote app. The native service owns polling after the UI closes. */
export function useBackgroundChat() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const sessionId = useAuthStore((state) => state.sessionId);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const enabled = useAppSettings((state) => state.notifications.backgroundChat);
  const privateMessages = useAppSettings((state) => state.notifications.privateMessage);
  const roomMentions = useAppSettings((state) => state.notifications.roomMention);
  const loaded = useAppSettings((state) => state.loaded);

  useEffect(() => {
    if (!native || !loaded || !enabled || (!privateMessages && !roomMentions) || !serverUrl || !sessionId || !refreshToken) {
      native?.stop();
      return;
    }
    let cancelled = false;
    void initNotifications().then((permitted) => {
      if (cancelled || !permitted) return;
      return native.start(serverUrl, refreshToken, sessionId, privateMessages, roomMentions)
        .then(() => native.setAppActive(AppState.currentState === 'active'));
    }).catch((error: unknown) => {
      remoteLog('warn', `[background-chat] service unavailable: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { cancelled = true; native.stop(); };
    // A rotated refresh token and alert switches update the existing service below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, enabled, serverUrl, sessionId, !!refreshToken, privateMessages || roomMentions]);

  useEffect(() => {
    if (!native || !enabled || !refreshToken) return;
    native.update(refreshToken, privateMessages, roomMentions);
  }, [enabled, refreshToken, privateMessages, roomMentions]);

  useEffect(() => {
    if (!native) return;
    const subscription = AppState.addEventListener('change', (state) => native.setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);
}
