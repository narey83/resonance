import { getScanState } from '../lib/analysis';
import { getAnalysisStats } from '../lib/musicLibrary';
import { useEffect, useState } from 'react';

// Readiness uses saved coverage, never background queue membership.
export default function useLibraryReadiness() {
  const [state, setState] = useState({ stats: null, scan: null });
  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = async () => {
      const [coverage, scan] = await Promise.allSettled([
        getAnalysisStats(),
        getScanState(),
      ]);
      if (cancelled) return;
      setState((previous) => ({
        stats:
          coverage.status === 'fulfilled' ? coverage.value : previous.stats,
        scan: scan.status === 'fulfilled' ? scan.value : previous.scan,
        coverageError: coverage.status === 'rejected',
        scanError: scan.status === 'rejected',
      }));
      timer = setTimeout(poll, 10_000);
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return state;
}
