// <copyright file="index.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

/* eslint-disable canonical/filename-match-exported */
import './Map.css';
import * as networkAPI from '../../lib/network';
import * as optionsAPI from '../../lib/options';
import * as prefs from '../../lib/prefs';
import * as reportsAPI from '../../lib/reports';
import * as transfersAPI from '../../lib/transfers';
import { keepIfEqual } from '../../lib/util';
import WorldMap from '../Overview/WorldMap';
import { ExternalLink } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

const RANGES = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 168, label: '7d' },
  { hours: 720, label: '30d' },
  { hours: 2_160, label: '90d' },
  { hours: 4_320, label: '6m' },
  { hours: 8_760, label: '1y' },
];

const DIRECTIONS = [
  { value: 'all', label: 'All' },
  { value: 'download', label: 'Downloads' },
  { value: 'upload', label: 'Uploads' },
];

const pad2 = (n) => String(n).padStart(2, '0');

// <input type="datetime-local"> wants local time with no timezone suffix.
const toDatetimeLocal = (isoOrDate) => {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// `popoutUrl` is set when the map is embedded in the app shell: it adds a button that opens the
// standalone map (the same page without the nav) in its own window, e.g. for a second monitor.
const MapPage = ({ popoutUrl }) => {
  const [downloads, setDownloads] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [serverLat, setServerLat] = useState(null);
  const [serverLon, setServerLon] = useState(null);
  // Shared with the Overview page via the `overview:range-h` preference.
  const [range, setRange] = useState(() => {
    const n = Number(prefs.get('overview:range-h', 24));
    return RANGES.some((r) => r.hours === n) ? n : 24;
  });
  // When set, overrides `range` with an explicit [start, end] window.
  const [customRange, setCustomRange] = useState(null);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customStartInput, setCustomStartInput] = useState('');
  const [customEndInput, setCustomEndInput] = useState('');
  const [pastPeers, setPastPeers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Filters — applied client-side across both past and live-active peers.
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('all');
  const [vpnOnly, setVpnOnly] = useState(false);

  // Server location
  useEffect(() => {
    const load = async () => {
      try {
        const options = await optionsAPI.getCurrent();
        const lat = options?.location?.lat;
        const lon = options?.location?.lon;
        if (lat != null && lon != null) {
          setServerLat(lat);
          setServerLon(lon);
          return;
        }

        const info = await networkAPI.getNetworkInfo();
        if (info?.lat != null && info?.lon != null) {
          setServerLat(info.lat);
          setServerLon(info.lon);
        }
      } catch {
        /* ignore */
      }
    };

    load();
  }, []);

  // Active transfers — 5s polling
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [d, u] = await Promise.all([
          transfersAPI
            .getAll({ activeOnly: true, direction: 'download' })
            .catch(() => null),
          transfersAPI
            .getAll({ activeOnly: true, direction: 'upload' })
            .catch(() => null),
        ]);
        if (!cancelled) {
          setDownloads((previous) => keepIfEqual(previous, d ?? []));
          setUploads((previous) => keepIfEqual(previous, u ?? []));
        }
      } catch {
        /* ignore */
      }
    };

    poll();
    const id = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Past connections
  useEffect(() => {
    let cancelled = false;
    const end = customRange ? customRange.end : new Date().toISOString();
    const start = customRange
      ? customRange.start
      : new Date(Date.now() - range * 60 * 60 * 1_000).toISOString();

    const PAGE_SIZE = 500;
    const MAX_PEERS = 5_000;

    const load = async () => {
      try {
        // The wider the range, the more distinct peers can match — page
        // through the result set (sorted by LastSeen) instead of taking a
        // single page, otherwise larger ranges just re-show the same most
        // recent 500 peers and never surface older ones.
        let items = [];
        let offset = 0;
        for (;;) {
          const page = await reportsAPI.getUserList({
            start,
            end,
            limit: PAGE_SIZE,
            offset,
            sortBy: 'LastSeen',
          });
          if (cancelled) return;
          items = items.concat(page.items ?? []);
          offset += PAGE_SIZE;
          if (
            (page.items ?? []).length < PAGE_SIZE ||
            offset >= (page.total ?? 0) ||
            items.length >= MAX_PEERS
          ) {
            break;
          }
        }

        const users = (items ?? []).map((u) => ({
          username: u.username ?? u.Username,
          ip: u.ipAddress ?? u.IpAddress,
          lat: u.lat ?? u.Lat,
          lon: u.lon ?? u.Lon,
          city: u.city ?? u.City,
          country: u.country ?? u.Country,
          isVpn: u.isVpn ?? u.IsVpn,
          uploadCount: u.uploadCount ?? u.UploadCount ?? 0,
          downloadCount: u.downloadCount ?? u.DownloadCount ?? 0,
          uploadBytes: u.uploadBytes ?? u.UploadBytes ?? 0,
          downloadBytes: u.downloadBytes ?? u.DownloadBytes ?? 0,
          uploadAverageSpeed: u.uploadAverageSpeed ?? u.UploadAverageSpeed ?? 0,
          downloadAverageSpeed:
            u.downloadAverageSpeed ?? u.DownloadAverageSpeed ?? 0,
          lastSeen: u.lastSeen ?? u.LastSeen,
          browseCount: 0,
          chatCount: 0,
        }));

        // Show users that already have coords stored
        const ready = users.filter((u) => u.lat != null && u.lon != null);
        if (!cancelled) {
          setPastPeers(ready);
          setLoading(false);
        }

        // Batch-resolve the rest via local GeoLite2 DB — one request, instant
        const needsGeo = users.filter(
          (u) => (u.lat == null || u.lon == null) && u.ip,
        );
        if (!cancelled && needsGeo.length > 0) {
          if (!cancelled) setResolving(true);
          const geoMap = await networkAPI.batchLookup(
            needsGeo.map((u) => u.ip),
          );
          if (!cancelled) {
            const resolved = needsGeo
              .map((u) => {
                const g = geoMap[u.ip];
                if (!g?.lat || !g?.lon) return null;
                return {
                  ...u,
                  lat: g.lat,
                  lon: g.lon,
                  city: g.city ?? u.city,
                  country: g.country ?? u.country,
                };
              })
              .filter(Boolean);
            setPastPeers((previous) => [...previous, ...resolved]);
            setResolving(false);
          }
        }

        // Fetch browse + chat counts for all users in one request
        const usernames = [
          ...new Set(users.map((u) => u.username).filter(Boolean)),
        ];
        if (usernames.length > 0 && !cancelled) {
          const eventCounts = await reportsAPI
            .getUserEventCounts({ usernames, start })
            .catch(() => ({}));
          if (!cancelled) {
            setPastPeers((previous) =>
              previous.map((p) => {
                const ec = eventCounts[p.username];
                return ec
                  ? {
                      ...p,
                      browseCount: ec.browseCount ?? 0,
                      chatCount: ec.chatCount ?? 0,
                    }
                  : p;
              }),
            );
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) {
          setLoading(false);
          setResolving(false);
        }
      }
    };

    setPastPeers([]);
    setLoading(true);
    setResolving(false);
    load();
    return () => {
      cancelled = true;
    };
  }, [customRange, range]);

  // Client-side filters — search / direction / VPN-only — applied to the
  // already-fetched past-connection set.
  const filteredPastPeers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pastPeers.filter((p) => {
      if (vpnOnly && !p.isVpn) return false;
      if (direction === 'upload' && !(p.uploadCount > 0)) return false;
      if (direction === 'download' && !(p.downloadCount > 0)) return false;
      if (q && !p.username?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [direction, pastPeers, search, vpnOnly]);

  const applyCustomRange = () => {
    if (!customStartInput || !customEndInput) return;
    const start = new Date(customStartInput);
    const end = new Date(customEndInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    if (start >= end) return;
    setCustomRange({ start: start.toISOString(), end: end.toISOString() });
    setShowCustomPicker(false);
  };

  const openCustomPicker = () => {
    setCustomStartInput(
      customRange?.start
        ? toDatetimeLocal(customRange.start)
        : toDatetimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1_000)),
    );
    setCustomEndInput(
      customRange?.end ? toDatetimeLocal(customRange.end) : toDatetimeLocal(),
    );
    setShowCustomPicker((v) => !v);
  };

  const hasCustomRange = customRange != null;

  return (
    <div className={`map-page${popoutUrl ? ' map-page--embedded' : ''}`}>
      <div className="map-controls">
        <div className="map-controls-row">
          <span className="map-controls-label">Range</span>
          <div className="map-controls-pills">
            {RANGES.map((r) => (
              <button
                className={`map-pill hover-fx${!hasCustomRange && range === r.hours ? ' active' : ''}`}
                key={r.hours}
                onClick={() => {
                  prefs.set('overview:range-h', r.hours);
                  setCustomRange(null);
                  setShowCustomPicker(false);
                  setRange(r.hours);
                }}
                type="button"
              >
                {r.label}
              </button>
            ))}
            <button
              className={`map-pill hover-fx${hasCustomRange ? ' active' : ''}`}
              onClick={openCustomPicker}
              type="button"
            >
              Custom…
            </button>
          </div>
          <span className="map-controls-count">
            {loading && <span className="map-controls-loading">Loading…</span>}
            {resolving && (
              <span className="map-controls-loading">Resolving locations…</span>
            )}
            {!loading &&
              !resolving &&
              pastPeers.length > 0 &&
              (filteredPastPeers.length === pastPeers.length
                ? `${pastPeers.length} peers`
                : `${filteredPastPeers.length} of ${pastPeers.length} peers`)}
          </span>
          {popoutUrl && (
            <button
              aria-label="Pop out map"
              className="map-popout hover-fx"
              onClick={() =>
                window.open(
                  popoutUrl,
                  'resonance-live-map',
                  'popup,width=1280,height=800',
                )
              }
              title="Pop out into its own window"
              type="button"
            >
              <ExternalLink
                size={13}
                strokeWidth={1.75}
              />
            </button>
          )}
        </div>

        {showCustomPicker && (
          <div className="map-custom-range">
            <label className="map-custom-range-field">
              From
              <input
                onChange={(e) => setCustomStartInput(e.target.value)}
                type="datetime-local"
                value={customStartInput}
              />
            </label>
            <label className="map-custom-range-field">
              To
              <input
                onChange={(e) => setCustomEndInput(e.target.value)}
                type="datetime-local"
                value={customEndInput}
              />
            </label>
            <button
              className="map-custom-range-apply hover-fx"
              onClick={applyCustomRange}
              type="button"
            >
              Apply
            </button>
            <button
              className="map-custom-range-cancel hover-fx"
              onClick={() => setShowCustomPicker(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="map-controls-row map-controls-filters">
          <input
            className="map-search"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by username…"
            type="text"
            value={search}
          />
          <div className="map-controls-pills">
            {DIRECTIONS.map((d) => (
              <button
                className={`map-pill hover-fx${direction === d.value ? ' active' : ''}`}
                key={d.value}
                onClick={() => setDirection(d.value)}
                type="button"
              >
                {d.label}
              </button>
            ))}
          </div>
          <button
            className={`map-pill hover-fx${vpnOnly ? ' active' : ''}`}
            onClick={() => setVpnOnly((v) => !v)}
            type="button"
          >
            VPN only
          </button>
        </div>
      </div>

      <div className="map-canvas">
        <WorldMap
          direction={direction}
          downloads={downloads}
          pastPeers={filteredPastPeers}
          search={search}
          serverLat={serverLat}
          serverLon={serverLon}
          uploads={uploads}
          vpnOnly={vpnOnly}
        />
      </div>
    </div>
  );
};

export default MapPage;
