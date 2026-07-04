// <copyright file="WorldMap.jsx" company="John Narey">
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

import { lookupIp } from '../../lib/network';
import { formatBytes, parseUtcDate } from '../../lib/util';
import UserReportModal from './UserReportModal';
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Line,
  Marker,
  ZoomableGroup,
} from 'react-simple-maps';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const BASE_SCALE = 160;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 24;
const TOOLTIP_W = 260;
const TOOLTIP_H = 280;

const collectPeers = (groups, direction) => {
  const peers = [];
  for (const group of groups ?? []) {
    if (!group.peerAddress) continue;
    const hasActive = (group.directories ?? []).some((d) =>
      (d.files ?? []).some((f) => f.state === 'InProgress'),
    );
    peers.push({
      ip: group.peerAddress,
      username: group.username,
      direction,
      active: hasActive,
    });
  }

  return peers;
};

const HOUR_MS = 3_600_000;

// Warm = recently seen, cool/dim = older. Keep in sync with the legend below.
const RECENCY_BUCKETS = [
  { color: 'var(--map-dot-1h)', label: '< 1h', maxAgeHours: 1 },
  { color: 'var(--map-dot-24h)', label: '< 24h', maxAgeHours: 24 },
  { color: 'var(--map-dot-7d)', label: '< 7d', maxAgeHours: 168 },
  {
    color: 'var(--map-dot-past)',
    label: 'Older',
    maxAgeHours: Number.POSITIVE_INFINITY,
  },
];

const recencyColor = (lastSeen) => {
  const age = lastSeen
    ? Date.now() - parseUtcDate(lastSeen).getTime()
    : Number.POSITIVE_INFINITY;
  return RECENCY_BUCKETS.find((b) => age < b.maxAgeHours * HOUR_MS).color;
};

// Past-peer dot radius scales (sqrt) with total bytes transferred, so heavy
// peers stand out without active/idle live dots (fixed size) changing. Sqrt
// (not log) keeps the bulk of small/typical transfers visually compact —
// log1p barely differentiates a 30MB peer from a 4GB one at this scale.
const VOLUME_MIN_R = 1;
const VOLUME_MAX_R = 3;
const VOLUME_MAX_BYTES = 2 * 1_024 ** 3; // 2 GB+ maxes out the scale

const volumeRadius = (peer) => {
  const bytes = (peer.uploadBytes ?? 0) + (peer.downloadBytes ?? 0);
  if (bytes <= 0) return VOLUME_MIN_R;
  const t = Math.min(1, Math.sqrt(bytes / VOLUME_MAX_BYTES));
  return VOLUME_MIN_R + t * (VOLUME_MAX_R - VOLUME_MIN_R);
};

const flatFiles = (groups) =>
  (groups ?? []).flatMap((g) =>
    (g.directories ?? []).flatMap((d) => d.files ?? []),
  );

const WorldMap = ({
  direction = 'all',
  downloads,
  pastPeers = [],
  search = '',
  serverLat,
  serverLon,
  uploads,
  vpnOnly = false,
}) => {
  const geoCache = useRef({});
  const wrapRef = useRef(null);
  const [peerLocations, setPeerLocations] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [modalUser, setModalUser] = useState(null);
  const hideTimerRef = useRef(null);
  const [position, setPosition] = useState({ coordinates: [0, 15], zoom: 1 });
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  });

  const allPeers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [
      ...(direction === 'upload' ? [] : collectPeers(downloads, 'download')),
      ...(direction === 'download' ? [] : collectPeers(uploads, 'upload')),
    ]
      .filter(
        (p, index, array) => array.findIndex((q2) => q2.ip === p.ip) === index,
      )
      .filter((p) => !q || p.username?.toLowerCase().includes(q));
  }, [direction, downloads, search, uploads]);

  const peerKey = allPeers.map((p) => `${p.ip}:${p.active}`).join(',');

  useEffect(() => {
    if (allPeers.length === 0) return undefined;
    let cancelled = false;
    const lookupAll = async () => {
      const results = [];
      for (const peer of allPeers) {
        if (!geoCache.current[peer.ip]) {
          let lookedUp = null;
          try {
            lookedUp = await lookupIp(peer.ip);
          } catch {
            /* lookup failed — cache the miss */
          }

          // eslint-disable-next-line require-atomic-updates -- ref cache; last write wins is fine
          geoCache.current[peer.ip] = lookedUp;
        }

        const info = geoCache.current[peer.ip];
        if (info?.lat != null && info?.lon != null)
          results.push({
            ...peer,
            lat: info.lat,
            lon: info.lon,
            city: info.city,
            country: info.country,
            isVpn: info.isVpn,
          });
      }

      if (!cancelled) setPeerLocations(results);
    };

    lookupAll();
    return () => {
      cancelled = true;
    };
  }, [peerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveDownSpeed = useMemo(
    () =>
      flatFiles(downloads)
        .filter((f) => f.state === 'InProgress')
        .reduce((s, f) => s + (f.averageSpeed ?? 0), 0),
    [downloads],
  );

  const liveUpSpeed = useMemo(
    () =>
      flatFiles(uploads)
        .filter((f) => f.state === 'InProgress')
        .reduce((s, f) => s + (f.averageSpeed ?? 0), 0),
    [uploads],
  );

  const hasServer = serverLat != null && serverLon != null;
  const vpnFiltered = vpnOnly
    ? peerLocations.filter((p) => p.isVpn)
    : peerLocations;
  const activePeers = vpnFiltered.filter((p) => p.active && hasServer);
  const idlePeers = vpnFiltered.filter((p) => !p.active || !hasServer);
  const totalConnections = vpnFiltered.length;

  const showTooltip = (peer, e) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setTooltip({ peer, x: e.clientX, y: e.clientY });
  };

  const scheduleHide = () => {
    hideTimerRef.current = setTimeout(() => setTooltip(null), 120);
  };

  const cancelHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  const openUserModal = (peer, initialTab) => {
    if (!peer.username) return;
    cancelHide();
    setTooltip(null);
    setModalUser({
      username: peer.username,
      initialTab,
      seed: {
        ip: peer.ip,
        city: peer.city,
        country: peer.country,
        isVpn: peer.isVpn,
      },
    });
  };

  const handleZoomIn = () =>
    setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * 1.6, MAX_ZOOM) }));
  const handleZoomOut = () =>
    setPosition((p) => {
      const next = Math.max(p.zoom / 1.6, MIN_ZOOM);
      return {
        coordinates: next <= 1 ? [0, 15] : p.coordinates,
        zoom: next,
      };
    });

  const onMoveStart = () => setDragging(true);
  const onMoveEnd = ({ coordinates, zoom }) => {
    setDragging(false);
    setPosition({ coordinates, zoom });
  };

  // Markers/strokes live inside the zoom transform, so divide out the zoom
  // to keep them the same size on screen.
  const k = 1 / position.zoom;

  return (
    <div
      className="world-map-wrap"
      ref={wrapRef}
      style={{
        cursor: dragging ? 'grabbing' : 'crosshair',
        userSelect: dragging ? 'none' : undefined,
      }}
    >
      <ComposableMap
        projectionConfig={{
          rotate: [-10, 0, 0],
          scale: BASE_SCALE,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <ZoomableGroup
          center={position.coordinates}
          maxZoom={MAX_ZOOM}
          minZoom={MIN_ZOOM}
          onMoveEnd={onMoveEnd}
          onMoveStart={onMoveStart}
          translateExtent={[
            [0, 0],
            [800, 600],
          ]}
          zoom={position.zoom}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  geography={geo}
                  key={geo.rsmKey}
                  style={{
                    default: {
                      fill: 'var(--map-land)',
                      outline: 'none',
                      stroke: 'var(--map-border)',
                      strokeWidth: 0.4,
                      vectorEffect: 'non-scaling-stroke',
                    },
                    hover: { fill: 'var(--map-land-hover)', outline: 'none' },
                    pressed: { fill: 'var(--map-land)', outline: 'none' },
                  }}
                />
              ))
            }
          </Geographies>

          {/* Past connection dots — rendered first so active markers sit on top */}
          {pastPeers.map((peer) => (
            <Marker
              coordinates={[peer.lon, peer.lat]}
              key={`past-${peer.username}-${peer.ip}`}
              onMouseEnter={(e) =>
                showTooltip({ ...peer, direction: 'past', active: false }, e)
              }
              onMouseLeave={scheduleHide}
              style={{ cursor: 'crosshair' }}
            >
              <circle
                fill={recencyColor(peer.lastSeen)}
                opacity={0.9}
                r={volumeRadius(peer) * k}
              />
            </Marker>
          ))}

          {/* Arcs: server → active peers */}
          {activePeers.map((peer) => (
            <Line
              className={
                peer.direction === 'download' ? 'map-arc--dl' : 'map-arc--ul'
              }
              from={[serverLon, serverLat]}
              key={`arc-${peer.ip}`}
              stroke={
                peer.direction === 'download'
                  ? 'var(--map-arc-dl)'
                  : 'var(--map-arc-ul)'
              }
              strokeDasharray={`${6 * k} ${4 * k}`}
              strokeLinecap="round"
              strokeWidth={1.5 * k}
              to={[peer.lon, peer.lat]}
            />
          ))}

          {/* Idle peer dots */}
          {idlePeers.map((peer) => (
            <Marker
              coordinates={[peer.lon, peer.lat]}
              key={`idle-${peer.ip}`}
              onMouseEnter={(e) => showTooltip(peer, e)}
              onMouseLeave={scheduleHide}
              style={{ cursor: 'crosshair' }}
            >
              <circle
                fill={
                  peer.direction === 'download'
                    ? 'var(--map-arc-dl)'
                    : 'var(--map-arc-ul)'
                }
                opacity={0.85}
                r={4 * k}
                stroke="var(--map-dot-stroke)"
                strokeWidth={1.2 * k}
              />
            </Marker>
          ))}

          {/* Active peer dots */}
          {activePeers.map((peer) => (
            <Marker
              coordinates={[peer.lon, peer.lat]}
              key={`active-${peer.ip}`}
              onMouseEnter={(e) => showTooltip(peer, e)}
              onMouseLeave={scheduleHide}
              style={{ cursor: 'crosshair' }}
            >
              <circle
                className="map-peer-pulse"
                fill={
                  peer.direction === 'download'
                    ? 'var(--map-arc-dl)'
                    : 'var(--map-arc-ul)'
                }
                r={3 * k}
                stroke="var(--map-dot-stroke)"
                strokeWidth={Number(k)}
              />
            </Marker>
          ))}

          {/* Server marker */}
          {hasServer && (
            <Marker coordinates={[serverLon, serverLat]}>
              <circle
                fill="#fff"
                opacity={0.95}
                r={2.5 * k}
              />
              <circle
                className="map-server-ring"
                fill="none"
                opacity={0.3}
                r={5 * k}
                stroke="#fff"
                strokeWidth={Number(k)}
              />
            </Marker>
          )}
        </ZoomableGroup>
      </ComposableMap>

      {/* Stats overlay — bottom left */}
      <div className="map-overlay">
        <div className="map-overlay-stat">
          <span className="map-overlay-label">Connections</span>
          <span className="map-overlay-value">{totalConnections}</span>
        </div>
        {activePeers.length > 0 && (
          <div className="map-overlay-stat">
            <span className="map-overlay-label">Active</span>
            <span className="map-overlay-value map-overlay-active">
              {activePeers.length}
            </span>
          </div>
        )}
        {liveDownSpeed > 0 && (
          <div className="map-overlay-stat">
            <span className="map-overlay-label">↓</span>
            <span className="map-overlay-value map-overlay-dl">
              {formatBytes(liveDownSpeed)}/s
            </span>
          </div>
        )}
        {liveUpSpeed > 0 && (
          <div className="map-overlay-stat">
            <span className="map-overlay-label">↑</span>
            <span className="map-overlay-value map-overlay-ul">
              {formatBytes(liveUpSpeed)}/s
            </span>
          </div>
        )}
      </div>

      {/* Recency legend — top right */}
      <div className="map-legend">
        <div className="map-legend-title">Last seen</div>
        {RECENCY_BUCKETS.map((bucket) => (
          <div
            className="map-legend-item"
            key={bucket.label}
          >
            <span
              className="map-legend-dot"
              style={{ background: bucket.color }}
            />
            {bucket.label}
          </div>
        ))}
        <div className="map-legend-divider" />
        <div className="map-legend-item">
          <span
            className="map-legend-dot"
            style={{ background: 'var(--map-arc-dl)' }}
          />
          Download
        </div>
        <div className="map-legend-item">
          <span
            className="map-legend-dot"
            style={{ background: 'var(--map-arc-ul)' }}
          />
          Upload
        </div>
        <div className="map-legend-divider" />
        <div className="map-legend-title">Size = data transferred</div>
        <div className="map-legend-item map-legend-item--size">
          <span
            className="map-legend-dot map-legend-dot--size-sm"
            style={{ background: 'var(--map-dot-past)' }}
          />
          <span
            className="map-legend-dot map-legend-dot--size-md"
            style={{ background: 'var(--map-dot-past)' }}
          />
          <span
            className="map-legend-dot map-legend-dot--size-lg"
            style={{ background: 'var(--map-dot-past)' }}
          />
        </div>
      </div>

      {/* Zoom controls — bottom right */}
      <div className="map-zoom">
        <button
          className="map-zoom-btn"
          onClick={handleZoomIn}
          title="Zoom in"
          type="button"
        >
          +
        </button>
        <button
          className="map-zoom-btn"
          onClick={handleZoomOut}
          title="Zoom out"
          type="button"
        >
          −
        </button>
      </div>

      {tooltip &&
        (() => {
          const p = tooltip.peer;
          const uploadBytes = p.uploadBytes ?? 0;
          const downloadBytes = p.downloadBytes ?? 0;
          const uploadCount = p.uploadCount ?? 0;
          const downloadCount = p.downloadCount ?? 0;
          const browseCount = p.browseCount ?? 0;
          const chatCount = p.chatCount ?? 0;
          const lastSeen = parseUtcDate(p.lastSeen);
          const lastSeenString = lastSeen
            ? lastSeen.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : null;
          const left = Math.max(
            8,
            Math.min(tooltip.x + 14, window.innerWidth - TOOLTIP_W - 8),
          );
          const top = Math.max(
            8,
            Math.min(tooltip.y - 10, window.innerHeight - TOOLTIP_H - 8),
          );
          return (
            <div
              className="map-tooltip"
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={cancelHide}
              onMouseLeave={() => setTooltip(null)}
              style={{ left, top }}
            >
              <div className="map-tooltip-header">
                <span className="map-tooltip-user">{p.username}</span>
                {p.isVpn ? <span className="map-tooltip-vpn">VPN</span> : null}
                {p.active && <span className="map-tooltip-active">●</span>}
              </div>

              <div className="map-tooltip-meta">
                {p.city && (
                  <div className="map-tooltip-meta-row">
                    <span className="map-tooltip-meta-label">City</span>
                    {p.city}
                  </div>
                )}
                {p.country && (
                  <div className="map-tooltip-meta-row">
                    <span className="map-tooltip-meta-label">Country</span>
                    {p.country}
                  </div>
                )}
                {p.ip && (
                  <div className="map-tooltip-meta-row">
                    <span className="map-tooltip-meta-label">IP</span>
                    <code className="map-tooltip-ip">{p.ip}</code>
                  </div>
                )}
              </div>

              {(uploadCount > 0 ||
                downloadCount > 0 ||
                browseCount > 0 ||
                chatCount > 0) && (
                <div className="map-tooltip-stats">
                  {(uploadCount > 0 || uploadBytes > 0) && (
                    <div className="map-tooltip-stat">
                      <span className="map-tooltip-stat-icon">↑</span>
                      <span>
                        {uploadCount} file{uploadCount !== 1 ? 's' : ''}
                      </span>
                      <span className="map-tooltip-stat-bytes">
                        {formatBytes(uploadBytes)}
                      </span>
                    </div>
                  )}
                  {(downloadCount > 0 || downloadBytes > 0) && (
                    <div className="map-tooltip-stat">
                      <span className="map-tooltip-stat-icon">↓</span>
                      <span>
                        {downloadCount} file{downloadCount !== 1 ? 's' : ''}
                      </span>
                      <span className="map-tooltip-stat-bytes">
                        {formatBytes(downloadBytes)}
                      </span>
                    </div>
                  )}
                  {browseCount > 0 && (
                    <div className="map-tooltip-stat">
                      <span className="map-tooltip-stat-icon">👁</span>
                      <span>
                        {browseCount} browse{browseCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  {chatCount > 0 && (
                    <div className="map-tooltip-stat">
                      <span className="map-tooltip-stat-icon">💬</span>
                      <span>
                        {chatCount} message{chatCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {lastSeenString && (
                <div className="map-tooltip-lastseen">
                  Last seen {lastSeenString}
                </div>
              )}

              {p.username && (
                <div className="map-tooltip-actions">
                  <button
                    className="map-tooltip-action"
                    onClick={() => openUserModal(p, 'overview')}
                    type="button"
                  >
                    View user
                  </button>
                </div>
              )}
            </div>
          );
        })()}

      {modalUser && (
        <UserReportModal
          initialTab={modalUser.initialTab}
          onClose={() => setModalUser(null)}
          seed={modalUser.seed}
          username={modalUser.username}
        />
      )}
    </div>
  );
};

export default WorldMap;
