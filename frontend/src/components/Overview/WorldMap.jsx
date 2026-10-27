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

import { formatBitrate, parseUtcDate } from '../../lib/util';
import { locateLivePeers } from '../Map/mapData';
import UsernameLink from '../Shared/UsernameLink';
import UserReportWindow from './UserReportWindow';
import React, {
  useCallback,
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

// 110m resolution has ~10x fewer vertices than 50m, which dominates paint
// cost when the whole world (plus thousands of dots) is visible. Zoomed in,
// most geometry clips out but 110m borders look chunky — so swap detail by
// zoom level, with hysteresis so crossing the threshold doesn't ping-pong.
const GEO_URL_110 =
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const GEO_URL_50 =
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const DETAIL_ZOOM_IN = 4; // switch to 50m at or above this zoom
const DETAIL_ZOOM_OUT = 2.5; // back to 110m at or below this zoom
const BASE_SCALE = 160;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 24;
const LOG_MIN_ZOOM = Math.log(MIN_ZOOM);
const LOG_MAX_ZOOM = Math.log(MAX_ZOOM);
const TOOLTIP_W = 260;
const TOOLTIP_H = 280;

// Hoisted so the React.memo on Geography isn't defeated by a fresh style
// object every render — otherwise all ~180 country paths re-render (and
// recompute their d3 path strings) on every state change.
const GEO_STYLE = {
  default: {
    fill: 'var(--map-land)',
    outline: 'none',
    stroke: 'var(--map-border)',
    strokeWidth: 0.4,
    vectorEffect: 'non-scaling-stroke',
  },
  hover: { fill: 'var(--map-land-hover)', outline: 'none' },
  pressed: { fill: 'var(--map-land)', outline: 'none' },
};

// Markers/strokes live inside the zoom transform, so they must be divided by
// the zoom to keep a constant on-screen size. Doing that through a CSS custom
// property (--map-k, set on the wrapper div) instead of React props means a
// zoom change is just a style recalc — the marker layers (potentially
// thousands of nodes) are memoized and never re-render for zoom.
const kx = (px) => `calc(${px}px * var(--map-k, 1))`;

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
  // Cache local batches and fallback misses for the lifetime of this map.
  const geoCache = useRef(new Map());
  const wrapRef = useRef(null);
  const [peerLocations, setPeerLocations] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [reportUser, setReportUser] = useState(null);
  const hideTimerRef = useRef(null);
  const moveFrameRef = useRef(null);
  const [position, setPosition] = useState({ coordinates: [0, 15], zoom: 1 });
  // Tracks the zoom live during wheel/pinch gestures (position.zoom only
  // updates on gesture end); drives --map-k and the slider position.
  const [liveZoom, setLiveZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [geoUrl, setGeoUrl] = useState(GEO_URL_110);

  useEffect(() => {
    if (liveZoom >= DETAIL_ZOOM_IN) setGeoUrl(GEO_URL_50);
    else if (liveZoom <= DETAIL_ZOOM_OUT) setGeoUrl(GEO_URL_110);
  }, [liveZoom]);

  useLayoutEffect(() => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  }, []);

  useEffect(
    () => () => {
      if (moveFrameRef.current != null)
        cancelAnimationFrame(moveFrameRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const allPeers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const seen = new Set();
    return [
      ...(direction === 'upload' ? [] : collectPeers(downloads, 'download')),
      ...(direction === 'download' ? [] : collectPeers(uploads, 'upload')),
    ].filter((p) => {
      if (seen.has(p.ip)) return false;
      seen.add(p.ip);
      return !q || p.username?.toLowerCase().includes(q);
    });
  }, [direction, downloads, search, uploads]);

  const peerKey = allPeers
    .map((p) => `${p.ip}:${p.username}:${p.direction}:${p.active}`)
    .join(',');

  useEffect(() => {
    const controller = new AbortController();
    if (allPeers.length === 0) setPeerLocations([]);
    else
      locateLivePeers(
        allPeers,
        geoCache.current,
        controller.signal,
        (locations) => {
          if (!controller.signal.aborted) setPeerLocations(locations);
        },
      )
        .then((locations) => {
          if (!controller.signal.aborted) setPeerLocations(locations);
        })
        .catch(() => {
          /* Keep existing locations if the network is unavailable. */
        });
    return () => controller.abort();
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
  const vpnFiltered = useMemo(
    () => (vpnOnly ? peerLocations.filter((p) => p.isVpn) : peerLocations),
    [peerLocations, vpnOnly],
  );
  const activePeers = useMemo(
    () => vpnFiltered.filter((p) => p.active && hasServer),
    [hasServer, vpnFiltered],
  );
  const idlePeers = useMemo(
    () => vpnFiltered.filter((p) => !p.active || !hasServer),
    [hasServer, vpnFiltered],
  );
  const totalConnections = vpnFiltered.length;

  // Stable references so the memoized marker layers below survive re-renders.
  const showTooltip = useCallback((peer, e) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setTooltip({ peer, x: e.clientX, y: e.clientY });
  }, []);

  const scheduleHide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setTooltip(null), 120);
  }, []);

  const cancelHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  // The report is hosted here rather than by the tooltip's UsernameLink so the
  // tooltip can be dismissed as the modal opens — otherwise it would sit on top
  // of the modal, and unmounting it would take the modal down with it. The dot
  // already resolved this peer's geo, so seed the modal to skip a repeat lookup.
  const openReport = (peer) => {
    if (!peer.username) return;
    cancelHide();
    setTooltip(null);
    setReportUser({
      username: peer.username,
      seed: {
        ip: peer.ip,
        city: peer.city,
        country: peer.country,
        isVpn: peer.isVpn,
      },
    });
  };

  const applyZoom = useCallback((zoom) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    setLiveZoom(next);
    setPosition((p) => ({
      coordinates: next <= 1 ? [0, 15] : p.coordinates,
      zoom: next,
    }));
  }, []);

  const handleZoomIn = () => applyZoom(liveZoom * 1.6);
  const handleZoomOut = () => applyZoom(liveZoom / 1.6);

  const onMoveStart = () => setDragging(true);
  // d3-zoom fires per gesture tick; coalesce to one state update per frame so
  // the marker counter-scaling tracks wheel/pinch live without a render storm.
  const onMove = ({ zoom }) => {
    if (moveFrameRef.current != null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      setLiveZoom(zoom);
    });
  };

  const onMoveEnd = ({ coordinates, zoom }) => {
    if (moveFrameRef.current != null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }

    setDragging(false);
    setLiveZoom(zoom);
    setPosition({ coordinates, zoom });
  };

  // Layers are memoized so tooltip hovers, zoom changes, and the 5s transfer
  // poll don't re-render every country path and peer marker. On-screen sizes
  // stay constant across zoom via --map-k (see kx above).
  const geographyLayer = useMemo(
    () => (
      <Geographies geography={geoUrl}>
        {({ geographies }) =>
          geographies.map((geo) => (
            <Geography
              geography={geo}
              key={geo.rsmKey}
              style={GEO_STYLE}
            />
          ))
        }
      </Geographies>
    ),
    [geoUrl],
  );

  // Past connection dots — rendered first so active markers sit on top
  const pastLayer = useMemo(
    () =>
      pastPeers.map((peer) => (
        <Marker
          coordinates={[peer.lon, peer.lat]}
          key={`past-${peer.username}-${peer.ip}`}
          onMouseEnter={(e) =>
            showTooltip({ ...peer, direction: 'past', active: false }, e)
          }
          onMouseLeave={scheduleHide}
        >
          <circle
            fill={recencyColor(peer.lastSeen)}
            opacity={0.9}
            r={volumeRadius(peer)}
            style={{ r: kx(volumeRadius(peer)) }}
          />
        </Marker>
      )),
    [pastPeers, scheduleHide, showTooltip],
  );

  // Arcs: server → active peers
  const arcLayer = useMemo(
    () =>
      hasServer
        ? activePeers.map((peer) => (
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
              strokeLinecap="round"
              strokeWidth={1.5}
              style={{
                strokeDasharray: `${kx(6)} ${kx(4)}`,
                strokeWidth: kx(1.5),
              }}
              to={[peer.lon, peer.lat]}
            />
          ))
        : null,
    [activePeers, hasServer, serverLat, serverLon],
  );

  // Idle peer dots
  const idleLayer = useMemo(
    () =>
      idlePeers.map((peer) => (
        <Marker
          coordinates={[peer.lon, peer.lat]}
          key={`idle-${peer.ip}`}
          onMouseEnter={(e) => showTooltip(peer, e)}
          onMouseLeave={scheduleHide}
        >
          <circle
            fill={
              peer.direction === 'download'
                ? 'var(--map-arc-dl)'
                : 'var(--map-arc-ul)'
            }
            opacity={0.85}
            r={4}
            stroke="var(--map-dot-stroke)"
            strokeWidth={1.2}
            style={{ r: kx(4), strokeWidth: kx(1.2) }}
          />
        </Marker>
      )),
    [idlePeers, scheduleHide, showTooltip],
  );

  // Active peer dots
  const activeLayer = useMemo(
    () =>
      activePeers.map((peer) => (
        <Marker
          coordinates={[peer.lon, peer.lat]}
          key={`active-${peer.ip}`}
          onMouseEnter={(e) => showTooltip(peer, e)}
          onMouseLeave={scheduleHide}
        >
          <circle
            className="map-peer-pulse"
            fill={
              peer.direction === 'download'
                ? 'var(--map-arc-dl)'
                : 'var(--map-arc-ul)'
            }
            r={3}
            stroke="var(--map-dot-stroke)"
            strokeWidth={1}
            style={{ r: kx(3), strokeWidth: kx(1) }}
          />
        </Marker>
      )),
    [activePeers, scheduleHide, showTooltip],
  );

  const serverLayer = useMemo(
    () =>
      hasServer ? (
        <Marker coordinates={[serverLon, serverLat]}>
          <circle
            fill="#fff"
            opacity={0.95}
            r={2.5}
            style={{ r: kx(2.5) }}
          />
          <circle
            className="map-server-ring"
            fill="none"
            opacity={0.3}
            r={5}
            stroke="#fff"
            strokeWidth={1}
            style={{ r: kx(5), strokeWidth: kx(1) }}
          />
        </Marker>
      ) : null,
    [hasServer, serverLat, serverLon],
  );

  return (
    <div
      className="world-map-wrap"
      ref={wrapRef}
      style={{
        '--map-k': 1 / liveZoom,
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
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          onMoveStart={onMoveStart}
          translateExtent={[
            [0, 0],
            [800, 600],
          ]}
          zoom={position.zoom}
        >
          {geographyLayer}
          {pastLayer}
          {arcLayer}
          {idleLayer}
          {activeLayer}
          {serverLayer}
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
              {formatBitrate(liveDownSpeed)}
            </span>
          </div>
        )}
        {liveUpSpeed > 0 && (
          <div className="map-overlay-stat">
            <span className="map-overlay-label">↑</span>
            <span className="map-overlay-value map-overlay-ul">
              {formatBitrate(liveUpSpeed)}
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
        <input
          aria-label="Zoom level"
          className="map-zoom-slider"
          max={LOG_MAX_ZOOM}
          min={LOG_MIN_ZOOM}
          onChange={(e) => applyZoom(Math.exp(Number(e.target.value)))}
          step="any"
          title="Zoom"
          type="range"
          value={Math.log(liveZoom)}
        />
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
              <button
                aria-label="Close"
                className="map-tooltip-close"
                onClick={() => setTooltip(null)}
                type="button"
              >
                ✕
              </button>

              <div className="map-tooltip-header">
                {p.username ? (
                  <UsernameLink
                    className="map-tooltip-user"
                    onReport={() => openReport(p)}
                    username={p.username}
                  />
                ) : (
                  <span className="map-tooltip-user">Unknown</span>
                )}
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

              {lastSeenString && (
                <div className="map-tooltip-lastseen">
                  Last seen {lastSeenString}
                </div>
              )}
            </div>
          );
        })()}
      {reportUser && (
        <UserReportWindow
          onClose={() => setReportUser(null)}
          seed={reportUser.seed}
          username={reportUser.username}
        />
      )}
    </div>
  );
};

export default WorldMap;
