import { useEffect } from 'react';
import { studio } from '../native/studio';
import { useStudio } from '../store/studioStore';

// Lives outside navigation so local playback and background controls retain the rack.
export default function StudioController() {
  const state = useStudio();
  useEffect(() => { void useStudio.getState().load(); }, []);
  useEffect(() => {
    if (!state.loaded || !studio.available) return;
    void studio.configure({ values: state.values.map((value, index) => state.disabled[index] ? 0 : value), enabled: state.enabled, pushed: state.pushed, bypass: state.bypass })
      .catch(() => useStudio.setState({ error: 'The audio engine could not apply Studio settings.' }));
  }, [state.loaded, state.values, state.disabled, state.enabled, state.pushed, state.bypass]);
  return null;
}
