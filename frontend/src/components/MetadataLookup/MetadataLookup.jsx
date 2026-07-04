import './MetadataLookup.css';
import { getStatus, runNow } from '../../lib/metadataLookup';
import {
  AlertCircle,
  CheckCircle,
  Globe,
  Loader,
  MinusCircle,
  Play,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

const STATUS_LABEL = {
  Failed: 'Failed',
  Looking: 'Looking…',
  NoMatch: 'No match',
  Queued: 'Queued',
  Written: 'Updated',
};

const formatEta = (seconds) => {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'Written':
      return <CheckCircle size={14} />;
    case 'Failed':
      return <AlertCircle size={14} />;
    case 'NoMatch':
      return <MinusCircle size={14} />;
    default:
      return (
        <Loader
          className="ml-spin"
          size={14}
        />
      );
  }
};

const MetadataLookup = () => {
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  const refresh = async () => {
    try {
      setStatus(await getStatus());
    } catch {
      /* transient — keep last known state */
    }
  };

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2_000);
    return () => clearInterval(pollRef.current);
  }, []);

  const handleRunNow = async () => {
    setStarting(true);
    try {
      await runNow();
      toast.info('Metadata lookup started.');
      setTimeout(refresh, 750);
    } catch {
      toast.error('Could not start a lookup.');
    } finally {
      setStarting(false);
    }
  };

  const progress = status ? Math.round((status.progress || 0) * 100) : 0;
  const done = status ? status.written + status.skipped + status.failed : 0;
  const eta = formatEta(status?.etaSeconds);
  const recent = status?.recent ?? [];

  return (
    <div className="ml-panel">
      <div className="ml-header">
        <div>
          <div className="ml-title">
            <Globe size={16} />
            Online metadata lookup
          </div>
          <div className="ml-subtitle">
            {status?.enabled
              ? 'Enabled — missing track details are filled in automatically from MusicBrainz.'
              : 'Disabled — turn it on in Settings → Options to fill in missing track details automatically.'}
          </div>
        </div>
        <button
          className="ml-btn hover-fx"
          disabled={starting || status?.scanning}
          onClick={handleRunNow}
          type="button"
        >
          {starting || status?.scanning ? (
            <Loader
              className="ml-spin"
              size={14}
            />
          ) : (
            <Play size={14} />
          )}
          {status?.scanning ? 'Running…' : 'Run now'}
        </button>
      </div>

      {status?.scanning && (
        <div className="ml-progress">
          <div className="ml-progress-bar">
            <div
              className="ml-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="ml-progress-stats">
            <span className="ml-count">
              {done} / {status.total}
            </span>
            <span className="ml-chip ml-chip--ok">
              {status.written} updated
            </span>
            <span className="ml-chip">{status.skipped} no match</span>
            {status.failed > 0 && (
              <span className="ml-chip ml-chip--err">
                {status.failed} failed
              </span>
            )}
            {eta && <span className="ml-eta">~{eta} left</span>}
          </div>
        </div>
      )}

      {!status?.scanning && status?.completed && status.total > 0 && (
        <div className="ml-idle">
          Last pass: {status.written} updated, {status.skipped} no match
          {status.failed > 0 ? `, ${status.failed} failed` : ''}.
        </div>
      )}

      <div className="ml-list">
        {recent.length === 0 ? (
          <div className="ml-empty">No recent activity.</div>
        ) : (
          recent.map((item) => (
            <div
              className="ml-item"
              key={item.maskedFilename}
            >
              <span
                className={`ml-item-status ml-item-status--${(item.status || '').toLowerCase()}`}
              >
                <StatusIcon status={item.status} />
                {STATUS_LABEL[item.status] ?? item.status}
              </span>
              <span className="ml-item-file">{item.filename}</span>
              {item.summary && (
                <span className="ml-item-summary">{item.summary}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MetadataLookup;
