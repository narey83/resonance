import { formatBytes } from '../../lib/util';
import React from 'react';

// Map a country name to a flag emoji is non-trivial without a code; show a globe glyph instead.
const GeographyCard = ({ geography }) => {
  const countries = Array.isArray(geography?.countries)
    ? geography.countries
    : [];
  const max = countries[0]?.bytes ?? 1;

  const totalUsers = Number(geography?.totalUsers ?? 0);
  const vpnUsers = Number(geography?.vpnUsers ?? 0);
  const vpnPct = totalUsers > 0 ? (vpnUsers / totalUsers) * 100 : 0;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Where Your Music Goes</span>
        {totalUsers > 0 && (
          <span
            className="geo-vpn-badge"
            title={`${vpnUsers.toLocaleString()} of ${totalUsers.toLocaleString()} peers connected via VPN`}
          >
            {vpnPct.toFixed(0)}% via VPN
          </span>
        )}
      </div>
      {countries.length === 0 ? (
        <div className="dir-empty">No upload data for this period</div>
      ) : (
        <div className="dir-list">
          {countries.map((c, index) => {
            const pct = Math.max(4, ((c.bytes ?? 0) / Math.max(max, 1)) * 100);
            return (
              <div
                className="dir-item"
                key={c.country ?? index}
              >
                <div className="dir-item-header">
                  <span
                    className="dir-name"
                    title={c.country}
                  >
                    {c.country || 'Unknown'}
                  </span>
                  <span className="dir-stats">
                    {formatBytes(c.bytes ?? 0)}
                    {' · '}
                    {(c.users ?? 0).toLocaleString()} peer
                    {c.users !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="dir-bar-track">
                  <div
                    className="dir-bar-fill geo-bar"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GeographyCard;
