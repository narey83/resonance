// <copyright file="StartupStatus.jsx" company="John Narey">
// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only
// </copyright>

import React, { useState } from 'react';

const StartupStatus = ({ status }) => {
  const [dismissed, setDismissed] = useState(false);
  const services = status?.services ?? [];
  const failed = services.filter((service) => service.state === 'failed');

  // Once everything has finished the banner only stays up to report failures, which would
  // otherwise leave a service silently dead until someone went looking in the logs.
  if (services.length === 0 || dismissed) return null;
  if (status?.ready && failed.length === 0) return null;

  return (
    <div
      className={`startup-status${status?.ready ? ' startup-status--failed' : ''}`}
      role="status"
    >
      <div className="startup-status-title">
        {status?.ready
          ? `${failed.length} service${failed.length === 1 ? '' : 's'} failed to start`
          : 'Starting background services'}
        {status?.ready && (
          <button
            aria-label="Dismiss"
            className="startup-status-dismiss"
            onClick={() => setDismissed(true)}
            type="button"
          >
            ×
          </button>
        )}
      </div>
      <div className="startup-status-services">
        {(status?.ready ? failed : services).map((service) => (
          <span
            className={`startup-status-service startup-status-service--${service.state}`}
            key={service.id}
            title={service.message}
          >
            <span className="startup-status-dot" />
            {service.name}:{' '}
            {service.state === 'failed' ? service.message : service.state}
          </span>
        ))}
      </div>
    </div>
  );
};

export default StartupStatus;
