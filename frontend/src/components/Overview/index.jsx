import './Overview.css';
import * as eventsAPI from '../../lib/events';
import * as prefs from '../../lib/prefs';
import * as reportsAPI from '../../lib/reports';
import * as sharesAPI from '../../lib/shares';
import * as transfersAPI from '../../lib/transfers';
import ActivityChart from './ActivityChart';
import ErrorChart from './ErrorChart';
import FileTypeChart from './FileTypeChart';
import KpiCards from './KpiCards';
import NotificationFeed from './NotificationFeed';
import PopularDirectories from './PopularDirectories';
import TopFiles from './TopFiles';
import TransferHealth from './TransferHealth';
import UserLeaderboard from './UserLeaderboard';
import UserReports from './UserReports';
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// Range values are in hours
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

const DIRECTION_OPTIONS = [
  { label: 'Both', value: null },
  { label: 'Downloads', value: 'download' },
  { label: 'Uploads', value: 'upload' },
];

// Refresh interval values are in milliseconds; 0 = off
const REFRESH_OPTIONS = [
  { label: 'Off', ms: 0 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '15m', ms: 900_000 },
];

const getHistogramInterval = (hours) => {
  if (hours <= 1) return 1;
  if (hours <= 6) return 5;
  if (hours <= 24) return 15;
  if (hours <= 168) return 180;
  if (hours <= 720) return 1_440;
  if (hours <= 2_160) return 4_320;
  if (hours <= 4_320) return 8_640;
  return 14_400;
};

const flattenTransfers = (groups) => {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g) =>
    (g.directories ?? []).flatMap((d) => d.files ?? []),
  );
};

const Overview = () => {
  const [activeTab, setActiveTab] = useState(() =>
    prefs.get('overview:tab', 'analytics'),
  );
  const [downloads, setDownloads] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [range, setRange] = useState(() => {
    const n = Number(prefs.get('overview:range-h', 168));
    return RANGES.some((r) => r.hours === n) ? n : 168;
  });
  const [direction, setDirection] = useState(() => {
    const saved = prefs.get('overview:direction', null);
    return saved === 'upload' || saved === 'download' ? saved : null;
  });
  const [refreshMs, setRefreshMs] = useState(() => {
    const n = Number(prefs.get('overview:refresh-ms', 60_000));
    return REFRESH_OPTIONS.some((o) => o.ms === n) ? n : 60_000;
  });

  const [summary, setSummary] = useState(null);
  const [histogram, setHistogram] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ download: [], upload: [] });
  const [directories, setDirectories] = useState([]);
  const [topFiles, setTopFiles] = useState([]);
  const [dlExceptions, setDlExceptions] = useState([]);
  const [ulExceptions, setUlExceptions] = useState([]);
  const [events, setEvents] = useState([]);
  const [fileTypeCounts, setFileTypeCounts] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);

  const location = useLocation();
  const mapUrl = location.pathname.replace(/\/overview$/, '/map');

  // Live transfers — 1s polling
  useEffect(() => {
    let cancelled = false;

    const fetch = async () => {
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
        // silently ignore
      }
    };

    fetch();
    const id = setInterval(fetch, 1_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Events feed — load once on mount
  useEffect(() => {
    const load = async () => {
      try {
        const { events: loadedEvents } = await eventsAPI.list({
          limit: 50,
          offset: 0,
        });
        setEvents(loadedEvents ?? []);
      } catch {
        // silently ignore
      }
    };

    load();
  }, []);

  // File type counts — load once on mount
  useEffect(() => {
    const load = async () => {
      try {
        const counts = await sharesAPI.getFileTypeCounts();
        setFileTypeCounts(counts);
      } catch {
        // silently ignore
      }
    };

    load();
  }, []);

  // Analytics — reload when range, direction, or refresh interval changes
  useEffect(() => {
    setAnalyticsLoading(true);
    const end = new Date().toISOString();
    const start = new Date(Date.now() - range * 60 * 60 * 1_000).toISOString();
    const interval = getHistogramInterval(range);

    const apiDirection = direction ?? undefined;

    const load = async () => {
      try {
        const [sum, hist, ldDown, ldUp, directories_, dlExc, ulExc, filesData] =
          await Promise.all([
            reportsAPI
              .getSummary({ direction: apiDirection, end, start })
              .catch(() => null),
            reportsAPI
              .getHistogram({
                direction: apiDirection,
                end,
                interval,
                start,
              })
              .catch(() => null),
            reportsAPI
              .getLeaderboard({
                direction: 'download',
                end,
                limit: 10,
                sortBy: 'TotalBytes',
                start,
              })
              .catch(() => null),
            reportsAPI
              .getLeaderboard({
                direction: 'upload',
                end,
                limit: 10,
                sortBy: 'TotalBytes',
                start,
              })
              .catch(() => null),
            reportsAPI
              .getDirectories({ end, limit: 10, start })
              .catch(() => null),
            reportsAPI
              .getExceptionsPareto({
                direction: 'download',
                end,
                start,
              })
              .catch(() => null),
            reportsAPI
              .getExceptionsPareto({ direction: 'upload', end, start })
              .catch(() => null),
            reportsAPI.getTopFiles({ end, limit: 2, start }).catch(() => null),
          ]);
        setSummary(sum);
        setHistogram(hist);
        setLeaderboard({ download: ldDown ?? [], upload: ldUp ?? [] });
        setDirectories(directories_ ?? []);
        setDlExceptions(dlExc ?? []);
        setUlExceptions(ulExc ?? []);
        setTopFiles(filesData ?? []);
      } catch {
        // silently ignore
      } finally {
        setAnalyticsLoading(false);
      }
    };

    load();

    if (refreshMs > 0) {
      const refreshId = setInterval(
        () => setAnalyticsRefresh((c) => c + 1),
        refreshMs,
      );
      return () => clearInterval(refreshId);
    }

    return undefined;
  }, [analyticsRefresh, direction, range, refreshMs]);

  const allDownloads = flattenTransfers(downloads);
  const allUploads = flattenTransfers(uploads);

  return (
    <div className="overview">
      <div className="overview-tabs">
        <button
          className={`overview-tab${activeTab === 'analytics' ? ' active' : ''}`}
          onClick={() => {
            prefs.set('overview:tab', 'analytics');
            setActiveTab('analytics');
          }}
          type="button"
        >
          Analytics
        </button>
        <button
          className={`overview-tab${activeTab === 'users' ? ' active' : ''}`}
          onClick={() => {
            prefs.set('overview:tab', 'users');
            setActiveTab('users');
          }}
          type="button"
        >
          Users
        </button>
        <a
          className="overview-map-link"
          href={mapUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Live Map ↗
        </a>
      </div>

      <div className="overview-body">
        <div className="overview-analytics">
          <div style={{ display: activeTab === 'users' ? '' : 'none' }}>
            <UserReports />
          </div>
          {activeTab === 'analytics' && (
            <>
              <div className="overview-controls">
                <div className="overview-controls-left">
                  <div className="overview-pills">
                    {RANGES.map((r) => (
                      <button
                        className={`overview-pill${range === r.hours ? ' active' : ''}`}
                        key={r.hours}
                        onClick={() => {
                          prefs.set('overview:range-h', r.hours);
                          setRange(r.hours);
                        }}
                        type="button"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <div className="overview-pills">
                    {DIRECTION_OPTIONS.map((d) => (
                      <button
                        className={`overview-pill${direction === d.value ? ' active' : ''}`}
                        key={d.label}
                        onClick={() => {
                          prefs.set('overview:direction', d.value ?? null);
                          setDirection(d.value);
                        }}
                        type="button"
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overview-refresh">
                  <span>Refresh</span>
                  <select
                    className="overview-refresh-select"
                    onChange={(e) => {
                      const ms = Number(e.target.value);
                      prefs.set('overview:refresh-ms', ms);
                      setRefreshMs(ms);
                    }}
                    value={refreshMs}
                  >
                    {REFRESH_OPTIONS.map((o) => (
                      <option
                        key={o.ms}
                        value={o.ms}
                      >
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <KpiCards
                downloads={allDownloads}
                loading={analyticsLoading && !summary}
                summary={summary}
                uploads={allUploads}
              />

              <ActivityChart
                data={histogram}
                intervalMinutes={getHistogramInterval(range)}
                range={range}
              />

              <ErrorChart
                data={histogram}
                intervalMinutes={getHistogramInterval(range)}
              />

              <div className="overview-row">
                <UserLeaderboard leaderboard={leaderboard} />
                <PopularDirectories directories={directories} />
                <TopFiles files={topFiles} />
              </div>

              <TransferHealth
                dlExceptions={dlExceptions}
                summary={summary}
                ulExceptions={ulExceptions}
              />

              <FileTypeChart counts={fileTypeCounts} />
            </>
          )}
        </div>

        <NotificationFeed events={events} />
      </div>
    </div>
  );
};

export default React.memo(Overview);
