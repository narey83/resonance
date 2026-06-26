import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
} from 'react-native-track-player';

// Single shared, idempotent player initialisation.
//
// `setupPlayer()` is async, so anything that touches TrackPlayer before it
// resolves throws "The player is not initialized. Call setupPlayer first."
// Both the UI (PlayerContext) and the headless playback service can be the
// first to reach the player — on a cold Android Auto launch the service runs
// before the UI mounts — so initialisation is memoised here and every early
// caller awaits the same promise.
let setupPromise: Promise<void> | null = null;

export function ensurePlayerSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      try {
        await TrackPlayer.setupPlayer({
          maxCacheSize: 1024 * 256, // 256 MB on-disk cache — fewer re-downloads on repeat plays
          // Buffer generously so brief bandwidth dips (tunnels, weak cellular) don't stall:
          minBuffer:  30,  // keep ≥30 s buffered ahead
          maxBuffer:  120, // read up to 2 min ahead when bandwidth allows
          playBuffer: 5,   // wait for 5 s buffered before (re)starting playback
          backBuffer: 30,  // retain 30 s behind for instant back-seek
        });
      } catch {
        // Already set up (e.g. the headless service initialised it first).
      }
      await TrackPlayer.updateOptions(buildPlayerOptions(false));
    })();
  }
  return setupPromise;
}

// Full options object for TrackPlayer.updateOptions. RNTP's updateOptions is a *full replace* —
// every call rebuilds the notification/media-session config from scratch, so any call that omits
// `capabilities`/`notificationCapabilities` wipes the transport controls (no play/pause/skip on the
// lock screen or shade). Always pass this complete object, toggling only the like state, so the
// controls survive Love-button updates.
export function buildPlayerOptions(isLoved: boolean) {
  return {
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.SetRating,
    ],
    notificationCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SetRating,
    ],
    likeOptions: { isActive: isLoved, title: isLoved ? 'Unlove' : 'Love' },
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    },
  };
}
