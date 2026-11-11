import 'leaflet/dist/leaflet.css';
import './StreetMap.css';
import { formatBitrate, formatBytes, parseUtcDate } from '../../lib/util';
import UserReportWindow from '../Overview/UserReportWindow';
import { clusterVisiblePeers, isLocated } from './location';
import { locateLivePeers } from './mapData';
import L from 'leaflet';
import React, { useEffect, useMemo, useRef, useState } from 'react';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAX_ZOOM = 19;
const CELL_SIZE = 42;
const peerId = (peer) => `${peer.direction}:${peer.username}:${peer.ip}`;
const distance = (a, b) => Math.abs(a.lat - b.lat) + Math.abs(a.lon - b.lon);
const recencyKind = (lastSeen) => {
  const date = parseUtcDate(lastSeen);
  const ageHours = date
    ? (Date.now() - date.getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  if (ageHours < 1) return 'recent';
  if (ageHours < 24) return 'day';
  if (ageHours < 168) return 'week';
  return 'past';
};

const collectLive = (groups, direction) =>
  (groups ?? [])
    .filter((group) => group.peerAddress)
    .map((group) => ({
      ip: group.peerAddress,
      username: group.username,
      direction,
      active: (group.directories ?? []).some((directory) =>
        (directory.files ?? []).some((file) => file.state === 'InProgress'),
      ),
    }));

const markerIcon = (count, kind, selected) =>
  L.divIcon({
    className: `street-peer street-peer--${kind}${count > 1 ? ' street-peer--cluster' : ''}${selected ? ' street-peer--selected' : ''}`,
    html: `<span class="street-peer-cross"></span><span class="street-peer-core">${count > 1 ? count : ''}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

const locationIcon = (confirmed) =>
  L.divIcon({
    className: 'street-origin',
    html: `<span class="street-origin-cross"></span><span class="street-origin-label">${confirmed ? 'My location' : 'Server estimate'}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

const StreetMap = ({
  direction,
  downloads,
  onPickLocation,
  origin,
  originConfirmed,
  pastPeers,
  pickingLocation,
  search,
  uploads,
  vpnOnly,
}) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const originLayerRef = useRef(null);
  const geoCache = useRef(new Map());
  const centeredRef = useRef(false);
  const previousOriginRef = useRef(null);
  const [zoom, setZoom] = useState(3);
  const [viewVersion, setViewVersion] = useState(0);
  const [livePeers, setLivePeers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [reportPeer, setReportPeer] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [tileError, setTileError] = useState(false);

  const liveCandidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    const seen = new Set();
    return [
      ...(direction === 'upload' ? [] : collectLive(downloads, 'download')),
      ...(direction === 'download' ? [] : collectLive(uploads, 'upload')),
    ].filter((peer) => {
      if (seen.has(peer.ip)) return false;
      seen.add(peer.ip);
      return !query || peer.username?.toLowerCase().includes(query);
    });
  }, [direction, downloads, search, uploads]);
  const liveKey = liveCandidates
    .map(
      (peer) => `${peer.ip}:${peer.username}:${peer.direction}:${peer.active}`,
    )
    .join(',');

  useEffect(() => {
    const controller = new AbortController();
    if (liveCandidates.length === 0) setLivePeers([]);
    else
      locateLivePeers(
        liveCandidates,
        geoCache.current,
        controller.signal,
        (locatedPeers) => {
          if (!controller.signal.aborted) setLivePeers(locatedPeers);
        },
      )
        .then((locatedPeers) => {
          if (!controller.signal.aborted) setLivePeers(locatedPeers);
        })
        .catch(() => {});
    return () => controller.abort();
  }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const peers = useMemo(
    () => [
      ...pastPeers
        .filter(isLocated)
        .map((peer) => ({ ...peer, direction: 'past', active: false })),
      ...livePeers.filter(
        (peer) => isLocated(peer) && (!vpnOnly || peer.isVpn),
      ),
    ],
    [livePeers, pastPeers, vpnOnly],
  );
  const selectedPeer = peers.find((peer) => peerId(peer) === selectedId);
  const nearbyPeers = selectedPeer
    ? peers
        .filter((peer) => distance(peer, selectedPeer) < 0.002)
        .sort(
          (a, b) =>
            Number(peerId(b) === selectedId) - Number(peerId(a) === selectedId),
        )
    : [];

  useEffect(() => {
    const map = new L.Map(containerRef.current, {
      center: [20, 0],
      zoom: 3,
      zoomControl: false,
      preferCanvas: true,
      maxZoom: MAX_ZOOM,
      worldCopyJump: true,
    });
    const tiles = L.tileLayer(TILE_URL, {
      maxZoom: MAX_ZOOM,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    });
    tiles.on('tileerror', () => setTileError(true));
    tiles.on('tileload', () => setTileError(false));
    tiles.addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    originLayerRef.current = L.layerGroup().addTo(map);
    map.on('zoomend', () => setZoom(map.getZoom()));
    mapRef.current = map;
    setMapReady(true);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      originLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    originLayerRef.current.clearLayers();
    if (!origin || !isLocated(origin)) return;
    for (const peer of livePeers.filter(
      (item) => item.active && isLocated(item),
    )) {
      L.polyline(
        [
          [origin.lat, origin.lon],
          [peer.lat, peer.lon],
        ],
        {
          color: peer.direction === 'download' ? '#52a3ff' : '#44d39a',
          weight: 1.5,
          opacity: 0.55,
          interactive: false,
        },
      ).addTo(originLayerRef.current);
    }

    L.marker([origin.lat, origin.lon], {
      icon: locationIcon(originConfirmed),
      keyboard: false,
      zIndexOffset: -1_000,
    }).addTo(originLayerRef.current);
    const originKey = `${origin.lat}:${origin.lon}`;
    if (!centeredRef.current || previousOriginRef.current !== originKey) {
      map.setView(
        [origin.lat, origin.lon],
        centeredRef.current ? Math.max(map.getZoom(), 5) : 4,
      );
      centeredRef.current = true;
    }

    previousOriginRef.current = originKey;
  }, [livePeers, mapReady, origin, originConfirmed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const handleClick = (event) =>
      onPickLocation?.(event.latlng.lat, event.latlng.lng);
    if (pickingLocation) map.on('click', handleClick);
    map.getContainer().classList.toggle('street-map--picking', pickingLocation);
    return () => map.off('click', handleClick);
  }, [mapReady, onPickLocation, pickingLocation]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds = map.getBounds().pad(0.2);
    const groups = clusterVisiblePeers(
      peers,
      bounds,
      (latlng, level) => map.project(latlng, level),
      zoom,
      CELL_SIZE,
    );
    for (const group of groups) {
      const lead =
        group.find((peer) => peerId(peer) === selectedId) ?? group[0];
      const kind =
        group.length > 1
          ? 'group'
          : lead.active
            ? 'active'
            : lead.direction === 'past'
              ? recencyKind(lead.lastSeen)
              : lead.direction;
      const marker = L.marker([lead.lat, lead.lon], {
        icon: markerIcon(
          group.length,
          kind,
          group.some((peer) => peerId(peer) === selectedId),
        ),
        keyboard: group.length === 1,
        title:
          group.length > 1
            ? `${group.length} peers. Click to zoom in.`
            : `${lead.username || 'Unknown peer'}. Click for details.`,
        bubblingMouseEvents: false,
      });
      marker.on('click', () => {
        if (group.length === 1 || map.getZoom() >= MAX_ZOOM) {
          setSelectedId(peerId(lead));
          return;
        }

        const clusterBounds = L.latLngBounds(
          group.map((peer) => [peer.lat, peer.lon]),
        );
        if (clusterBounds.getNorthEast().equals(clusterBounds.getSouthWest()))
          map.setView(
            [lead.lat, lead.lon],
            Math.min(MAX_ZOOM, map.getZoom() + 3),
          );
        else
          map.fitBounds(clusterBounds.pad(0.5), {
            maxZoom: Math.min(MAX_ZOOM, map.getZoom() + 4),
          });
      });
      marker.addTo(layer);
    }
  }, [mapReady, peers, selectedId, viewVersion, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const refresh = () => setViewVersion((value) => value + 1);
    map.on('moveend', refresh);
    return () => map.off('moveend', refresh);
  }, [mapReady]);

  const zoomTo = (peer) =>
    mapRef.current?.flyTo(
      [peer.lat, peer.lon],
      Math.max(mapRef.current.getZoom(), 16),
    );
  const showPeers = () => {
    const map = mapRef.current;
    if (!map || peers.length === 0) return;
    if (peers.length === 1) {
      map.flyTo([peers[0].lat, peers[0].lon], 14);
      return;
    }

    map.fitBounds(L.latLngBounds(peers.map((peer) => [peer.lat, peer.lon])), {
      padding: [36, 36],
      maxZoom: 14,
    });
  };

  const zoomHome = () => {
    if (origin && isLocated(origin))
      mapRef.current?.flyTo(
        [origin.lat, origin.lon],
        Math.max(mapRef.current.getZoom(), 12),
      );
  };

  return (
    <div className="street-map-wrap">
      <div
        aria-label="Interactive street map"
        className="street-map"
        ref={containerRef}
      />
      {!reportPeer && (
        <div className="street-map-tools">
          <span>
            Street map · Peer points are approximate IP locations · Click
            targets for details
          </span>
          {peers.length > 0 && (
            <button
              onClick={showPeers}
              type="button"
            >
              Show peers
            </button>
          )}
          {origin && (
            <button
              onClick={zoomHome}
              type="button"
            >
              ⌖ {originConfirmed ? 'My location' : 'Server estimate'}
            </button>
          )}
        </div>
      )}
      {tileError && !reportPeer && (
        <div
          className="street-map-error"
          role="status"
        >
          Street tiles could not load. Check the connection and try again.
        </div>
      )}
      {!reportPeer && (
        <div className="street-map-stats">
          <span>{peers.length} located peers</span>
          <span>{peers.filter((peer) => peer.active).length} active</span>
          <span>
            ↓{' '}
            {formatBitrate(
              (downloads ?? [])
                .flatMap((group) => group.directories ?? [])
                .flatMap((directory) => directory.files ?? [])
                .filter((file) => file.state === 'InProgress')
                .reduce((total, file) => total + (file.averageSpeed ?? 0), 0),
            )}
          </span>
          <span>
            ↑{' '}
            {formatBitrate(
              (uploads ?? [])
                .flatMap((group) => group.directories ?? [])
                .flatMap((directory) => directory.files ?? [])
                .filter((file) => file.state === 'InProgress')
                .reduce((total, file) => total + (file.averageSpeed ?? 0), 0),
            )}
          </span>
        </div>
      )}
      {selectedPeer && !reportPeer && (
        <aside
          aria-label="Selected peer"
          className="street-selection"
        >
          <div className="street-selection-head">
            <div>
              <span>Selected peer</span>
              <h3>{selectedPeer.username || 'Unknown peer'}</h3>
            </div>
            <button
              aria-label="Close peer details"
              onClick={() => setSelectedId(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <p>
            {[selectedPeer.city, selectedPeer.country]
              .filter(Boolean)
              .join(', ') || 'Location unavailable'}
            {selectedPeer.isVpn ? ' · VPN' : ''}
          </p>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>
                {selectedPeer.active
                  ? 'Active now'
                  : selectedPeer.lastSeen
                    ? parseUtcDate(selectedPeer.lastSeen)?.toLocaleString()
                    : '—'}
              </dd>
            </div>
            <div>
              <dt>IP address</dt>
              <dd>{selectedPeer.ip || '—'}</dd>
            </div>
            {selectedPeer.direction === 'past' && (
              <>
                <div>
                  <dt>Downloaded</dt>
                  <dd>{formatBytes(selectedPeer.downloadBytes ?? 0)}</dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd>{formatBytes(selectedPeer.uploadBytes ?? 0)}</dd>
                </div>
              </>
            )}
          </dl>
          {nearbyPeers.length > 1 && (
            <div className="street-selection-nearby">
              <span>At this point ({nearbyPeers.length})</span>
              <div>
                {nearbyPeers.slice(0, 24).map((peer) => (
                  <button
                    className={peerId(peer) === selectedId ? 'active' : ''}
                    key={peerId(peer)}
                    onClick={() => setSelectedId(peerId(peer))}
                    type="button"
                  >
                    {peer.username}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="street-selection-actions">
            <button
              onClick={() => zoomTo(selectedPeer)}
              type="button"
            >
              Zoom to point
            </button>
            {selectedPeer.username && (
              <button
                onClick={() => setReportPeer(selectedPeer)}
                type="button"
              >
                Full user report ↗
              </button>
            )}
          </div>
        </aside>
      )}
      {reportPeer && (
        <button
          aria-label="Close user report"
          className="street-report-backdrop"
          onClick={() => setReportPeer(null)}
          tabIndex={-1}
          type="button"
        />
      )}
      {reportPeer && (
        <UserReportWindow
          onClose={() => setReportPeer(null)}
          seed={{
            ip: reportPeer.ip,
            city: reportPeer.city,
            country: reportPeer.country,
            isVpn: reportPeer.isVpn,
          }}
          username={reportPeer.username}
          variant="map"
        />
      )}
    </div>
  );
};

export default StreetMap;
