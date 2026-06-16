import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';

import App from './App';
import PlaybackService from './src/services/playback-service';

// Must be registered before registerRootComponent
TrackPlayer.registerPlaybackService(() => PlaybackService);

registerRootComponent(App);
