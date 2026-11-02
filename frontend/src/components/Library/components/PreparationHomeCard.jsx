import '../LibraryWorkspace.css';
import { urlBase } from '../../../config';
import useLibraryReadiness from '../../../hooks/useLibraryReadiness';
import usePreparationStatus from '../../../hooks/usePreparationStatus';
import { ArrowRight, AudioWaveform, Sparkles } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

const count = (value) => (value == null ? '—' : value.toLocaleString());

const PreparationHomeCard = ({ onCrates }) => {
  const { coverageError, scan, scanError, stats } = useLibraryReadiness();
  const { error, status } = usePreparationStatus();
  return (
    <div
      aria-label="Library readiness"
      className="preparation-home-card"
    >
      <span className="preparation-home-icon">
        <AudioWaveform size={22} />
      </span>
      <div>
        <span className="workspace-eyebrow">Library readiness</span>
        <strong>
          {count(stats?.complete)} Basic ready ·{' '}
          {count(stats?.enhanced?.complete)} Enhanced ready ·{' '}
          {count(stats?.total)} total tracks
        </strong>
        {coverageError && (
          <p role="status">
            Readiness updates delayed. Retrying automatically…
          </p>
        )}
        <p>
          {scanError
            ? 'Current scan status unavailable'
            : !scan
              ? 'Checking current scan…'
              : scan.scanning
                ? `${scan.enhancedTotal > 0 ? 'Basic + Enhanced' : 'Basic'} scan · ${scan.ending ? 'Ending after current tracks' : scan.paused ? 'Paused' : scan.pauseRequested ? 'Pausing after current tracks' : 'Running'} · ${count(scan.inFlight ?? 0)} analysing · ${count(scan.failed ?? 0)} failed`
                : 'No manual scan running'}
        </p>
        <p>
          {error
            ? 'Background scheduling status unavailable'
            : !status
              ? 'Checking background scheduling…'
              : `Background scheduling: ${status.paused ? 'Off' : 'On'}`}
        </p>
        {status?.analysisError && (
          <p role="alert">Background analysis: {status.analysisError}</p>
        )}
      </div>
      <div className="workspace-actions">
        <Link
          className="jb-btn"
          to={`${urlBase}/trackanalysis`}
        >
          Track Analysis <ArrowRight size={14} />
        </Link>
        <button
          className="jb-btn"
          onClick={onCrates}
          type="button"
        >
          Smart crates <Sparkles size={14} />
        </button>
      </div>
    </div>
  );
};

export default PreparationHomeCard;
