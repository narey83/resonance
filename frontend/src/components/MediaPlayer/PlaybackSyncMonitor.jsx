import { peekMediaAudioGraph } from '../../lib/mediaAudioGraph';
import { readPlaybackSync } from '../../lib/playbackSync';
import React, { useEffect, useState } from 'react';

const PlaybackSyncMonitor = ({
  audioRef,
  compensated,
  onCompensated,
  remote,
}) => {
  const [sample, setSample] = useState(null);
  useEffect(() => {
    const update = () => {
      const audio = audioRef.current;
      setSample(
        remote
          ? null
          : readPlaybackSync(audio, peekMediaAudioGraph(audio)?.context),
      );
    };

    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [audioRef, remote]);
  return (
    <details className="mp-sync-monitor">
      <summary>Waveform sync</summary>
      <p>
        {remote
          ? 'Monitoring is unavailable for casting.'
          : sample?.available
            ? `Reported audio output delay: ${Math.round(sample.delay * 1_000)} ms`
            : 'Play local audio to measure output delay. This browser or output may not support monitoring.'}
      </p>
      <label>
        <input
          checked={compensated}
          disabled={remote}
          onChange={(event) => onCompensated(event.target.checked)}
          type="checkbox"
        />
        Compensate waveform for reported output delay
      </label>
      <p>
        Uses the browser’s output clock. It does not verify acoustic kick
        alignment or change analysis, playback or seek targets.
      </p>
    </details>
  );
};

export default PlaybackSyncMonitor;
