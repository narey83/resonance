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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../../navigation/MainTabs';
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

type Props = BottomTabScreenProps<MainTabParamList, 'OverviewTab'>;

export default function OverviewScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const isAdmin = useAuthStore((state) => state.isAdmin);

  const [loading, setLoading]     = useState(true);
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

  const fetchAnalytics = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setError(null);
    const now = new Date();
    const end = now.toISOString();
    const start = new Date(now.getTime() - rangeHours * 3_600_000).toISOString();
    const prevEnd = start;
    const prevStart = new Date(now.getTime() - 2 * rangeHours * 3_600_000).toISOString();
    const interval = histogramInterval(rangeHours);
    const range = { start, end };

    try {
      const [
        summary, prevSummary, histogram,
        dlBoard, ulBoard, topFiles, directories,
        dlExceptions, ulExceptions, heatmap, geography,
        retryFunnel, queueWait, peerRetention, social, mapUsersPage,
      ] = await Promise.all([
        analytics.getSummary(range),
        analytics.getSummary({ start: prevStart, end: prevEnd }),
        analytics.getHistogram({ ...range, interval }),
        analytics.getLeaderboard({ ...range, direction: 'Download' }),
        analytics.getLeaderboard({ ...range, direction: 'Upload' }),
        analytics.getTopFiles(range),
        analytics.getDirectories(range),
        analytics.getExceptionsPareto({ ...range, direction: 'Download' }),
        analytics.getExceptionsPareto({ ...range, direction: 'Upload' }),
        analytics.getHeatmap(range),
        analytics.getGeography(range),
        analytics.getRetryFunnel(range),
        analytics.getQueueWait(range),
        analytics.getPeerRetention(range),
        analytics.getSocialActivity(range),
        analytics.getUserList({ ...range, sortBy: 'DownloadBytes', limit: 100 }),
      ]);

      setData({
        summary, prevSummary, histogram,
        leaderboard: { download: dlBoard, upload: ulBoard },
        topFiles, directories,
        exceptions: [...dlExceptions, ...ulExceptions],
        heatmap, geography, retryFunnel, queueWait, peerRetention, social,
        mapUsers: mapUsersPage.items,
      });
    } catch {
      setError('Could not load analytics. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin, rangeHours]);

  const fetchLibraryOnce = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [counts, cov, g, y, p] = await Promise.all([
        sharesApi.getFileTypeCounts(),
        analytics.getCoverage(),
        musicLibraryApi.getGenres(),
        musicLibraryApi.getYears(),
        libraryActivityApi.getPlayStats(),
      ]);
      setFileTypeCounts(counts);
      setCoverage(cov);
      setGenres(g);
      setYears(y);
      setPlayStats(p);
    } catch {
      // Non-critical — library composition tab just stays empty.
    }
  }, [isAdmin]);

  const fetchFeed = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setEvents(await eventsApi.list({ limit: 50 }));
    } catch {
      // Non-critical.
    }
  }, [isAdmin]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);
  useEffect(() => { fetchLibraryOnce(); }, [fetchLibraryOnce]);
  useEffect(() => { fetchFeed(); }, [fetchFeed]);

  const onRefresh = () => {
    setRefreshing(true);
    Promise.all([fetchAnalytics(), fetchFeed()]).finally(() => setRefreshing(false));
  };

  // Only admins get the full analytics dashboard; everyone else gets a
  // small personal summary instead (mirrors the web frontend's Overview).
  if (!isAdmin) {
    return <PersonalSummary colors={colors} />;
  }

  if (loading && !data.summary) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (error && !data.summary) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
        <Text style={s.errorText}>{error}</Text>
      </View>
    );
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

        <View style={s.tabContent}>
          {tab === 'glance' && (
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
          {tab === 'activity' && (
            <>
              <SectionHeader title="Transfer Volume" colors={colors} />
              <ActivityChart data={data.histogram} colors={colors} />
              <SectionHeader title="Activity Heatmap (90d)" colors={colors} />
              <ActivityHeatmap data={data.heatmap} colors={colors} />
            </>
          )}
          {tab === 'reliability' && (
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
          {tab === 'top' && (
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
          {tab === 'geography' && (
            <>
              <SectionHeader title="Peer Map" colors={colors} />
              <WorldMap users={data.mapUsers} colors={colors} onSelectUser={setSelectedUser} />
              <SectionHeader title="By Country" colors={colors} />
              <GeographyCard geography={data.geography} colors={colors} />
              <SectionHeader title="Peer Retention" colors={colors} />
              <PeerRetentionCard data={data.peerRetention} colors={colors} />
            </>
          )}
          {tab === 'library' && (
            <>
              <SectionHeader title="Composition" colors={colors} />
              <LibraryComposition genres={genres} years={years} playStats={playStats} colors={colors} />
              <SectionHeader title="File Types" colors={colors} />
              <FileTypeChart counts={fileTypeCounts} colors={colors} />
            </>
          )}
          {tab === 'feed' && (
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
          navigation.navigate('MoreTab', { screen: 'ChatConversation', params: { username } });
        }}
      />
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll:    { flex: 1, backgroundColor: c.bgPrimary },
    container: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
    center:    { flex: 1, backgroundColor: c.bgPrimary, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
    errorText: { fontSize: Typography.base, color: c.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl },
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
  });
}
