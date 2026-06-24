import { Platform, Vibration } from 'react-native';

// Lightweight haptic feedback built on React Native's Vibration API — no native module and no
// dev-client rebuild required (the dev client already holds the VIBRATE permission).
//
// iOS ignores the duration argument and always buzzes for ~400ms, which is far too heavy for
// subtle UI ticks, so feedback is Android-only here. Swap in `expo-haptics` (Taptic engine,
// needs a one-time dev-client rebuild) if iOS haptics are wanted later.
const tick = (ms: number) => {
  if (Platform.OS === 'android') Vibration.vibrate(ms);
};

export const haptics = {
  selection: () => tick(6),   // shuffle / repeat toggle, scrubbing
  light:     () => tick(10),  // play / pause, love, seek commit
  skip:      () => tick(15),  // track change (next / prev)
};
