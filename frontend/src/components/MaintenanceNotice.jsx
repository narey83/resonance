import { rootUrl } from '../config';
import React, { useEffect, useState } from 'react';

// Independent of App initialization/auth and SignalR: Caddy can answer while .NET is stopped.
const MaintenanceNotice = () => {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer;
    const poll = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetch(`${rootUrl}/maintenance/status`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          if (!stopped) setActive(data.maintenance === true);
        }
      } catch {
        // An ordinary outage is handled by the existing reconnect UI.
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, 5_000);
      }
    };

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  if (!active) return null;
  return (
    <div
      className="maintenance-notice"
      role="alert"
    >
      <div className="maintenance-notice-card">
        <span className="maintenance-notice-label">Scheduled maintenance</span>
        <h2>Your server will be back shortly</h2>
        <p>
          We’re restarting the server. This page will reconnect automatically
          when it’s ready.
        </p>
        <span>Your sign-in is kept. You can leave this page open.</span>
      </div>
    </div>
  );
};

export default MaintenanceNotice;
