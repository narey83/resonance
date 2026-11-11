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
import * as transfersAPI from '../../lib/transfers';
import { keepIfEqual } from '../../lib/util';
import { validCoordinates } from './location';
import { loadMapPeers, MAP_PEER_LIMIT } from './mapData';
import StreetMap from './StreetMap';
import { ExternalLink } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

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
const savedLocation = () => {
  const value = prefs.get('map:my-location');
  return value && validCoordinates(value.lat, value.lon) ? value : null;
};

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
  const [myLocation, setMyLocation] = useState(savedLocation);
  const [showLocationEditor, setShowLocationEditor] = useState(false);
  const [locationLatInput, setLocationLatInput] = useState('');
  const [locationLonInput, setLocationLonInput] = useState('');
  const [pickingLocation, setPickingLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
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
  const [loadError, setLoadError] = useState(false);
  const [totalPeers, setTotalPeers] = useState(0);

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
    let timer;
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

      if (!cancelled) timer = setTimeout(poll, 5_000);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Cancel old windows and reveal located peers before optional enrichment.
  useEffect(() => {
    const controller = new AbortController();
    const end = customRange?.end ?? new Date().toISOString();
    const start =
      customRange?.start ??
      new Date(Date.now() - range * 3_600_000).toISOString();
    setPastPeers([]);
    setTotalPeers(0);
    setLoading(true);
    setResolving(false);
    setLoadError(false);
    loadMapPeers({
      start,
      end,
      signal: controller.signal,
      onPeers: setPastPeers,
      onTotal: setTotalPeers,
      onReady: () => {
        setLoading(false);
        setResolving(true);
      },
    })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setResolving(false);
        }
      });
    return () => controller.abort();
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
  const mapOrigin = useMemo(
    () =>
      myLocation ??
      (validCoordinates(serverLat, serverLon)
        ? { lat: serverLat, lon: serverLon }
        : null),
    [myLocation, serverLat, serverLon],
  );

  const saveLocation = (lat, lon) => {
    if (!validCoordinates(lat, lon)) {
      setLocationError(
        'Enter a latitude from −90 to 90 and a longitude from −180 to 180.',
      );
      return;
    }

    const location = { lat, lon };
    prefs.set('map:my-location', location);
    setMyLocation(location);
    setLocationError('');
    setPickingLocation(false);
    setShowLocationEditor(false);
  };

  const pickLocation = useCallback((lat, lon) => {
    setLocationLatInput(lat.toFixed(6));
    setLocationLonInput(lon.toFixed(6));
    setPickingLocation(false);
    setLocationError('Review the coordinates, then save your location.');
  }, []);

  const useBrowserLocation = () => {
    if (!navigator.geolocation) {
      setLocationError(
        'Browser location is unavailable. Enter coordinates or pick a point on the map.',
      );
      return;
    }

    setLocationError('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => saveLocation(coords.latitude, coords.longitude),
      () =>
        setLocationError(
          'Could not get browser location. Enter coordinates or pick a point on the map.',
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

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
            {loadError && (
              <span role="alert">
                Could not load peer history. Choose a range to retry.
              </span>
            )}
            {!loading && totalPeers > MAP_PEER_LIMIT && (
              <span>
                Most recent {MAP_PEER_LIMIT.toLocaleString()} of{' '}
                {totalPeers.toLocaleString()} peers ·{' '}
              </span>
            )}
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
          <button
            className={`map-pill hover-fx${showLocationEditor ? ' active' : ''}`}
            onClick={() => {
              setLocationLatInput(mapOrigin?.lat?.toString() ?? '');
              setLocationLonInput(mapOrigin?.lon?.toString() ?? '');
              setLocationError('');
              setPickingLocation(false);
              setShowLocationEditor((value) => !value);
            }}
            type="button"
          >
            ⌖ My location
          </button>
        </div>
        {showLocationEditor && (
          <div className="map-location-editor">
            <div>
              <strong>My location</strong>
              <span>
                Sets the origin shown on this map and its live connection lines.
              </span>
            </div>
            <button
              className="map-pill"
              onClick={useBrowserLocation}
              type="button"
            >
              Use browser location
            </button>
            <button
              className={`map-pill${pickingLocation ? ' active' : ''}`}
              onClick={() => setPickingLocation((value) => !value)}
              type="button"
            >
              {pickingLocation ? 'Click the map…' : 'Pick on map'}
            </button>
            <label>
              Latitude
              <input
                aria-label="My latitude"
                onChange={(event) => setLocationLatInput(event.target.value)}
                step="any"
                type="number"
                value={locationLatInput}
              />
            </label>
            <label>
              Longitude
              <input
                aria-label="My longitude"
                onChange={(event) => setLocationLonInput(event.target.value)}
                step="any"
                type="number"
                value={locationLonInput}
              />
            </label>
            <button
              className="map-pill active"
              onClick={() =>
                saveLocation(
                  locationLatInput.trim() === ''
                    ? Number.NaN
                    : Number(locationLatInput),
                  locationLonInput.trim() === ''
                    ? Number.NaN
                    : Number(locationLonInput),
                )
              }
              type="button"
            >
              Save location
            </button>
            {myLocation && (
              <button
                className="map-pill"
                onClick={() => {
                  prefs.set('map:my-location', null);
                  setMyLocation(null);
                  setLocationError('Using server location again.');
                }}
                type="button"
              >
                Use server location
              </button>
            )}
            {locationError && <span role="status">{locationError}</span>}
          </div>
        )}
      </div>

      <div className="map-canvas">
        <StreetMap
          direction={direction}
          downloads={downloads}
          onPickLocation={pickLocation}
          origin={mapOrigin}
          originConfirmed={myLocation != null}
          pastPeers={filteredPastPeers}
          pickingLocation={pickingLocation}
          search={search}
          uploads={uploads}
          vpnOnly={vpnOnly}
        />
      </div>
    </div>
  );
};

export default MapPage;
