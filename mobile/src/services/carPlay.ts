import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { useAppSettings } from '../store/appSettingsStore';
import { useAppMode } from '../store/appModeStore';
import { useAuthStore } from '../store/auth';
import { ensurePlayerSetup } from './playerSetup';
import { buildAndroidAutoTree, clearAndroidAutoTree, handleAndroidAutoBrowse, hasCarBrowseNode, playAndroidAutoMediaId } from './androidAuto';
import { remoteLog } from '../api/remoteLogger';

let started = false;
let preparing: Promise<void> | undefined;
export function registerCarPlay() {
  const native = NativeModules.ResonanceCarPlay;
  if (Platform.OS !== 'ios' || !native || started) return;
  started = true;
  const prepare = () => {
    preparing ??= (async () => {
      if (!useAppSettings.getState().loaded) await useAppSettings.getState().load();
      if (!useAppMode.getState().loaded) await useAppMode.getState().load();
      if (!useAuthStore.getState().isReady) await useAuthStore.getState().hydrate();
      await ensurePlayerSetup();
      await clearAndroidAutoTree();
      await buildAndroidAutoTree();
    })().finally(() => { preparing = undefined; });
    return preparing;
  };
  const events = new NativeEventEmitter(native);
  events.addListener('carplay-connect', () => {
    void prepare().catch((error: unknown) => remoteLog('error', `[carplay] library setup failed: ${String(error)}`));
  });
  events.addListener('carplay-action', async ({ kind, mediaId, requestId }: { kind: string; mediaId: string; requestId: string }) => {
    try {
      await ensurePlayerSetup();
      if (kind === 'play') await playAndroidAutoMediaId(mediaId, true);
      else if (kind === 'refresh') await prepare();
      else if (kind === 'browse') {
        await handleAndroidAutoBrowse(mediaId);
        if (!hasCarBrowseNode(mediaId)) throw new Error('Check your server connection or music permissions on iPhone, then retry.');
      } else throw new Error('Unsupported CarPlay action');
      native.finish(requestId, null);
    } catch (error) {
      native.finish(requestId, error instanceof Error ? error.message : 'Unable to load music. Try again.');
    }
  });
  // A scene can connect before JS registers its event receiver.
  void native.ready().then((connected: boolean) => connected ? prepare() : undefined)
    .catch((error: unknown) => remoteLog('error', `[carplay] startup failed: ${String(error)}`));
}
