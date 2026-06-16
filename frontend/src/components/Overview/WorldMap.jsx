import { lookupIp } from '../../lib/network';
import { formatBytes, parseUtcDate } from '../../lib/util';
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
const MAX_ZOOM = 6;
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

const flatFiles = (groups) =>
  (groups ?? []).flatMap((g) =>
    (g.directories ?? []).flatMap((d) => d.files ?? []),
  );

const WorldMap = ({
  downloads,
  pastPeers = [],
  serverLat,
  serverLon,
  uploads,
}) => {
  const geoCache = useRef({});
  const wrapRef = useRef(null);
  const [peerLocations, setPeerLocations] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const hideTimerRef = useRef(null);
  const [position, setPosition] = useState({ coordinates: [0, 15], zoom: 1 });
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const svg = wrapRef.current?.querySelector('svg');
    if (svg) svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  });

  const allPeers = useMemo(
    () =>
      [
        ...collectPeers(downloads, 'download'),
        ...collectPeers(uploads, 'upload'),
      ].filter(
        (p, index, array) => array.findIndex((q) => q.ip === p.ip) === index,
      ),
    [downloads, uploads],
  );

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
  const activePeers = peerLocations.filter((p) => p.active && hasServer);
  const idlePeers = peerLocations.filter((p) => !p.active || !hasServer);
  const totalConnections = peerLocations.length;

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
                r={1.4 * k}
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
          const base = (window.urlBase === '/' ? '' : window.urlBase) || '';
          const userQ = encodeURIComponent(p.username ?? '');
          const browseUrl = `${base}/browse?user=${userQ}`;
          const chatUrl = `${base}/chat?user=${userQ}`;
          const uploadsUrl = `${base}/overview?user=${userQ}`;
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
                {p.isVpn === 1 && <span className="map-tooltip-vpn">VPN</span>}
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
                  <a
                    className="map-tooltip-action"
                    href={browseUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Browse files
                  </a>
                  <a
                    className="map-tooltip-action"
                    href={chatUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Chat
                  </a>
                  <a
                    className="map-tooltip-action"
                    href={uploadsUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Uploads
                  </a>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
};

export default WorldMap;
