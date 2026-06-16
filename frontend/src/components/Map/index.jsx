/* eslint-disable canonical/filename-match-exported */
import './Map.css';
import * as networkAPI from '../../lib/network';
import * as optionsAPI from '../../lib/options';
import * as reportsAPI from '../../lib/reports';
import * as transfersAPI from '../../lib/transfers';
import WorldMap from '../Overview/WorldMap';
import React, { useEffect, useState } from 'react';

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

const MapPage = () => {
  const [downloads, setDownloads] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [serverLat, setServerLat] = useState(null);
  const [serverLon, setServerLon] = useState(null);
  const [range, setRange] = useState(24);
  const [pastPeers, setPastPeers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

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
          setDownloads(d ?? []);
          setUploads(u ?? []);
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
    const end = new Date().toISOString();
    const start = new Date(Date.now() - range * 60 * 60 * 1_000).toISOString();

    const load = async () => {
      try {
        const { items } = await reportsAPI.getUserList({
          start,
          end,
          limit: 500,
          sortBy: 'LastSeen',
        });
        if (cancelled) return;

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
  }, [range]);

  return (
    <div className="map-page">
      <div className="map-controls">
        <span className="map-controls-label">Range</span>
        <div className="map-controls-pills">
          {RANGES.map((r) => (
            <button
              className={`map-pill${range === r.hours ? ' active' : ''}`}
              key={r.hours}
              onClick={() => setRange(r.hours)}
              type="button"
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="map-controls-count">
          {loading && <span className="map-controls-loading">Loading…</span>}
          {resolving && (
            <span className="map-controls-loading">Resolving locations…</span>
          )}
          {!loading &&
            !resolving &&
            pastPeers.length > 0 &&
            `${pastPeers.length} peers`}
        </span>
      </div>

      <div className="map-canvas">
        <WorldMap
          downloads={downloads}
          pastPeers={pastPeers}
          serverLat={serverLat}
          serverLon={serverLon}
          uploads={uploads}
        />
      </div>
    </div>
  );
};

export default MapPage;
