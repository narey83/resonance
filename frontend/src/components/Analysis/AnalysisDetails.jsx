import { djSummary } from '../../lib/libraryWorkbench';
import CandidateAnalysisPanel from '../TrackAnalysis/CandidateAnalysisPanel';
import React, { useEffect, useRef } from 'react';

const AnalysisDetails = ({ onClose, track }) => {
  const summary = djSummary(track) || {};
  const section = useRef(null);
  const close = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    section.current?.scrollIntoView?.({ block: 'nearest' });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <section
      aria-label="Track analysis details"
      className="ka-analysis-details"
      ref={section}
    >
      <header>
        <div>
          <h3>{track.title || track.filename}</h3>
          <p>
            {track.artist || 'Unknown artist'} ·{' '}
            {track.album || 'Unknown album'}
          </p>
        </div>
        <button
          aria-label="Close analysis details"
          className="ka-btn"
          onClick={onClose}
          ref={close}
          type="button"
        >
          Close
        </button>
      </header>
      <div className="ka-detail-comparison">
        <div>
          <h4>Basic measurements</h4>
          <dl>
            <dt>BPM</dt>
            <dd>{track.bpm || 'Pending'}</dd>
            <dt>Musical key</dt>
            <dd>{track.key || 'Pending'}</dd>
            <dt>Loudness</dt>
            <dd>
              {track.lufs == null ? 'Pending' : `${track.lufs.toFixed(1)} LUFS`}
            </dd>
            <dt>Waveform</dt>
            <dd>{track.hasWaveform ? 'Available' : 'Pending'}</dd>
          </dl>
        </div>
        <div>
          <h4>Enhanced predictions</h4>
          <dl>
            <dt>Status</dt>
            <dd>{summary.complete ? 'Ready for review' : 'Not complete'}</dd>
            <dt>BPM / key</dt>
            <dd>
              {summary.bpm ? summary.bpm.toFixed(1) : 'Pending'} /{' '}
              {summary.key || 'Pending'}
            </dd>
            <dt>Genre suggestion</dt>
            <dd>{summary.genre || 'Pending'}</dd>
            <dt>Voice</dt>
            <dd>
              {summary.vocals == null
                ? 'Pending'
                : summary.vocals
                  ? 'Detected'
                  : 'Not detected'}
            </dd>
          </dl>
        </div>
      </div>
      <CandidateAnalysisPanel
        initialJobId={summary.analysisId}
        path={track.path}
        resultsOnly
      />
    </section>
  );
};

export default AnalysisDetails;
