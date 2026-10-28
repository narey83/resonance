import { getInfo } from '../../lib/users';
import React, { useEffect, useState } from 'react';

const PeerUploadSlots = ({ username }) => {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState({ loading: true });

  useEffect(() => {
    const controller = new AbortController();
    setResult({ loading: true });
    getInfo({ username, signal: controller.signal, timeout: 15_000 })
      .then(({ data: info }) => {
        if (!controller.signal.aborted)
          setResult({ data: info, loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ loading: false });
      });
    return () => controller.abort();
  }, [refresh, username]);

  const { data, loading } = result;
  const slots =
    Number.isInteger(data?.uploadSlots) && data.uploadSlots >= 0
      ? `${data.uploadSlots} upload slot${data.uploadSlots === 1 ? '' : 's'}`
      : 'Upload slots unknown';
  const availability =
    typeof data?.hasFreeUploadSlot === 'boolean'
      ? data.hasFreeUploadSlot
        ? 'slot available'
        : 'no free slots'
      : 'availability unknown';
  const queue =
    Number.isInteger(data?.queueLength) && data.queueLength >= 0
      ? ` · ${data.queueLength} queued at peer`
      : '';

  return (
    <div
      className="dl-peer-slots"
      onClick={(event) => event.stopPropagation()}
    >
      <span title="Reported by the uploader when checked. Queue length is their total queue, not your position. Soulseek does not report the exact number of free slots.">
        {loading
          ? 'Checking upload slots…'
          : data
            ? `${slots} · ${availability}${queue}`
            : 'Upload slots unavailable'}
      </span>
      <button
        aria-label={`Refresh upload slots for ${username}`}
        className="dl-action-btn"
        disabled={loading}
        onClick={() => setRefresh((value) => value + 1)}
        type="button"
      >
        Refresh
      </button>
    </div>
  );
};

export default PeerUploadSlots;
