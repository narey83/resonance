import TrackPlayer from 'react-native-track-player';
import { apiClient } from '../api/client';
import { remoteAccessEnabled } from '../lib/remoteAccess';
import { isLocalPath } from './localMusicLibrary';
import { offlineUriFor } from './offlineCrates';

let nextReportAt = 0;
let inFlight = false;

export async function reportPlaybackActivity(): Promise<void> {
  if (inFlight || Date.now() < nextReportAt || !remoteAccessEnabled()) return;
  inFlight = true;
  nextReportAt = Date.now() + 20_000;
  try {
    const track = await TrackPlayer.getActiveTrack();
    const path = track?._source?.path;
    if (!path || isLocalPath(path) || offlineUriFor(path)) return;
    await apiClient.post('/musiclibrary/playback/activity', null, { timeout: 5000 });
  } catch {
    // Playback must not depend on this best-effort scheduling hint.
  } finally {
    inFlight = false;
  }
}
