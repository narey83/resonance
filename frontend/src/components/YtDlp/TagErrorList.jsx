import * as ytdlp from '../../lib/ytdlp';
import { RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';

const TagErrorList = ({ jobs, onRetryTags }) => {
  const [retryingAll, setRetryingAll] = useState(false);
  const [errorTracks, setErrorTracks] = useState(null);

  const totalTagErrors = jobs.reduce(
    (n, job) => n + (job.tagFailedTracks || 0),
    0,
  );

  const jobTitleById = useMemo(() => {
    const map = {};
    for (const job of jobs) map[job.id] = job.title || job.url;
    return map;
  }, [jobs]);

  const refresh = useCallback(async () => {
    try {
      const res = await ytdlp.getTagErrors();
      setErrorTracks(res.data || []);
    } catch (error) {
      toast.error(`Failed to load tag errors: ${error.message}`);
      setErrorTracks([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    // totalTagErrors is in the deps so the list refetches when the live
    // job stats (via SignalR) report a different error count
  }, [refresh, totalTagErrors]);

  const handleRetry = async (trackId) => {
    await onRetryTags(trackId);
    await refresh();
  };

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      await Promise.all(errorTracks.map((t) => ytdlp.retryTags(t.id)));
      toast.success('Retried all tag errors');
    } catch (error) {
      toast.error(`Retry all failed: ${error.message}`);
    } finally {
      setRetryingAll(false);
      await refresh();
    }
  };

  if (errorTracks === null) {
    return <div className="ytdlp-empty">Loading tag errors…</div>;
  }

  if (errorTracks.length === 0) {
    return <div className="ytdlp-empty">No tag errors — all good!</div>;
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <button
          className="ytdlp-btn ytdlp-btn--primary"
          disabled={retryingAll}
          onClick={handleRetryAll}
          type="button"
        >
          <RefreshCw size={13} />
          {retryingAll ? 'Retrying…' : 'Retry All'}
        </button>
      </div>
      <div className="ytdlp-tag-error-list">
        {errorTracks.map((t) => (
          <div
            className="ytdlp-tag-error-item"
            key={t.id}
          >
            <div className="ytdlp-tag-error-info">
              <div className="ytdlp-tag-error-title">{t.title}</div>
              <div className="ytdlp-tag-error-msg">{t.tagWritingError}</div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                {jobTitleById[t.jobId] || ''}
              </div>
            </div>
            <button
              className="ytdlp-btn"
              onClick={() => handleRetry(t.id)}
              type="button"
            >
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TagErrorList;
