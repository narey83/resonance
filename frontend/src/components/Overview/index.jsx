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
import * as prefs from '../../lib/prefs';
import * as reportsAPI from '../../lib/reports';
import * as sharesAPI from '../../lib/shares';
import * as transfersAPI from '../../lib/transfers';
import { keepIfEqual } from '../../lib/util';
import AppContext from '../AppContext';
import ActivityChart from './ActivityChart';
import ActivityHeatmap from './ActivityHeatmap';
import BlockedUsersCard from './BlockedUsersCard';
import CoverageCard from './CoverageCard';
import DistributedNetworkCard from './DistributedNetworkCard';
import ErrorChart from './ErrorChart';
import GeographyCard from './GeographyCard';
import KpiCards from './KpiCards';
import { loadOverviewReports, overviewTasks } from './overviewReports';
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
  const [activeTab, setActiveTab] = useState(() => {
    const saved = prefs.get('overview:tab', 'uploads');
    return [
      'uploads',
      'downloads',
      'community',
      'resources',
      'network',
      'users',
    ].includes(saved)
      ? saved
      : 'uploads';
  });
  const [analyticsTab, setAnalyticsTab] = useState(() => {
    const saved = prefs.get('overview:analytics-tab', 'glance');
    return ANALYTICS_TABS.some((t) => t.id === saved) ? saved : 'glance';
  });
  const direction =
    activeTab === 'uploads'
      ? 'upload'
      : activeTab === 'downloads'
        ? 'download'
        : null;
  const section =
    direction === 'download' && analyticsTab === 'geography'
      ? 'glance'
      : analyticsTab;
  const showCoverage = activeTab === 'community';
  const showLive = Boolean(direction) && section === 'glance';
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
  const [fileTypeCounts, setFileTypeCounts] = useState(null);
  const [heatmap, setHeatmap] = useState([]);
  const [geography, setGeography] = useState(null);
  const [retries, setRetries] = useState([]);
  const [queueWait, setQueueWait] = useState(null);
  const [peers, setPeers] = useState(null);
  const [social, setSocial] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [reportError, setReportError] = useState(false);
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);

  // Only poll the selected direction, and never overlap live requests.
  useEffect(() => {
    if (!showLive) return undefined;
    let cancelled = false;
    let timer;
    const load = async () => {
      try {
        if (!document.hidden) {
          const value = await transfersAPI.getAll({
            activeOnly: true,
            direction,
          });
          if (!cancelled) {
            const setter = direction === 'download' ? setDownloads : setUploads;
            setter((previous) => keepIfEqual(previous, value ?? []));
          }
        }
      } catch {
        // Retain the last live snapshot during a brief connection failure.
      } finally {
        if (!cancelled) timer = setTimeout(load, 1_000);
      }
    };

    load().catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [direction, showLive]);

  // Catalog queries are only needed on the upload overview.
  useEffect(() => {
    if (!showCoverage) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const counts = await sharesAPI.getFileTypeCounts();
        if (!cancelled) setFileTypeCounts(counts);
      } catch {
        // silently ignore
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [showCoverage]);

  // Activity heatmap — fixed 90-day lookback. The day-of-week × hour-of-day
  // pattern only becomes meaningful over weeks, so it intentionally ignores
  // the selected range (which can be as short as 1h).
  useEffect(() => {
    if (!direction || section !== 'activity') return undefined;
    const controller = new AbortController();
    let cancelled = false;
    setHeatmap([]);
    const load = async () => {
      const end = new Date().toISOString();
      const start = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1_000,
      ).toISOString();
      try {
        const heat = await reportsAPI.getHeatmap({
          end,
          start,
          direction,
          signal: controller.signal,
        });
        if (!cancelled) setHeatmap(heat ?? []);
      } catch {
        // silently ignore
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [analyticsRefresh, direction, section]);

  // Catalog coverage — load on mount (not time-windowed). The server computes it in the
  // background and reports `pending` until the first count lands, so check back until then.
  useEffect(() => {
    if (!showCoverage) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    let timer;
    const load = async () => {
      const cov = await reportsAPI
        .getCoverage({ signal: controller.signal })
        .catch(() => null);
      if (cancelled) return;
      setCoverage(cov);
      if (cov?.pending) timer = setTimeout(load, 15_000);
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [showCoverage]);

  // A range/view change aborts requests and stops the old queue. Render each
  // completed panel immediately; unrelated reports never hold the page hostage.
  useEffect(() => {
    if (!direction && activeTab !== 'community') return undefined;
    const controller = new AbortController();
    let timer;
    setAnalyticsLoading(true);
    setReportError(false);
    setSummary(null);
    setPrevSummary(null);
    setHistogram(null);
    setLeaderboard({ download: [], upload: [] });
    setDirectories([]);
    setTopFiles([]);
    setDlExceptions([]);
    setUlExceptions([]);
    setGeography(null);
    setRetries([]);
    setQueueWait(null);
    setPeers(null);
    setSocial(null);
    const end = new Date().toISOString();
    const start = new Date(Date.now() - range * 3_600_000).toISOString();
    const tasks = overviewTasks({
      direction,
      section,
      start,
      end,
      interval: getHistogramInterval(range),
    });
    const setters = {
      summary: setSummary,
      prevSummary: setPrevSummary,
      histogram: setHistogram,
      leaderboard: (value) => setLeaderboard({ [direction]: value ?? [] }),
      exceptions: direction === 'download' ? setDlExceptions : setUlExceptions,
      directories: setDirectories,
      topFiles: setTopFiles,
      geography: setGeography,
      retries: setRetries,
      queueWait: setQueueWait,
      peers: setPeers,
      social: setSocial,
    };
    loadOverviewReports(tasks, {
      signal: controller.signal,
      onResult: (key, value) => setters[key](value),
      onError: () => setReportError(true),
    }).finally(() => {
      if (controller.signal.aborted) return;
      setAnalyticsLoading(false);
      if (refreshMs > 0)
        timer = setTimeout(
          () => setAnalyticsRefresh((value) => value + 1),
          refreshMs,
        );
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeTab, analyticsRefresh, direction, range, refreshMs, section]);

  const allDownloads = flattenTransfers(downloads);
  const allUploads = flattenTransfers(uploads);
  const totalSharedFiles = fileTypeCounts
    ? Object.values(fileTypeCounts).reduce((s, v) => s + (Number(v) || 0), 0)
    : 0;

  return (
    <div className="overview">
      <div className="overview-tabs">
        {[
          ['uploads', 'Uploads'],
          ['downloads', 'Downloads'],
          ['community', 'Sharing & community'],
          ['resources', 'Resources'],
        ].map(([id, label]) => (
          <button
            className={`overview-tab${activeTab === id ? ' active' : ''}`}
            key={id}
            onClick={() => {
              prefs.set('overview:tab', id);
              setActiveTab(id);
            }}
            type="button"
          >
            {label}
          </button>
        ))}
        <button
          className={`overview-tab${activeTab === 'network' ? ' active' : ''}`}
          onClick={() => {
            prefs.set('overview:tab', 'network');
            setActiveTab('network');
          }}
          type="button"
        >
          Network
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
      </div>

      <div className="overview-body">
        <div
          className={`overview-analytics${activeTab === 'users' ? ' overview-analytics--users' : ''}`}
        >
          {activeTab === 'users' && <UserReports />}
          {activeTab === 'resources' && (
            <section className="overview-section">
              <SystemStatsCard />
            </section>
          )}
          {activeTab === 'network' && (
            <section className="overview-section">
              <DistributedNetworkCard />
            </section>
          )}
          {(direction || activeTab === 'community') && (
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
                {direction &&
                  ANALYTICS_TABS.filter(
                    (t) => direction === 'upload' || t.id !== 'geography',
                  ).map((t) => (
                    <button
                      className={`overview-subtab${section === t.id ? ' active' : ''}`}
                      key={t.id}
                      onClick={() => {
                        prefs.set('overview:analytics-tab', t.id);
                        setAnalyticsTab(t.id);
                      }}
                      type="button"
                    >
                      {direction === 'download' && t.id === 'top'
                        ? 'Top sources'
                        : t.label}
                    </button>
                  ))}
              </div>

              {analyticsLoading && <p role="status">Updating reports…</p>}
              {reportError && (
                <p role="alert">
                  Some reports could not load. Try refreshing this view.
                </p>
              )}
              <div
                aria-busy={analyticsLoading}
                className="overview-sections"
              >
                {activeTab === 'community' && (
                  <section className="overview-section">
                    <SocialPulse data={social} />
                    <CoverageCard
                      pending={coverage?.pending}
                      totalFiles={totalSharedFiles}
                      uploadedFiles={coverage?.uploadedFiles}
                    />
                    <RatioCard
                      histogram={histogram}
                      summary={summary}
                    />
                    <PeerRetentionCard data={peers} />
                    <BlockedUsersCard />
                  </section>
                )}
                {direction && section === 'glance' && (
                  <section className="overview-section">
                    <KpiCards
                      direction={direction}
                      downloads={allDownloads}
                      loading={analyticsLoading && !summary}
                      prevSummary={prevSummary}
                      summary={summary}
                      uploads={allUploads}
                    />
                  </section>
                )}

                {direction && section === 'activity' && (
                  <section className="overview-section">
                    <ActivityChart
                      data={histogram}
                      direction={direction}
                      intervalMinutes={getHistogramInterval(range)}
                      range={range}
                    />
                    <ActivityHeatmap data={heatmap} />
                    <ErrorChart
                      data={histogram}
                      direction={direction}
                      intervalMinutes={getHistogramInterval(range)}
                    />
                  </section>
                )}

                {direction && section === 'reliability' && (
                  <section className="overview-section">
                    <div className="overview-row">
                      {direction === 'download' ? (
                        <RetryFunnel data={retries} />
                      ) : (
                        <QueueWaitCard stats={queueWait} />
                      )}
                    </div>
                    <TransferHealth
                      dlExceptions={dlExceptions}
                      summary={summary}
                      ulExceptions={ulExceptions}
                    />
                  </section>
                )}

                {direction && section === 'top' && (
                  <section className="overview-section">
                    <div className="overview-row">
                      <UserLeaderboard
                        direction={direction}
                        leaderboard={leaderboard}
                      />
                      {direction === 'upload' && (
                        <PopularDirectories directories={directories} />
                      )}
                      {direction === 'upload' && <TopFiles files={topFiles} />}
                    </div>
                  </section>
                )}

                {direction && section === 'geography' && (
                  <section className="overview-section">
                    <div className="overview-row">
                      <GeographyCard geography={geography} />
                    </div>
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
