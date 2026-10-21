import { getPreparationStatus, workspaceError } from '../lib/libraryWorkspace';
import { useCallback, useEffect, useState } from 'react';

export default function usePreparationStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const next = await getPreparationStatus();
        if (!cancelled) {
          setStatus(next);
          setError('');
        }
      } catch (error_) {
        if (!cancelled) setError(workspaceError(error_));
      }

      if (!cancelled) timer = setTimeout(poll, 5_000);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [revision]);
  return {
    status,
    error,
    refresh: useCallback(() => setRevision((n) => n + 1), []),
  };
}
