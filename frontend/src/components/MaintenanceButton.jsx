import { rootUrl } from '../config';
import { getToken, isAdmin } from '../lib/token';
import { Wrench } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-toastify';

const MaintenanceButton = ({
  className = 'status-strip-btn status-strip-btn--label',
}) => {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  if (!isAdmin()) return null;
  const restart = async () => {
    setPending(true);
    try {
      const response = await fetch(`${rootUrl}/maintenance/control`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'restart' }),
      });
      if (!response.ok)
        throw new Error('Maintenance restart could not be started.');
      setConfirming(false);
      toast.info(
        'Maintenance started. The server will reconnect automatically.',
      );
    } catch {
      toast.error(
        'Maintenance restart could not be started. Check your administrator sign-in and server connection.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="maintenance-action">
      {confirming ? (
        <>
          <p>
            Restart the backend? Server playback and transfers will be
            interrupted until it is ready.
          </p>
          <button
            className={className}
            disabled={pending}
            onClick={restart}
            type="button"
          >
            {pending ? 'Starting maintenance…' : 'Confirm restart'}
          </button>
          <button
            className="status-strip-btn"
            disabled={pending}
            onClick={() => setConfirming(false)}
            type="button"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          className={className}
          onClick={() => setConfirming(true)}
          type="button"
        >
          <Wrench size={13} /> Restart server…
        </button>
      )}
    </div>
  );
};

export default MaintenanceButton;
