import api from '../../lib/api';
import React, { useEffect, useRef, useState } from 'react';

const stems = ['vocals', 'drums', 'bass', 'other'];

const StemPreview = ({ enabled, onGenerated, path }) => {
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('30');
  const [loading, setLoading] = useState('');
  const [jobId, setJobId] = useState('');
  const [active, setActive] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [message, setMessage] = useState('');
  const audio = useRef(null);
  const request = useRef(null);
  const currentUrl = useRef('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, []);

  const clearAudio = () => {
    audio.current?.pause();
    setAudioUrl('');
    setActive('');
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = '';
  };

  const generate = async () => {
    const controller = new AbortController();
    request.current = controller;
    clearAudio();
    setJobId('');
    setBusy(true);
    setMessage(
      scope === 'full'
        ? 'Separating the full track into four stems…'
        : 'Separating the first 30 seconds into four stems…',
    );
    try {
      const { data } = await api.post(
        '/analysis/candidates',
        { path, seconds: scope === 'full' ? null : 30, features: ['stems'] },
        { signal: controller.signal },
      );
      const { data: result } = await api.get(
        `/analysis/candidates/${encodeURIComponent(data.job.jobId)}`,
        { signal: controller.signal },
      );
      if (!mounted.current) return;
      if (
        !result.contentCurrent ||
        result.analysis?.featureAvailability?.stems !== 'available'
      ) {
        setMessage('Stem separation did not finish. Try this track again.');
        return;
      }

      setJobId(data.job.jobId);
      setMessage('Choose a stem to load its audio.');
      onGenerated?.();
    } catch {
      if (mounted.current)
        setMessage(
          controller.signal.aborted
            ? 'Stem preview cancelled.'
            : 'Could not generate a stem preview.',
        );
    } finally {
      if (mounted.current) setBusy(false);
      if (request.current === controller) request.current = null;
    }
  };

  const load = async (stem) => {
    const controller = new AbortController();
    request.current = controller;
    clearAudio();
    setLoading(stem);
    setMessage(`Loading ${stem}…`);
    try {
      const { data } = await api.get(
        `/analysis/candidates/${encodeURIComponent(jobId)}/stems/${stem}`,
        { responseType: 'blob', signal: controller.signal },
      );
      if (!mounted.current) return;
      const url = URL.createObjectURL(data);
      currentUrl.current = url;
      setAudioUrl(url);
      setActive(stem);
      setMessage(`Ready to play ${stem}.`);
    } catch {
      if (mounted.current) setMessage('Could not load this stem.');
    } finally {
      if (mounted.current) setLoading('');
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <div className="candidate-stem-preview">
      <h4>Listen to separated stems</h4>
      <p>
        Generate this track’s vocals, drums, bass and other sounds when you ask
        for them. The separated audio is saved with an independent candidate.
      </p>
      <label>
        Preview length
        <select
          disabled={busy || Boolean(loading)}
          onChange={(event) => setScope(event.target.value)}
          value={scope}
        >
          <option value="30">First 30 seconds</option>
          <option value="full">Full track · stores four large WAV files</option>
        </select>
      </label>
      <button
        disabled={!enabled || busy || Boolean(loading)}
        onClick={generate}
        type="button"
      >
        {busy ? 'Separating stems…' : 'Generate stem preview'}
      </button>
      {busy && (
        <button
          onClick={() => request.current?.abort()}
          type="button"
        >
          Cancel preview
        </button>
      )}
      {jobId && (
        <div className="candidate-stem-buttons">
          {stems.map((stem) => (
            <button
              disabled={Boolean(loading)}
              key={stem}
              onClick={() => load(stem)}
              type="button"
            >
              {loading === stem ? `Loading ${stem}…` : `Listen to ${stem}`}
            </button>
          ))}
        </div>
      )}
      {audioUrl && (
        // Music stems have no spoken content or caption track.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          aria-label={`${active} stem preview`}
          controls
          ref={audio}
          src={audioUrl}
        />
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
};

export default StemPreview;
