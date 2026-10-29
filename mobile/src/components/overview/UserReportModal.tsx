// <copyright file="UserReportModal.tsx" company="John Narey">
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

import { Editorial, Radius, Spacing, Typography, ThemeColors } from '../../theme';

// Detail drill-down for a single user, reached from the leaderboard or the
// searchable user list. Unlike the web version's Files tab (which drives a
// live Soulseek directory browse), mobile's Browse screen is still an
// unimplemented placeholder — so this only covers stats + recent transfers,
// plus a hand-off into the existing Chat screen for messaging.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  getUserDetail,
  getUserNetworkInfo,
  getUserTransfers,
  UserDirectionTransferSummary,
  UserNetworkInfo,
  UserTransferRecord,
} from '../../api/analytics';
import { Card, EmptyState, fmtBytes, fmtDate, fmtNum, SectionHeader, StatRow } from './shared';

export default function UserReportModal({
  username,
  colors,
  onClose,
  onOpenChat,
}: {
  username:   string | null;
  colors:     ThemeColors;
  onClose:    () => void;
  onOpenChat: (username: string) => void;
}) {
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<Record<string, UserDirectionTransferSummary> | null>(null);
  const [network, setNetwork] = useState<UserNetworkInfo | null>(null);
  const [transfers, setTransfers] = useState<UserTransferRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getUserDetail(username),
      getUserNetworkInfo(username),
      getUserTransfers(username, { limit: 10 }),
    ]).then(([d, n, t]) => {
      if (cancelled) return;
      setDetail(d);
      setNetwork(n);
      setTransfers(t.items);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [username]);

  const dl = detail?.Download;
  const ul = detail?.Upload;

  return (
    <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} visible={username != null} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[s.container, { backgroundColor: colors.bgPrimary }]}>
        <View style={[s.header, { paddingTop: insets.top + Spacing.lg }]}>
          <Text style={s.title} numberOfLines={1}>{username}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </Pressable>
        </View>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.accent} size="large" /></View>
        ) : (
          <ScrollView contentContainerStyle={s.scroll}>
            <Pressable style={[s.chatButton, { backgroundColor: colors.accent }]} onPress={() => username && onOpenChat(username)}>
              <Ionicons name="chatbubble-outline" size={16} color="#fff" />
              <Text style={s.chatButtonText}>Message</Text>
            </Pressable>

            <SectionHeader title="Network" colors={colors} />
            <Card colors={colors}>
              <StatRow label="IP Address" value={network?.ipAddress ?? '—'} colors={colors} />
              <StatRow label="Location" value={[network?.city, network?.country].filter(Boolean).join(', ') || '—'} colors={colors} />
              <StatRow
                label="VPN / Proxy"
                value={network?.isVpn ? 'Yes' : 'No'}
                valueColor={network?.isVpn ? colors.warning : colors.success}
                colors={colors}
                last
              />
            </Card>

            {/* Direction is server-centric (matches Direction.Download/Upload everywhere else in the
                app): Download = we pulled the file from this peer, Upload = we served it to them. */}
            <SectionHeader title="Downloads (from them)" colors={colors} />
            <Card colors={colors}>
              <StatRow label="Total" value={fmtNum(dl?.statistics.total ?? 0)} colors={colors} />
              <StatRow label="Successful" value={fmtNum(dl?.statistics.successful ?? 0)} valueColor={colors.success} colors={colors} />
              <StatRow label="Errored" value={fmtNum(dl?.statistics.errored ?? 0)} valueColor={colors.danger} colors={colors} last />
            </Card>

            <SectionHeader title="Uploads (to them)" colors={colors} />
            <Card colors={colors}>
              <StatRow label="Total" value={fmtNum(ul?.statistics.total ?? 0)} colors={colors} />
              <StatRow label="Successful" value={fmtNum(ul?.statistics.successful ?? 0)} valueColor={colors.success} colors={colors} />
              <StatRow label="Errored" value={fmtNum(ul?.statistics.errored ?? 0)} valueColor={colors.danger} colors={colors} last />
            </Card>

            <SectionHeader title="Recent Transfers" colors={colors} />
            <Card colors={colors}>
              {transfers.length === 0 ? (
                <EmptyState text="No recent transfers." colors={colors} />
              ) : (
                transfers.map((t, i) => (
                  <StatRow
                    key={t.id}
                    label={`${t.direction === 'Download' ? '↓' : '↑'} ${t.filename.split(/[/\\]/).pop()}`}
                    value={`${fmtBytes(t.bytesTransferred)} · ${fmtDate(t.endedAt ?? t.requestedAt)}`}
                    colors={colors}
                    last={i === transfers.length - 1}
                  />
                ))
              )}
            </Card>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    title: { fontSize: Typography.lg, color: c.textPrimary, flex: 1, marginRight: Spacing.md, ...Editorial.heading },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxl },
    chatButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      borderRadius: Radius.md,
      paddingVertical: Spacing.md,
      marginBottom: Spacing.sm,
    },
    chatButtonText: { color: '#fff', fontWeight: '600', fontSize: Typography.base },
  });
}
