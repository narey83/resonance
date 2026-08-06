// <copyright file="UpnpStatusSection.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import * as upnpLibrary from '../../../lib/upnp';
import { parseUtcDate } from '../../../lib/util';
import React, { useState } from 'react';

const button = (extra = {}) => ({
  padding: '3px 10px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 12,
  ...extra,
});

// upnp is the live UpnpState pushed over the app's SignalR hub (state.upnp), not a static option.
const UpnpStatusSection = ({ upnp }) => {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(null);

  if (!upnp?.isEnabled) {
    return null;
  }

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await upnpLibrary.retry();
    } catch (error_) {
      setError(`Retry failed: ${error_.response?.data || error_.message}`);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 24,
        borderTop: '1px solid var(--border)',
        paddingTop: 20,
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 8,
          padding: '0 14px',
        }}
      >
        Status
      </div>
      <div className="opt-field">
        <div className="opt-field-label">Port Mapping</div>
        <div className="opt-field-right">
          <div
            className="opt-field-control"
            style={{ gap: 10 }}
          >
            {upnp.isMapped ? (
              <span style={{ color: '#38a169', fontWeight: 600, fontSize: 13 }}>
                ✓ Working — port {upnp.mappedPort} mapped
                {upnp.externalIPAddress ? ` to ${upnp.externalIPAddress}` : ''}
              </span>
            ) : (
              <span
                style={{
                  color: 'var(--red, #e53e3e)',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                ✗ Not working — no active mapping
              </span>
            )}
            <button
              disabled={retrying}
              onClick={handleRetry}
              style={button()}
              type="button"
            >
              {retrying ? 'Retrying…' : 'Retry Now'}
            </button>
          </div>
          <div className="opt-field-desc">
            {upnp.isMapped && upnp.leaseExpiresAt
              ? `Lease renews before it expires at ${parseUtcDate(upnp.leaseExpiresAt).toLocaleString()}. `
              : ''}
            {!upnp.isMapped && upnp.lastError
              ? `Last error: ${upnp.lastError}. `
              : ''}
            The app retries automatically every 30 seconds while unmapped (e.g.
            after a router reboot) — use Retry Now to check immediately.
            {error && (
              <span
                style={{
                  color: 'var(--red, #e53e3e)',
                  display: 'block',
                  marginTop: 4,
                }}
              >
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpnpStatusSection;
