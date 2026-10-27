import { useAppMode } from '../store/appModeStore';
import { useAuthStore } from '../store/auth';
import { useLibrarySettings } from '../store/librarySettingsStore';

export async function enterLocalMode(): Promise<void> {
  // Clearing the server login also cancels its hubs and pending account work.
  // No request is sent to the server when choosing local music.
  await useAuthStore.getState().clearTokens();
  await useLibrarySettings.getState().setIncludeLocalLibrary(true);
  await useLibrarySettings.getState().setMergeLocalAndServer(false);
  await useAppMode.getState().select('local');
}
