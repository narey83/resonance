import { useEffect } from 'react';
import { studio } from '../native/studio';
import { useStudio } from '../store/studioStore';

// Lives outside navigation so local playback and background controls retain the rack.
export default function StudioController() {
  const state = useStudio();
  useEffect(() => { void useStudio.getState().load(); }, []);
  useEffect(() => {
    if (!state.loaded || !studio.available) return;
    const compatible = studio.enhancedAvailable || (state.amount === 1 && state.eq.every(gain => gain === 0) && state.bassControl === 0 && state.smoothness === 0);
    void studio.configure({ values: state.values.map((value, index) => state.disabled[index] ? 0 : value), enabled: state.enabled && compatible, pushed: state.pushed, bypass: state.bypass, eq: state.eq, bassControl: state.bassControl, smoothness: state.smoothness, amount: state.amount })
      .catch(() => useStudio.setState({ error: 'The audio engine could not apply Studio settings.' }));
  }, [state.loaded, state.values, state.disabled, state.enabled, state.pushed, state.bypass, state.eq, state.bassControl, state.smoothness, state.amount]);
  return null;
}
