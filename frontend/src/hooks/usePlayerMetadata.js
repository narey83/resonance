import { useLibraryActivity } from '../context/LibraryActivityContext';
import { resolveLibraryTracks } from '../lib/libraryWorkbench';
import { useEffect, useState } from 'react';

// Display metadata is separate from the playback track object: updating a BPM/key
// must not make the audio-loading effect reload or restart the current stream.
export default function usePlayerMetadata(track) {
  const [snapshot, setSnapshot] = useState(null);
  const revision = useLibraryActivity()?.libraryRevision || 0;
  const path = track?.localRelativePath || track?.path;
  const local = Boolean(track?.localRelativePath);
  useEffect(() => {
    let cancelled = false;
    if (local && path)
      resolveLibraryTracks([path])
        .then((rows) => {
          if (!cancelled) setSnapshot({ path, record: rows[0] || null });
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [local, path, revision]);
  const record = snapshot && snapshot.path === path ? snapshot.record : null;
  return {
    bpm: record?.bpm ?? track?.bpm,
    key: record?.key || track?.key,
    hasWaveform: record?.hasWaveform ?? track?.hasWaveform,
  };
}
