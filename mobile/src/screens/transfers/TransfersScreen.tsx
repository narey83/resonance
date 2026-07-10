// <copyright file="TransfersScreen.tsx" company="John Narey">
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

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme';
import { Radius, Spacing, Typography } from '../../theme';
import { useTransferStore } from '../../store/transferStore';
import type { Transfer, TransferDir } from '../../api/transfers';
import UserActionSheet from '../../components/UserActionSheet';

// ─── Types ─────────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'active' | 'queued' | 'failed' | 'done';

type FlatItem =
  | { type: 'user';   key: string; username: string; transfers: Transfer[]; isExpanded: boolean }
  | { type: 'folder'; key: string; username: string; folder: string; label: string; transfers: Transfer[]; isOpen: boolean }
  | { type: 'track';  key: string; transfer: Transfer };

// ─── State helpers ──────────────────────────────────────────────────────────────

const ACTIVE_STATES = new Set(['InProgress', 'Initializing']);
const QUEUED_STATES = new Set(['Requested', 'Queued', 'Queued, Locally', 'Queued, Remotely']);

function stateCategory(desc: string | null | undefined): 'active' | 'queued' | 'done' | 'failed' {
  if (!desc) return 'failed';
  if (ACTIVE_STATES.has(desc)) return 'active';
  if (QUEUED_STATES.has(desc)) return 'queued';
  if (desc === 'Completed, Succeeded' || desc === 'Completed') return 'done';
  if (desc.startsWith('Completed')) return 'failed';
  return 'failed';
}

function stateColor(desc: string | null | undefined, colors: ThemeColors): string {
  switch (stateCategory(desc)) {
    case 'active': return colors.accent;
    case 'queued': return colors.queued;
    case 'done':   return colors.success;
    default:       return colors.danger;
  }
}

function matchesFilter(t: Transfer, f: FilterType): boolean {
  return f === 'all' || stateCategory(t.stateDescription) === f;
}

function dominantColor(transfers: Transfer[], colors: ThemeColors): string {
  const cats = transfers.map(t => stateCategory(t.stateDescription));
  if (cats.includes('active')) return colors.accent;
  if (cats.includes('queued')) return colors.queued;
  if (cats.includes('failed')) return colors.danger;
  return colors.success;
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1024)          return `${b} B`;
  if (b < 1_048_576)     return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1_073_741_824).toFixed(2)} GB`;
}

function fmtEta(remaining: number, speed: number): string | null {
  if (speed <= 0) return null;
  const s = Math.round(remaining / speed);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function getFileName(path: string | null | undefined): string {
  if (!path) return '';
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;
}

function getDirectory(path: string | null | undefined): string {
  if (!path) return '';
  const p = path.replace(/\\/g, '/');
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : '';
}

function getFolderLabel(dirPath: string): string {
  const parts = dirPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return dirPath;
  return parts.length >= 2 ? `${parts[parts.length - 2]} / ${parts[parts.length - 1]}` : parts[parts.length - 1];
}

function stateLabel(t: Transfer, dir: TransferDir): string {
  if (!t.stateDescription) return '';
  switch (t.stateDescription) {
    case 'InProgress': {
      if (t.averageSpeed > 0) {
        const spd = `${fmtBytes(t.averageSpeed)}/s`;
        const eta = fmtEta(t.bytesRemaining, t.averageSpeed);
        return eta ? `${spd} · ${eta}` : spd;
      }
      return dir === 'download' ? 'Downloading…' : 'Uploading…';
    }
    case 'Initializing':         return 'Connecting…';
    case 'Requested':            return 'Requested';
    case 'Queued':
    case 'Queued, Locally':      return 'Queued';
    case 'Queued, Remotely':
      return t.placeInQueue != null ? `Queued remotely · #${t.placeInQueue}` : 'Queued remotely';
    case 'Completed, Succeeded': return 'Completed';
    case 'Completed, Cancelled': return 'Cancelled';
    case 'Completed, TimedOut':  return 'Timed out';
    case 'Completed, Rejected':  return 'Rejected';
    case 'Completed, Errored':   return t.exception ?? 'Error';
    default: return t.stateDescription;
  }
}

// ─── Flat list builder ─────────────────────────────────────────────────────────

function buildFlatList(
  transfers: Transfer[],
  filter: FilterType,
  openFolder: string | null,
): FlatItem[] {
  const filtered = transfers.filter(t => matchesFilter(t, filter));

  const userOrder: string[] = [];
  const userFolders: Record<string, Record<string, Transfer[]>> = {};

  for (const t of filtered) {
    const folder = getDirectory(t.filename);
    if (!userFolders[t.username]) { userFolders[t.username] = {}; userOrder.push(t.username); }
    if (!userFolders[t.username][folder]) userFolders[t.username][folder] = [];
    userFolders[t.username][folder].push(t);
  }

  const items: FlatItem[] = [];

  for (const username of userOrder) {
    const folders = userFolders[username];
    const allTransfers = (Object.values(folders) as Transfer[][]).flat();

    items.push({ type: 'user', key: `u:${username}`, username, transfers: allTransfers, isExpanded: true });

    for (const [folder, folderTransfers] of Object.entries(folders)) {
      const folderKey = `${username}:::${folder}`;
      const isOpen = openFolder === folderKey;
      items.push({
        type: 'folder',
        key: `f:${folderKey}`,
        username,
        folder,
        label: getFolderLabel(folder) || folder,
        transfers: folderTransfers,
        isOpen,
      });
      if (isOpen) {
        for (const transfer of folderTransfers) {
          items.push({ type: 'track', key: `t:${transfer.id}`, transfer });
        }
      }
    }
  }

  return items;
}

// ─── State bar (proportional breakdown strip for user header) ─────────────────

function StateBar({ transfers, colors }: { transfers: Transfer[]; colors: ThemeColors }) {
  const total = transfers.length;
  if (total === 0) return null;
  const segments = (['active', 'queued', 'failed', 'done'] as const)
    .map(cat => ({
      cat,
      count: transfers.filter(t => stateCategory(t.stateDescription) === cat).length,
      color: stateColor(
        cat === 'active' ? 'InProgress' :
        cat === 'queued' ? 'Queued' :
        cat === 'done'   ? 'Completed, Succeeded' : 'Completed, Errored',
        colors,
      ),
    }))
    .filter(s => s.count > 0);
  return (
    <View style={{ flexDirection: 'row', height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 5 }}>
      {segments.map(s => (
        <View key={s.cat} style={{ flex: s.count, backgroundColor: s.color }} />
      ))}
    </View>
  );
}

// ─── Status dots (shared by folder headers) ────────────────────────────────────

function StatusDots({ transfers, colors, styles }: {
  transfers: Transfer[];
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const cats = (['active', 'queued', 'failed', 'done'] as const)
    .map(cat => ({ cat, n: transfers.filter(t => stateCategory(t.stateDescription) === cat).length }))
    .filter(({ n }) => n > 0);

  if (cats.length === 0) return null;
  return (
    <View style={styles.dots}>
      {cats.map(({ cat, n }) => (
        <View key={cat} style={styles.dotGroup}>
          <View style={[styles.dot, { backgroundColor: stateColor(
            cat === 'active' ? 'InProgress' :
            cat === 'queued' ? 'Queued' :
            cat === 'done'   ? 'Completed, Succeeded' : 'Completed, Errored',
            colors,
          )}]} />
          <Text style={styles.dotCount}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Transfer item (track row) ─────────────────────────────────────────────────

const TransferItem = React.memo(
  function TransferItem({ transfer: t, dir, onAction }: {
    transfer: Transfer;
    dir: TransferDir;
    onAction: (t: Transfer) => void;
  }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeItemStyles(colors), [colors]);

  const cat   = stateCategory(t.stateDescription);
  const color = stateColor(t.stateDescription, colors);
  const name  = getFileName(t.filename);
  const label = stateLabel(t, dir);
  const rawPct = t.percentComplete ?? 0;
  const pct   = isNaN(rawPct) ? 0 : Math.min(100, Math.max(0, rawPct));

  const isCompleted = cat === 'done' || cat === 'failed';
  const actionColor = isCompleted ? colors.textMuted : `${colors.danger}bb`;

  return (
    <View style={[styles.container, { borderLeftColor: color, backgroundColor: `${color}26` }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">{name}</Text>
          <Text style={styles.label} numberOfLines={1}>
            {label}
            {cat === 'active' && pct > 0 ? `  ${Math.round(pct)}%` : ''}
            {cat === 'done' && t.size > 0 ? `  ${fmtBytes(t.size)}` : ''}
            {t.attempts > 1 ? `  ×${t.attempts}` : ''}
          </Text>
        </View>
        <Pressable onPress={() => onAction(t)} hitSlop={10} style={styles.actionBtn}>
          <Ionicons
            name={isCompleted ? 'close-outline' : 'close-circle-outline'}
            size={16}
            color={actionColor}
          />
        </Pressable>
      </View>
    </View>
  );
  },
  (prev, next) =>
    prev.transfer.id               === next.transfer.id &&
    prev.transfer.stateDescription === next.transfer.stateDescription &&
    prev.transfer.bytesTransferred === next.transfer.bytesTransferred &&
    prev.transfer.averageSpeed     === next.transfer.averageSpeed &&
    prev.transfer.placeInQueue     === next.transfer.placeInQueue &&
    prev.dir                       === next.dir &&
    prev.onAction                  === next.onAction,
);

const makeItemStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      paddingLeft: Spacing.xl,
      borderLeftWidth: 3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    dot:       { width: 6, height: 6, borderRadius: 3, flexShrink: 0, marginTop: 1 },
    info:      { flex: 1, gap: 1 },
    name:      { fontSize: Typography.sm, fontWeight: '500', color: colors.textPrimary },
    label:     { fontSize: Typography.xs, color: colors.textMuted },
    actionBtn: { padding: 4, marginLeft: 2 },
  });

// ─── Filters ────────────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: 'all',    label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'queued', label: 'Queued' },
  { key: 'failed', label: 'Failed' },
  { key: 'done',   label: 'Done' },
];

// ─── Main screen ────────────────────────────────────────────────────────────────

export default function TransfersScreen() {
  const { colors } = useTheme();
  const downloads       = useTransferStore(s => s.downloads);
  const uploads         = useTransferStore(s => s.uploads);
  const downloadsLoaded = useTransferStore(s => s.downloadsLoaded);
  const uploadsLoaded   = useTransferStore(s => s.uploadsLoaded);
  const loadDownloads   = useTransferStore(s => s.loadDownloads);
  const loadUploads     = useTransferStore(s => s.loadUploads);
  const storeCancel     = useTransferStore(s => s.cancel);
  const storeClear      = useTransferStore(s => s.clearCompleted);

  const [dir, setDir]               = useState<TransferDir>('download');
  const [filter, setFilter]         = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [actionUser, setActionUser] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const data   = dir === 'download' ? downloads : uploads;
  const loaded = dir === 'download' ? downloadsLoaded : uploadsLoaded;
  const loadFn = dir === 'download' ? loadDownloads : loadUploads;

  const flatItems = useMemo(
    () => buildFlatList(data, filter, openFolder),
    [data, filter, openFolder],
  );

  useFocusEffect(
    useCallback(() => {
      loadFn();
      intervalRef.current = setInterval(loadFn, 2000);
      return () => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      };
    }, [loadFn]),
  );

  const onDirChange = useCallback((d: TransferDir) => {
    setDir(d);
    setFilter('all');
    setOpenFolder(null);
  }, []);

  const toggleFolder = useCallback((folderKey: string) => {
    setOpenFolder(prev => prev === folderKey ? null : folderKey);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFn();
    setRefreshing(false);
  }, [loadFn]);

  const onClearDone = useCallback(() => {
    Alert.alert(
      'Clear Completed',
      `Remove all completed ${dir === 'download' ? 'downloads' : 'uploads'} from the list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => storeClear(dir) },
      ],
    );
  }, [dir, storeClear]);

  const onAction = useCallback((t: Transfer) => {
    const cat = stateCategory(t.stateDescription);
    if (cat === 'done' || cat === 'failed') {
      storeCancel(dir, t.username, t.id, true);
    } else {
      Alert.alert(
        'Cancel Transfer',
        `Cancel "${getFileName(t.filename)}"?`,
        [
          { text: 'Keep', style: 'cancel' },
          { text: 'Cancel Transfer', style: 'destructive', onPress: () => storeCancel(dir, t.username, t.id, false) },
        ],
      );
    }
  }, [dir, storeCancel]);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  const showSpinner = !loaded && data.length === 0;

  const renderItem = useCallback(({ item }: { item: FlatItem }) => {
    if (item.type === 'user') {
      return (
        <Pressable style={styles.userHeader} onLongPress={() => setActionUser(item.username)}>
          <View style={styles.userHeaderRow}>
            <Ionicons name="person-outline" size={12} color={colors.textMuted} />
            <Text style={styles.userLabel}>{item.username}</Text>
            <Text style={styles.headerCount}>({item.transfers.length})</Text>
          </View>
          <StateBar transfers={item.transfers} colors={colors} />
        </Pressable>
      );
    }

    if (item.type === 'folder') {
      const fColor = dominantColor(item.transfers, colors);
      return (
        <Pressable
          style={[styles.folderHeader, { borderLeftColor: fColor, backgroundColor: `${fColor}26` }]}
          onPress={() => toggleFolder(item.key.slice(2))}
        >
          <Ionicons name="folder-outline" size={12} color={fColor} />
          <Text style={[styles.folderLabel, { color: fColor }]} numberOfLines={1}>
            {item.label}
          </Text>
          {item.isOpen
            ? <Text style={styles.headerCount}>({item.transfers.length})</Text>
            : <StatusDots transfers={item.transfers} colors={colors} styles={styles} />
          }
          <Ionicons
            name={item.isOpen ? 'chevron-down' : 'chevron-forward'}
            size={12} color={fColor}
          />
        </Pressable>
      );
    }

    return <TransferItem transfer={item.transfer} dir={dir} onAction={onAction} />;
  }, [styles, colors, dir, onAction, toggleFolder, setActionUser]);

  return (
    <View style={styles.root}>
      {/* Segment control */}
      <View style={styles.segWrapper}>
        {(['download', 'upload'] as TransferDir[]).map(d => {
          const active = dir === d;
          return (
            <Pressable
              key={d}
              onPress={() => onDirChange(d)}
              style={[styles.segPill, active && { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.segLabel, { color: active ? '#fff' : colors.textMuted }]}>
                {d === 'download' ? 'Downloads' : 'Uploads'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Filter bar */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPills}>
          {FILTER_OPTIONS.map(f => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[
                  styles.filterPill,
                  { borderColor: active ? colors.accent : colors.border },
                  active && { backgroundColor: `${colors.accent}22` },
                ]}
              >
                <Text style={[styles.filterLabel, { color: active ? colors.accent : colors.textMuted, fontWeight: active ? '600' : '400' }]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={onClearDone} style={styles.clearBtn} hitSlop={8}>
          <Text style={[styles.filterLabel, { color: colors.textMuted }]}>Clear Done</Text>
        </Pressable>
      </View>

      {/* Content */}
      {showSpinner ? (
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      ) : (
        <FlatList<FlatItem>
          data={flatItems}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={dir === 'download' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                size={52}
                color={colors.textDim}
              />
              <Text style={styles.emptyTitle}>
                No {dir === 'download' ? 'downloads' : 'uploads'}
              </Text>
              <Text style={styles.emptySub}>
                {filter !== 'all'
                  ? 'Try a different filter'
                  : dir === 'download'
                  ? 'Files you download will appear here'
                  : 'Files being uploaded will appear here'}
              </Text>
            </View>
          }
          contentContainerStyle={flatItems.length === 0 ? styles.listEmpty : undefined}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
          removeClippedSubviews
        />
      )}

      <UserActionSheet username={actionUser} onClose={() => setActionUser(null)} />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgPrimary },

    segWrapper: {
      flexDirection: 'row',
      margin: Spacing.md,
      marginBottom: Spacing.sm,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgElevated,
      overflow: 'hidden',
      padding: 2,
    },
    segPill:  { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.full },
    segLabel: { fontSize: Typography.sm, fontWeight: '600' },

    filterBar:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
    filterPills: { flexDirection: 'row', gap: Spacing.xs },
    filterPill:  { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1 },
    filterLabel: { fontSize: Typography.xs },
    clearBtn:    { paddingHorizontal: Spacing.xs, paddingVertical: 4, marginLeft: Spacing.xs },

    userHeader: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.sm,
      backgroundColor: colors.bgPrimary,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    userHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    userLabel:     { fontSize: Typography.xs, fontWeight: '600', color: colors.textMuted, flex: 1 },

    folderHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: Spacing.md,
      paddingLeft: Spacing.lg,
      paddingVertical: Spacing.xs + 2,
      borderLeftWidth: 3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    folderLabel: { fontSize: Typography.xs, fontWeight: '500', color: colors.textMuted, flex: 1 },

    headerCount: { fontSize: Typography.xs, color: colors.textDim },

    dots:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    dotGroup: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    dot:      { width: 6, height: 6, borderRadius: 3 },
    dotCount: { fontSize: Typography.xs, color: colors.textDim },

    spinner:   { marginTop: 48 },
    listEmpty: { flex: 1, justifyContent: 'center' },
    empty:     { alignItems: 'center', gap: Spacing.sm, paddingVertical: 60 },
    emptyTitle: {
      fontSize: Typography.lg,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: Spacing.sm,
    },
    emptySub: {
      fontSize: Typography.sm,
      color: colors.textMuted,
      textAlign: 'center',
      paddingHorizontal: Spacing.xl,
    },
  });
