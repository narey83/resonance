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

import './Overview.css';
import * as eventsAPI from '../../lib/events';
import * as libraryActivityAPI from '../../lib/libraryActivity';
import * as musicLibraryAPI from '../../lib/musicLibrary';
import * as prefs from '../../lib/prefs';
import * as reportsAPI from '../../lib/reports';
import * as sharesAPI from '../../lib/shares';
import * as transfersAPI from '../../lib/transfers';
import AppContext from '../AppContext';
import ActivityChart from './ActivityChart';
import ActivityHeatmap from './ActivityHeatmap';
import CoverageCard from './CoverageCard';
import ErrorChart from './ErrorChart';
import FileTypeChart from './FileTypeChart';
import GeographyCard from './GeographyCard';
import KpiCards from './KpiCards';
import LibraryComposition from './LibraryComposition';
import NotificationFeed from './NotificationFeed';
import PeerRetentionCard from './PeerRetentionCard';
import PersonalSummary from './PersonalSummary';
import PopularDirectories from './PopularDirectories';
import QueueWaitCard from './QueueWaitCard';
import RatioCard from './RatioCard';
import RetryFunnel from './RetryFunnel';
import SocialPulse from './SocialPulse';
import SystemStatsCard from './SystemStatsCard';
import TopFiles from './TopFiles';
import TransferHealth from './TransferHealth';
import UserLeaderboard from './UserLeaderboard';
import UserReports from './UserReports';
import React, { useContext, useEffect, useState } from 'react';
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

// Sub-tabs within the Analytics view — one section each, so the page shows
// one focused panel group at a time instead of a long scroll.
const ANALYTICS_TABS = [
  { id: 'glance', label: 'At a Glance' },
  { id: 'activity', label: 'Transfer Activity' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'top', label: 'Top Users & Content' },
  { id: 'geography', label: 'Audience & Geography' },
  { id: 'library', label: 'Library' },
  { id: 'feed', label: 'Activity Feed' },
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

const AdminOverview = () => {
  const [activeTab, setActiveTab] = useState(() =>
    prefs.get('overview:tab', 'analytics'),
  );
  const [analyticsTab, setAnalyticsTab] = useState(() => {
    const saved = prefs.get('overview:analytics-tab', 'glance');
    return ANALYTICS_TABS.some((t) => t.id === saved) ? saved : 'glance';
  });
  const [downloads, setDownloads] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [range, setRange] = useState(() => {
    const n = Number(prefs.get('overview:range-h', 168));
    return RANGES.some((r) => r.hours === n) ? n : 168;
  });
  const [refreshMs, setRefreshMs] = useState(() => {
    const n = Number(prefs.get('overview:refresh-ms', 60_000));
    return REFRESH_OPTIONS.some((o) => o.ms === n) ? n : 60_000;
  });

  const [summary, setSummary] = useState(null);
  const [prevSummary, setPrevSummary] = useState(null);
  const [histogram, setHistogram] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ download: [], upload: [] });
  const [directories, setDirectories] = useState([]);
  const [topFiles, setTopFiles] = useState([]);
  const [dlExceptions, setDlExceptions] = useState([]);
  const [ulExceptions, setUlExceptions] = useState([]);
  const [events, setEvents] = useState([]);
  const [fileTypeCounts, setFileTypeCounts] = useState(null);
  const [heatmap, setHeatmap] = useState([]);
  const [geography, setGeography] = useState(null);
  const [retries, setRetries] = useState([]);
  const [queueWait, setQueueWait] = useState(null);
  const [peers, setPeers] = useState(null);
  const [social, setSocial] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [genres, setGenres] = useState([]);
  const [years, setYears] = useState([]);
  const [playStats, setPlayStats] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  // Frosted-glass transition overlay — shown only on user-initiated range
  // changes, not on background auto-refresh (which would flash it).
  const [transitioning, setTransitioning] = useState(false);
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

  // Events feed — scoped to the selected range
  useEffect(() => {
    const load = async () => {
      const to = new Date().toISOString();
      const from = new Date(Date.now() - range * 60 * 60 * 1_000).toISOString();
      try {
        const { events: loadedEvents } = await eventsAPI.list({
          from,
          limit: 50,
          offset: 0,
          to,
        });
        setEvents(loadedEvents ?? []);
      } catch {
        // silently ignore
      }
    };

    load();
  }, [analyticsRefresh, range]);

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

  // Activity heatmap — fixed 90-day lookback. The day-of-week × hour-of-day
  // pattern only becomes meaningful over weeks, so it intentionally ignores
  // the selected range (which can be as short as 1h).
  useEffect(() => {
    const load = async () => {
      const end = new Date().toISOString();
      const start = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1_000,
      ).toISOString();
      try {
        const heat = await reportsAPI.getHeatmap({ end, start });
        setHeatmap(heat ?? []);
      } catch {
        // silently ignore
      }
    };

    load();
  }, [analyticsRefresh]);

  // Catalog coverage + local library composition — load once on mount (not time-windowed)
  useEffect(() => {
    const load = async () => {
      const [cov, gen, yrs, plays] = await Promise.all([
        reportsAPI.getCoverage().catch(() => null),
        musicLibraryAPI.getGenres().catch(() => null),
        musicLibraryAPI.getYears().catch(() => null),
        libraryActivityAPI.getPlayStats().catch(() => null),
      ]);
      setCoverage(cov);
      setGenres(gen ?? []);
      setYears(yrs ?? []);
      setPlayStats(plays ?? []);
    };

    load();
  }, []);

  // Analytics — reload when range or refresh interval changes
  useEffect(() => {
    setAnalyticsLoading(true);
    const end = new Date().toISOString();
    const start = new Date(Date.now() - range * 60 * 60 * 1_000).toISOString();
    const interval = getHistogramInterval(range);

    // previous equal-length window, for KPI deltas
    const prevEnd = start;
    const prevStart = new Date(
      Date.now() - 2 * range * 60 * 60 * 1_000,
    ).toISOString();

    const load = async () => {
      try {
        const [sum, hist, ldDown, ldUp, directories_, dlExc, ulExc, filesData] =
          await Promise.all([
            reportsAPI.getSummary({ end, start }).catch(() => null),
            reportsAPI
              .getHistogram({
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
            reportsAPI.getTopFiles({ end, limit: 10, start }).catch(() => null),
          ]);
        setSummary(sum);
        setHistogram(hist);
        setLeaderboard({ download: ldDown ?? [], upload: ldUp ?? [] });
        setDirectories(directories_ ?? []);
        setDlExceptions(dlExc ?? []);
        setUlExceptions(ulExc ?? []);
        setTopFiles(filesData ?? []);

        const [prevSum, geo, retry, queue, peerData, socialData] =
          await Promise.all([
            reportsAPI
              .getSummary({ end: prevEnd, start: prevStart })
              .catch(() => null),
            reportsAPI.getGeography({ end, limit: 8, start }).catch(() => null),
            reportsAPI.getRetryFunnel({ end, start }).catch(() => null),
            reportsAPI.getQueueWait({ end, start }).catch(() => null),
            reportsAPI.getPeerRetention({ end, start }).catch(() => null),
            reportsAPI.getSocialActivity({ end, start }).catch(() => null),
          ]);
        setPrevSummary(prevSum);
        setGeography(geo);
        setRetries(retry ?? []);
        setQueueWait(queue);
        setPeers(peerData);
        setSocial(socialData);
      } catch {
        // silently ignore
      } finally {
        setAnalyticsLoading(false);
        setTransitioning(false);
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
  }, [analyticsRefresh, range, refreshMs]);

  const allDownloads = flattenTransfers(downloads);
  const allUploads = flattenTransfers(uploads);
  const totalSharedFiles = fileTypeCounts
    ? Object.values(fileTypeCounts).reduce((s, v) => s + (Number(v) || 0), 0)
    : 0;

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
        <div
          className={`overview-analytics${activeTab === 'users' ? ' overview-analytics--users' : ''}`}
        >
          {activeTab === 'users' && <UserReports />}
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
                          if (range === r.hours) return;
                          prefs.set('overview:range-h', r.hours);
                          setTransitioning(true);
                          setRange(r.hours);
                        }}
                        type="button"
                      >
                        {r.label}
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

              <div className="overview-subtabs">
                {ANALYTICS_TABS.map((t) => (
                  <button
                    className={`overview-subtab${analyticsTab === t.id ? ' active' : ''}`}
                    key={t.id}
                    onClick={() => {
                      prefs.set('overview:analytics-tab', t.id);
                      setAnalyticsTab(t.id);
                    }}
                    type="button"
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div
                className={`overview-sections${transitioning ? ' transitioning' : ''}`}
              >
                {transitioning && (
                  <div
                    aria-hidden="true"
                    className="overview-glass-overlay"
                  >
                    <div className="overview-glass-spinner" />
                  </div>
                )}
                {analyticsTab === 'glance' && (
                  <section className="overview-section">
                    <KpiCards
                      downloads={allDownloads}
                      loading={analyticsLoading && !summary}
                      prevSummary={prevSummary}
                      summary={summary}
                      uploads={allUploads}
                    />
                    <SocialPulse data={social} />
                    <div className="overview-row">
                      <RatioCard
                        histogram={histogram}
                        summary={summary}
                      />
                      <CoverageCard
                        totalFiles={totalSharedFiles}
                        uploadedFiles={coverage?.uploadedFiles}
                      />
                    </div>
                    <SystemStatsCard />
                  </section>
                )}

                {analyticsTab === 'activity' && (
                  <section className="overview-section">
                    <ActivityChart
                      data={histogram}
                      intervalMinutes={getHistogramInterval(range)}
                      range={range}
                    />
                    <ActivityHeatmap data={heatmap} />
                    <ErrorChart
                      data={histogram}
                      intervalMinutes={getHistogramInterval(range)}
                    />
                  </section>
                )}

                {analyticsTab === 'reliability' && (
                  <section className="overview-section">
                    <div className="overview-row">
                      <RetryFunnel data={retries} />
                      <QueueWaitCard stats={queueWait} />
                    </div>
                    <TransferHealth
                      dlExceptions={dlExceptions}
                      summary={summary}
                      ulExceptions={ulExceptions}
                    />
                  </section>
                )}

                {analyticsTab === 'top' && (
                  <section className="overview-section">
                    <div className="overview-row">
                      <UserLeaderboard leaderboard={leaderboard} />
                      <PopularDirectories directories={directories} />
                      <TopFiles files={topFiles} />
                    </div>
                  </section>
                )}

                {analyticsTab === 'geography' && (
                  <section className="overview-section">
                    <div className="overview-row">
                      <GeographyCard geography={geography} />
                      <PeerRetentionCard data={peers} />
                    </div>
                  </section>
                )}

                {analyticsTab === 'library' && (
                  <section className="overview-section">
                    <div className="overview-row">
                      <LibraryComposition
                        genres={genres}
                        playStats={playStats}
                        years={years}
                      />
                      <FileTypeChart counts={fileTypeCounts} />
                    </div>
                  </section>
                )}

                {analyticsTab === 'feed' && (
                  <section className="overview-section overview-section--feed">
                    <NotificationFeed events={events} />
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const MemoizedAdminOverview = React.memo(AdminOverview);

// Overview is the default landing page for every role, but only admins get
// the full analytics dashboard — everyone else gets a small personal
// summary (see PersonalSummary.jsx). Branching here, above the admin
// dashboard's many data-fetching effects, means those effects (and their
// now-role-gated backend calls) never run at all for non-admins.
const Overview = () => {
  const { isAdmin, state } = useContext(AppContext);
  return isAdmin ? (
    <MemoizedAdminOverview />
  ) : (
    <PersonalSummary state={state} />
  );
};

export default Overview;
