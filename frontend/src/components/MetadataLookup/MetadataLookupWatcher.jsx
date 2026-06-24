import { getStatus } from '../../lib/metadataLookup';
import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';

// Renders nothing. Polls the background metadata-lookup service so the user is made
// aware — via toasts — when an enrichment pass starts and finishes, from anywhere in
// the app (the Tags → Online lookup tab shows the detailed live progress).
const MetadataLookupWatcher = () => {
  const wasScanningRef = useRef(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const status = await getStatus();
        if (!active) return;

        if (status.scanning && !wasScanningRef.current) {
          toast.info('Filling in missing track details…');
        } else if (!status.scanning && wasScanningRef.current) {
          toast.success(
            `Metadata lookup finished — ${status.written} updated.`,
          );
        }

        wasScanningRef.current = status.scanning;
      } catch {
        /* ignore transient errors */
      }
    };

    poll();
    const id = setInterval(poll, 8_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return null;
};

export default MetadataLookupWatcher;
