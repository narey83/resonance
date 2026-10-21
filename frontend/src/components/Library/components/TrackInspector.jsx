import api from '../../../lib/api';
import { analysisStatus, djSummary } from '../../../lib/libraryWorkbench';
import * as prefs from '../../../lib/prefs';
import { formatSeconds } from '../../../lib/util';
import React, { useEffect, useRef, useState } from 'react';

const TrackInspector = ({
  onClose,
  onMix,
  onReview,
  onSeek,
  reviewed,
  track,
}) => {
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(false);
  const [notes, setNotes] = useState(
    () => prefs.get('library.trackNotes', {})[track.path] || '',
  );
  const [saved, setSaved] = useState(false);
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const key = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus?.();
    };
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    api
      .get('/analysis/candidates/enhanced', { params: { path: track.path } })
      .then(({ data }) => {
        if (!cancelled) setAnalysis(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [track.path]);
  const summary = djSummary(track);
  const status = analysisStatus(track, false, reviewed);
  return (
    <aside
      aria-labelledby="track-inspector-title"
      aria-modal="false"
      className="library-track-inspector"
      role="dialog"
    >
      <header>
        <span>TRACK INSPECTOR</span>
        <button
          aria-label="Close track inspector"
          className="jb-btn"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          ×
        </button>
      </header>
      <h3 id="track-inspector-title">{track.title || track.filename}</h3>
      <p>{track.artist || 'Unknown artist'}</p>
      <dl>
        <dt>Album</dt>
        <dd>{track.album || '—'}</dd>
        <dt>Tempo / key</dt>
        <dd>
          {track.bpm || '—'} BPM · {track.key || '—'}
        </dd>
        <dt>Duration</dt>
        <dd>{track.duration ? formatSeconds(track.duration) : '—'}</dd>
        <dt>Genre tag</dt>
        <dd>{track.genre || '—'}</dd>
        <dt>Predicted genre</dt>
        <dd>{summary.genre || 'Not available'}</dd>
        <dt>Energy proxy</dt>
        <dd>
          {summary.energy == null
            ? 'Not available'
            : `${summary.energy.toFixed(3)} RMS`}
        </dd>
        <dt>Analysis</dt>
        <dd>{status.label}</dd>
      </dl>
      <p className="library-inspector-note">{status.detail}</p>
      {onMix && (
        <button
          className="jb-btn"
          onClick={onMix}
          type="button"
        >
          Mix compatibility preview
        </button>
      )}
      {summary.complete && (
        <label className="library-review-toggle">
          <input
            checked={reviewed}
            onChange={(e) => onReview(track.path, e.target.checked)}
            type="checkbox"
          />{' '}
          I have reviewed this analysis
        </label>
      )}
      <h4>Preparation notes</h4>
      <textarea
        aria-label="Track preparation notes"
        maxLength={4_000}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        placeholder="Mixing notes, cue ideas, reminders…"
        rows={4}
        value={notes}
      />
      <button
        className="jb-btn"
        onClick={() => {
          prefs.set('library.trackNotes', {
            ...prefs.get('library.trackNotes', {}),
            [track.path]: notes,
          });
          setSaved(true);
        }}
        type="button"
      >
        Save notes
      </button>
      {saved && <span role="status"> Notes saved</span>}
      <h4>DJ phrases</h4>
      {error ? (
        <p role="status">Could not load analysis. Close and reopen to retry.</p>
      ) : !analysis ? (
        <p>Loading analysis…</p>
      ) : !analysis.available ? (
        <p>Enhanced analysis is not available yet.</p>
      ) : (
        <>
          <p className="library-inspector-note">
            Independent predictions · select a region to audition.
          </p>
          {(analysis.djPhrases || []).map((p) => (
            <button
              className="library-phrase-jump"
              key={`${p.start_seconds ?? p.startSeconds ?? p.seconds}-${p.end_seconds ?? p.endSeconds ?? p.label}`}
              onClick={() => onSeek(p.start_seconds)}
              type="button"
            >
              {formatSeconds(p.start_seconds)} · {p.label}
            </button>
          ))}
          <h4>Musical phrases</h4>
          {(analysis.musicalPhrases || []).map((p) => (
            <button
              className="library-phrase-jump"
              key={`${p.start_seconds ?? p.startSeconds ?? p.seconds}-${p.end_seconds ?? p.endSeconds ?? p.label}`}
              onClick={() => onSeek(p.start_seconds)}
              type="button"
            >
              {formatSeconds(p.start_seconds)} · {p.label}
            </button>
          ))}
          <h4>Vocal regions</h4>
          {(analysis.singing || []).map((p) => (
            <button
              className="library-phrase-jump"
              key={`${p.start_seconds ?? p.startSeconds ?? p.seconds}-${p.end_seconds ?? p.endSeconds ?? p.label}`}
              onClick={() => onSeek(p.startSeconds)}
              type="button"
            >
              {formatSeconds(p.startSeconds)}–{formatSeconds(p.endSeconds)} ·
              Singing
            </button>
          ))}
          <h4>Processed voice regions</h4>
          {(analysis.processedVoice || []).map((p) => (
            <button
              className="library-phrase-jump"
              key={`${p.startSeconds}-${p.endSeconds}`}
              onClick={() => onSeek(p.startSeconds)}
              type="button"
            >
              {formatSeconds(p.startSeconds)}–{formatSeconds(p.endSeconds)} ·
              Processed voice
            </button>
          ))}
          <h4>Suggested cues</h4>
          {(analysis.cues?.cueProposals || []).map((p) => (
            <button
              className="library-phrase-jump"
              key={`${p.start_seconds ?? p.startSeconds ?? p.seconds}-${p.end_seconds ?? p.endSeconds ?? p.label}`}
              onClick={() => onSeek(p.seconds)}
              type="button"
            >
              {formatSeconds(p.seconds)} · {p.reason || 'Suggested cue'}
            </button>
          ))}
        </>
      )}
      <details>
        <summary>File location</summary>
        <p className="library-file-path">{track.path}</p>
      </details>
    </aside>
  );
};

export default TrackInspector;
