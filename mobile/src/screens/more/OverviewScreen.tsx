// <copyright file="OverviewScreen.tsx" company="John Narey">
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

// The default landing screen for every role. Admins get the full analytics
// dashboard below; everyone else gets a small personal summary instead (see
// PersonalSummary.tsx) — not the same global/other-users data. Basic
// connection/server/system status (open to every user, matching the
// backend's own permission boundary) lives in the separate ConnectionScreen
// instead — see that file.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../../navigation/MainTabs';
import { useAfterInteractions } from '../../hooks/useDeferredEffect';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography, ThemeColors } from '../../theme';
import { useAuthStore } from '../../store/auth';
import * as analytics from '../../api/analytics';
import * as sharesApi from '../../api/shares';
import * as musicLibraryApi from '../../api/musicLibrary';
import * as libraryActivityApi from '../../api/libraryActivity';
import * as eventsApi from '../../api/events';
import { SectionHeader } from '../../components/overview/shared';
import type { Histogram } from '../../components/overview/histogramUtils';
import KpiCards from '../../components/overview/KpiCards';
import SocialPulse from '../../components/overview/SocialPulse';
import RatioCard from '../../components/overview/RatioCard';
import CoverageCard from '../../components/overview/CoverageCard';
import ActivityChart from '../../components/overview/ActivityChart';
import ActivityHeatmap from '../../components/overview/ActivityHeatmap';
import ErrorChart from '../../components/overview/ErrorChart';
import RetryFunnel from '../../components/overview/RetryFunnel';
import QueueWaitCard from '../../components/overview/QueueWaitCard';
import TransferHealth from '../../components/overview/TransferHealth';
import UserLeaderboard from '../../components/overview/UserLeaderboard';
import PopularDirectories from '../../components/overview/PopularDirectories';
import TopFiles from '../../components/overview/TopFiles';
import UserReports from '../../components/overview/UserReports';
import GeographyCard from '../../components/overview/GeographyCard';
import WorldMap from '../../components/overview/WorldMap';
import PeerRetentionCard from '../../components/overview/PeerRetentionCard';
import LibraryComposition from '../../components/overview/LibraryComposition';
import FileTypeChart from '../../components/overview/FileTypeChart';
import NotificationFeed from '../../components/overview/NotificationFeed';
import UserReportModal from '../../components/overview/UserReportModal';
import PersonalSummary from '../../components/overview/PersonalSummary';
import { SkeletonCard, SkeletonRows } from '../../components/Skeleton';

const RANGES = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 168, label: '7d' },
  { hours: 720, label: '30d' },
];

const TABS = [
  { id: 'glance', label: 'At a Glance' },
  { id: 'activity', label: 'Activity' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'top', label: 'Top Users' },
  { id: 'geography', label: 'Geography' },
  { id: 'library', label: 'Library' },
  { id: 'feed', label: 'Feed' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const histogramInterval = (hours: number) => {
  if (hours <= 1) return 5;
  if (hours <= 6) return 15;
  if (hours <= 24) return 60;
  if (hours <= 168) return 360;
  return 1_440;
};

interface AnalyticsData {
  summary:      Record<string, Record<string, analytics.TransferSummary>> | null;
  prevSummary:  Record<string, Record<string, analytics.TransferSummary>> | null;
  histogram:    Histogram | null;
  leaderboard:  { download: analytics.TransferSummary[]; upload: analytics.TransferSummary[] };
  topFiles:     analytics.TransferFileSummary[];
  directories:  analytics.TransferDirectorySummary[];
  exceptions:   analytics.TransferExceptionSummaryEntry[];
  heatmap:      analytics.HeatmapCell[];
  geography:    analytics.GeographyReport | null;
  retryFunnel:  analytics.RetryBucket[];
  queueWait:    analytics.QueueWaitStats | null;
  peerRetention: analytics.PeerRetention | null;
  social:       analytics.SocialActivity | null;
  mapUsers:     analytics.UserReportSummary[];
}

const emptyAnalytics: AnalyticsData = {
  summary: null,
  prevSummary: null,
  histogram: null,
  leaderboard: { download: [], upload: [] },
  topFiles: [],
  directories: [],
  exceptions: [],
  heatmap: [],
  geography: null,
  retryFunnel: [],
  queueWait: null,
  peerRetention: null,
  social: null,
  mapUsers: [],
};

type Props = NativeStackScreenProps<MoreStackParamList, 'Overview'>;

// ── Lazy per-tab fetching ─────────────────────────────────────────────────────
// The dashboard used to fire all ~21 report queries in one Promise.all on mount
// and again on every range change, blocking the whole page behind one spinner
// and re-rendering everything at once. Endpoints are grouped by the tab that
// needs them; a group is fetched the first time its tab is opened (per range)
// and cached until pull-to-refresh.

type FetchGroup = 'glance' | 'activity' | 'reliability' | 'top' | 'geography' | 'coverage' | 'library' | 'feed';

const TAB_GROUPS: Record<TabId, FetchGroup[]> = {
  glance:      ['glance', 'coverage'],
  activity:    ['activity'],
  reliability: ['reliability'],
  top:         ['top'],
  geography:   ['geography'],
  library:     ['library', 'coverage'],
  feed:        ['feed'],
};

// Groups whose data depends on the selected time range (the rest are global).
const RANGE_SCOPED: ReadonlySet<FetchGroup> = new Set(['glance', 'activity', 'reliability', 'top', 'geography']);

const groupKey = (group: FetchGroup, hours: number) =>
  RANGE_SCOPED.has(group) ? `${group}:${hours}` : group;

export default function OverviewScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const isAdmin = useAuthStore((state) => state.isAdmin);

  const [tabLoading, setTabLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [rangeHours, setRangeHours] = useState(24);
  const [tab, setTab] = useState<TabId>('glance');
  const [data, setData] = useState<AnalyticsData>(emptyAnalytics);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const [fileTypeCounts, setFileTypeCounts] = useState<Record<string, number>>({});
  const [coverage, setCoverage] = useState<analytics.CoverageReport | null>(null);
  const [genres, setGenres] = useState<musicLibraryApi.MusicGenre[]>([]);
  const [years, setYears] = useState<musicLibraryApi.MusicYear[]>([]);
  const [playStats, setPlayStats] = useState<libraryActivityApi.PlayStat[]>([]);
  const [events, setEvents] = useState<eventsApi.EventRecord[]>([]);

  const fetchedRef = useRef<Set<string>>(new Set());

  // All of AnalyticsData is range-scoped, but there's one visible `data` object, so a
  // fetch for one range overwrites another's. Cache each range's data separately and
  // restore it on switch — otherwise returning to a range you've already loaded shows
  // the *other* range's numbers (the "back to 24h won't update / frozen" bug).
  const dataByRange = useRef<Record<number, AnalyticsData>>({});
  const rangeHoursRef = useRef(rangeHours);
  rangeHoursRef.current = rangeHours;

  const applyData = useCallback((hours: number, patch: Partial<AnalyticsData>) => {
    const next = { ...(dataByRange.current[hours] ?? emptyAnalytics), ...patch };
    dataByRange.current[hours] = next;
    // Only reflect into the visible state if this fetch was for the range on screen.
    if (hours === rangeHoursRef.current) setData(next);
  }, []);

  // Instantly restore a range's cached data when it's selected (or clear to the
  // loading state for a range not yet fetched).
  useEffect(() => {
    setData(dataByRange.current[rangeHours] ?? emptyAnalytics);
  }, [rangeHours]);

  const fetchGroup = useCallback(async (group: FetchGroup, hours: number) => {
    const now = new Date();
    const end = now.toISOString();
    const start = new Date(now.getTime() - hours * 3_600_000).toISOString();
    const range = { start, end };

    switch (group) {
      case 'glance': {
        const prevStart = new Date(now.getTime() - 2 * hours * 3_600_000).toISOString();
        const [summary, prevSummary, social] = await Promise.all([
          analytics.getSummary(range),
          analytics.getSummary({ start: prevStart, end: start }),
          analytics.getSocialActivity(range),
        ]);
        applyData(hours, { summary, prevSummary, social });
        break;
      }
      case 'activity': {
        const [histogram, heatmap] = await Promise.all([
          analytics.getHistogram({ ...range, interval: histogramInterval(hours) }),
          analytics.getHeatmap(range),
        ]);
        applyData(hours, { histogram, heatmap });
        break;
      }
      case 'reliability': {
        const [summary, histogram, dlExceptions, ulExceptions, retryFunnel, queueWait] = await Promise.all([
          analytics.getSummary(range),
          analytics.getHistogram({ ...range, interval: histogramInterval(hours) }),
          analytics.getExceptionsPareto({ ...range, direction: 'Download' }),
          analytics.getExceptionsPareto({ ...range, direction: 'Upload' }),
          analytics.getRetryFunnel(range),
          analytics.getQueueWait(range),
        ]);
        applyData(hours, { summary, histogram, exceptions: [...dlExceptions, ...ulExceptions], retryFunnel, queueWait });
        break;
      }
      case 'top': {
        const [dlBoard, ulBoard, topFiles, directories] = await Promise.all([
          analytics.getLeaderboard({ ...range, direction: 'Download' }),
          analytics.getLeaderboard({ ...range, direction: 'Upload' }),
          analytics.getTopFiles(range),
          analytics.getDirectories(range),
        ]);
        applyData(hours, { leaderboard: { download: dlBoard, upload: ulBoard }, topFiles, directories });
        break;
      }
      case 'geography': {
        const [geography, peerRetention, mapUsersPage] = await Promise.all([
          analytics.getGeography(range),
          analytics.getPeerRetention(range),
          analytics.getUserList({ ...range, sortBy: 'DownloadBytes', limit: 100 }),
        ]);
        applyData(hours, { geography, peerRetention, mapUsers: mapUsersPage.items });
        break;
      }
      case 'coverage': {
        const [counts, cov] = await Promise.all([
          sharesApi.getFileTypeCounts(),
          analytics.getCoverage(),
        ]);
        setFileTypeCounts(counts);
        setCoverage(cov);
        break;
      }
      case 'library': {
        const [g, y, p] = await Promise.all([
          musicLibraryApi.getGenres(),
          musicLibraryApi.getYears(),
          libraryActivityApi.getPlayStats(),
        ]);
        setGenres(g);
        setYears(y);
        setPlayStats(p);
        break;
      }
      case 'feed': {
        setEvents(await eventsApi.list({ limit: 50 }));
        break;
      }
    }
  }, [applyData]);

  const loadTab = useCallback(async (targetTab: TabId, hours: number, force = false) => {
    if (!isAdmin) { setTabLoading(false); return; }
    const groups = TAB_GROUPS[targetTab].filter((g) => force || !fetchedRef.current.has(groupKey(g, hours)));
    if (groups.length === 0) return;
    setTabLoading(true);
    setError(null);
    try {
      await Promise.all(groups.map(async (g) => {
        await fetchGroup(g, hours);
        fetchedRef.current.add(groupKey(g, hours));
      }));
    } catch {
      setError('Could not load analytics. Check your connection.');
    } finally {
      setTabLoading(false);
    }
  }, [isAdmin, fetchGroup]);

  useAfterInteractions(() => { loadTab(tab, rangeHours); }, [tab, rangeHours, loadTab]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchedRef.current.clear();
    dataByRange.current = {};
    loadTab(tab, rangeHours, true).finally(() => setRefreshing(false));
  };

  // Whether the current tab already has data to show. A range/tab switch overwrites
  // `data` only once the new fetch resolves, so until then the previous window's
  // numbers are still here — we keep showing them (stale-while-loading) instead of
  // blanking to skeletons, which is what made switching timescales feel so slow.
  const tabHasData = useCallback((t: TabId): boolean => {
    switch (t) {
      case 'glance':      return data.summary != null;
      case 'activity':    return data.histogram != null || data.heatmap.length > 0;
      case 'reliability': return data.summary != null || data.histogram != null;
      case 'top':         return data.leaderboard.download.length > 0
                              || data.leaderboard.upload.length > 0
                              || data.topFiles.length > 0;
      case 'geography':   return data.geography != null || data.mapUsers.length > 0;
      case 'library':     return genres.length > 0 || years.length > 0;
      case 'feed':        return events.length > 0;
    }
  }, [data, genres, years, events]);

  const hasData      = tabHasData(tab);
  const showSkeleton = tabLoading && !hasData;   // cold load: nothing to show yet
  const showError    = !!error && !hasData;      // keep stale numbers over a failed refresh
  const reloading    = tabLoading && hasData;    // refreshing in place — dim + spinner

  // Only admins get the full analytics dashboard; everyone else gets a
  // small personal summary instead (mirrors the web frontend's Overview).
  if (!isAdmin) {
    return <PersonalSummary colors={colors} />;
  }

  return (
    <>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {/* Range picker */}
        <View style={s.segWrapper}>
          {RANGES.map((r) => {
            const active = rangeHours === r.hours;
            return (
              <Pressable key={r.label} onPress={() => setRangeHours(r.hours)} style={[s.segPill, active && { backgroundColor: colors.accent }]}>
                <Text style={[s.segLabel, { color: active ? '#fff' : colors.textMuted }]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Analytics tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[s.tabPill, { borderColor: active ? colors.accent : colors.border }, active && { backgroundColor: colors.accent + '22' }]}
              >
                <Text style={[s.tabLabel, { color: active ? colors.accent : colors.textMuted }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Refreshing in place: keep the previous window's numbers visible (dimmed)
            rather than blanking to skeletons, so switching timescales feels instant. */}
        {reloading && (
          <View style={s.reloadRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={s.reloadText}>Updating…</Text>
          </View>
        )}

        <View style={[s.tabContent, reloading && s.tabContentDim]}>
          {showSkeleton && (
            <>
              <SkeletonCard height={90} />
              <SkeletonCard height={140} />
              <SkeletonRows rows={3} />
            </>
          )}
          {showError && (
            <View style={s.inlineError}>
              <Ionicons name="alert-circle-outline" size={32} color={colors.danger} />
              <Text style={s.errorText}>{error}</Text>
              <Text style={s.errorHint}>Pull down to retry.</Text>
            </View>
          )}
          {!showSkeleton && !showError && tab === 'glance' && (
            <>
              <KpiCards summary={data.summary} prevSummary={data.prevSummary} colors={colors} />
              <SectionHeader title="Ratio" colors={colors} />
              <RatioCard summary={data.summary} colors={colors} />
              <SectionHeader title="Catalog Coverage" colors={colors} />
              <CoverageCard
                totalFiles={Object.values(fileTypeCounts).reduce((a, b) => a + b, 0)}
                uploadedFiles={coverage?.uploadedFiles ?? 0}
                colors={colors}
              />
              <SectionHeader title="Social" colors={colors} />
              <SocialPulse data={data.social} colors={colors} />
            </>
          )}
          {!showSkeleton && !showError && tab === 'activity' && (
            <>
              <SectionHeader title="Transfer Volume" colors={colors} />
              <ActivityChart data={data.histogram} colors={colors} />
              <SectionHeader title="Activity Heatmap (90d)" colors={colors} />
              <ActivityHeatmap data={data.heatmap} colors={colors} />
            </>
          )}
          {!showSkeleton && !showError && tab === 'reliability' && (
            <>
              <SectionHeader title="Errors Over Time" colors={colors} />
              <ErrorChart data={data.histogram} colors={colors} />
              <SectionHeader title="Retry Funnel (Downloads)" colors={colors} />
              <RetryFunnel data={data.retryFunnel} colors={colors} />
              <SectionHeader title="Upload Queue Wait" colors={colors} />
              <QueueWaitCard stats={data.queueWait} colors={colors} />
              <SectionHeader title="Transfer Health" colors={colors} />
              <TransferHealth summary={data.summary} exceptions={data.exceptions} colors={colors} />
            </>
          )}
          {!showSkeleton && !showError && tab === 'top' && (
            <>
              <SectionHeader title="Leaderboard" colors={colors} />
              <UserLeaderboard leaderboard={data.leaderboard} colors={colors} onSelectUser={setSelectedUser} />
              <SectionHeader title="Popular Directories" colors={colors} />
              <PopularDirectories directories={data.directories} colors={colors} />
              <SectionHeader title="Most Downloaded Files" colors={colors} />
              <TopFiles files={data.topFiles} colors={colors} />
              <SectionHeader title="All Users" colors={colors} />
              <UserReports colors={colors} onSelectUser={setSelectedUser} />
            </>
          )}
          {!showSkeleton && !showError && tab === 'geography' && (
            <>
              <SectionHeader title="Peer Map" colors={colors} />
              <WorldMap users={data.mapUsers} colors={colors} onSelectUser={setSelectedUser} />
              <SectionHeader title="By Country" colors={colors} />
              <GeographyCard geography={data.geography} colors={colors} />
              <SectionHeader title="Peer Retention" colors={colors} />
              <PeerRetentionCard data={data.peerRetention} colors={colors} />
            </>
          )}
          {!showSkeleton && !showError && tab === 'library' && (
            <>
              <SectionHeader title="Composition" colors={colors} />
              <LibraryComposition genres={genres} years={years} playStats={playStats} colors={colors} />
              <SectionHeader title="File Types" colors={colors} />
              <FileTypeChart counts={fileTypeCounts} colors={colors} />
            </>
          )}
          {!showSkeleton && !showError && tab === 'feed' && (
            <>
              <SectionHeader title="Recent Activity" colors={colors} />
              <NotificationFeed events={events} colors={colors} />
            </>
          )}
        </View>
      </ScrollView>

      <UserReportModal
        username={selectedUser}
        colors={colors}
        onClose={() => setSelectedUser(null)}
        onOpenChat={(username) => {
          setSelectedUser(null);
          navigation.navigate('ChatConversation', { username });
        }}
      />
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
    inlineError: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl },
    errorText:   { fontSize: Typography.base, color: c.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl },
    errorHint:   { fontSize: Typography.xs, color: c.textDim },
    segWrapper: {
      flexDirection: 'row',
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgElevated,
      overflow: 'hidden',
      padding: 2,
    },
    segPill:  { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.full },
    segLabel: { fontSize: Typography.sm, fontWeight: '600' },
    tabScroll: { marginTop: Spacing.sm, flexGrow: 0 },
    tabPill: {
      borderWidth: 1,
      borderRadius: Radius.full,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.md,
      marginRight: Spacing.sm,
    },
    tabLabel: { fontSize: Typography.sm, fontWeight: '600' },
    tabContent: { gap: Spacing.sm, marginTop: Spacing.sm },
    tabContentDim: { opacity: 0.45 },
    reloadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    reloadText: { fontSize: Typography.xs, color: c.textMuted, fontWeight: '600' },
  });
}
