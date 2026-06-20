import TrackPlayer, { Event, State } from 'react-native-track-player';
import { handleAndroidAutoBrowse, playAndroidAutoMediaId, handleAndroidAutoLove } from './androidAuto';
import { ensurePlayerSetup } from './playerSetup';

// Runs in a background thread — handles remote control events from
// lock screen, notification, Android Auto, and Bluetooth controls.
export default async function () {
  // Ensure the player is initialised in the headless context (Android Auto can
  // fire remote-browse before the UI mounts and calls setupPlayer itself).
  await ensurePlayerSetup();

  TrackPlayer.addEventListener(Event.RemotePlay,     ()      => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause,    ()      => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext,     ()      => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, ()      => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek,     (event) => TrackPlayer.seekTo(event.position));
  TrackPlayer.addEventListener(Event.RemoteStop,     ()      => TrackPlayer.reset());

  // Android Auto: a track was selected in the car (mediaId === track path).
  TrackPlayer.addEventListener(Event.RemotePlayId, (event) => playAndroidAutoMediaId(event.id));
  // Android Auto: the car opened a not-yet-loaded browse node.
  (TrackPlayer.addEventListener as (e: string, cb: (event: { mediaId: string }) => void) => void)(
    'remote-browse',
    (event) => handleAndroidAutoBrowse(event.mediaId),
  );
  // Android Auto: the user tapped the heart/love button in the car.
  (TrackPlayer.addEventListener as (e: string, cb: () => void) => void)(
    'remote-love',
    () => handleAndroidAutoLove(),
  );

  let wasPlayingBeforeDuck = false;

  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    if (event.permanent || event.paused) {
      const { state } = await TrackPlayer.getPlaybackState();
      wasPlayingBeforeDuck = state === State.Playing;
      await TrackPlayer.pause();
    } else if (wasPlayingBeforeDuck) {
      wasPlayingBeforeDuck = false;
      await TrackPlayer.play();
    }
  });
};
