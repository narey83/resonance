// <copyright file="LogsScreen.tsx" company="John Narey">
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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { HubConnection } from '@microsoft/signalr';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { createLogsHubConnection } from '../../api/logsHub';
import { getLogs, LogRecord } from '../../api/logs';
import { useAfterInteractions } from '../../hooks/useDeferredEffect';
import { useAppSettings } from '../../store/appSettingsStore';
import { LIST_PERF_PROPS } from '../../lib/listPerf';

const MAX_LIVE = 500;
const PAGE_SIZE = 50;

// Backend Serilog levels ↔ short labels shown on the level filter chips.
const LEVELS = [
  { key: 'Debug',       label: 'DBG' },
  { key: 'Information', label: 'INF' },
  { key: 'Warning',     label: 'WRN' },
  { key: 'Error',       label: 'ERR' },
] as const;

const ALL_LEVELS = LEVELS.map((l) => l.key);

function levelLabel(level: string): string {
  return LEVELS.find((l) => l.key === level)?.label ?? level.slice(0, 3).toUpperCase();
}

function levelColor(c: ThemeColors, level: string): string {
  switch (level) {
    case 'Error':   return c.danger;
    case 'Warning': return c.warning;
    case 'Debug':   return c.textMuted;
    default:        return c.accent;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// A single log line; tapping expands its stack trace when one is attached.
function LogItem({
  log,
  styles,
  colors,
  expanded,
  onToggle,
}: {
  log: LogRecord;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      disabled={!log.exception}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && log.exception ? styles.rowPressed : null]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.time}>{formatTime(log.timestamp)}</Text>
        <Text style={[styles.level, { color: levelColor(colors, log.level) }]}>{levelLabel(log.level)}</Text>
        {log.context ? (
          <Text numberOfLines={1} style={styles.context}>{log.context}</Text>
        ) : null}
      </View>
      <Text selectable style={styles.message}>
        {log.message}
        {log.exception ? (
          <Text style={styles.exceptionToggle}>{expanded ? '  ▾ hide' : '  ▸ exception'}</Text>
        ) : null}
      </Text>
      {expanded && log.exception ? (
        <Text selectable style={styles.exception}>{log.exception}</Text>
      ) : null}
    </Pressable>
  );
}

function LevelChips({
  active,
  onToggle,
  styles,
}: {
  active: Record<string, boolean>;
  onToggle: (key: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.chipRow}>
      {LEVELS.map((l) => (
        <Pressable
          key={l.key}
          onPress={() => onToggle(l.key)}
          style={[styles.chip, active[l.key] ? styles.chipOn : styles.chipOff]}
        >
          <Text style={[styles.chipText, active[l.key] ? styles.chipTextOn : styles.chipTextOff]}>{l.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Live tab ─────────────────────────────────────────────────────────────────

function LiveTab({ colors, styles }: { colors: ThemeColors; styles: ReturnType<typeof makeStyles> }) {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState<LogRecord[]>([]);
  const [levels, setLevels] = useState<Record<string, boolean>>(
    Object.fromEntries(ALL_LEVELS.map((l) => [l, true])),
  );
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    let cancelled = false;
    const hub: HubConnection | null = createLogsHubConnection();
    if (!hub) return;

    hub.on('BUFFER', (buffer: LogRecord[]) => {
      if (cancelled) return;
      setConnected(true);
      setLogs([...buffer].reverse().slice(0, MAX_LIVE));
    });

    hub.on('LOG', (log: LogRecord) => {
      if (cancelled) return;
      setConnected(true);
      if (pausedRef.current) {
        setPending((prev) => [log, ...prev].slice(0, MAX_LIVE));
        return;
      }
      setLogs((prev) => [log, ...prev].slice(0, MAX_LIVE));
    });

    hub.onreconnecting(() => setConnected(false));
    hub.onreconnected(() => setConnected(true));
    hub.onclose(() => { if (!cancelled) setConnected(false); });
    hub.start().catch(() => {});

    return () => {
      cancelled = true;
      hub.stop().catch(() => {});
    };
  }, []);

  const toggleLevel = (key: string) => setLevels((prev) => ({ ...prev, [key]: !prev[key] }));

  const resume = useCallback(() => {
    setLogs((prev) => [...pending, ...prev].slice(0, MAX_LIVE));
    setPending([]);
    setPaused(false);
  }, [pending]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (!levels[l.level]) return false;
      if (q && !(l.message ?? '').toLowerCase().includes(q) && !(l.context ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [logs, levels, search]);

  const keyFor = (l: LogRecord, i: number) => `${l.timestamp}-${l.context}-${l.level}-${i}`;

  return (
    <View style={styles.tabBody}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarRow}>
          <View style={[styles.statusDot, { backgroundColor: connected ? colors.success : colors.danger }]} />
          <Text style={styles.statusText}>{connected ? 'Live' : 'Connecting…'}</Text>
          <Text style={styles.countText}>{filtered.length} / {logs.length}</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => (paused ? resume() : setPaused(true))}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          >
            <Ionicons color={paused ? colors.warning : colors.textPrimary} name={paused ? 'play' : 'pause'} size={14} />
            <Text style={styles.btnText}>
              {paused ? `Resume${pending.length ? ` (${pending.length})` : ''}` : 'Pause'}
            </Text>
          </Pressable>
        </View>
        <LevelChips active={levels} onToggle={toggleLevel} styles={styles} />
        <SearchBox value={search} onChange={setSearch} styles={styles} colors={colors} />
      </View>

      <FlatList
        {...LIST_PERF_PROPS}
        data={filtered}
        keyExtractor={keyFor}
        extraData={expanded}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>{connected ? 'No log entries match the current filters.' : 'Waiting for the server…'}</Text>
        }
        renderItem={({ item, index }) => {
          const k = keyFor(item, index);
          return (
            <LogItem
              log={item}
              styles={styles}
              colors={colors}
              expanded={expanded === k}
              onToggle={() => setExpanded((cur) => (cur === k ? null : k))}
            />
          );
        }}
      />
    </View>
  );
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ colors, styles }: { colors: ThemeColors; styles: ReturnType<typeof makeStyles> }) {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [levels, setLevels] = useState<Record<string, boolean>>(
    Object.fromEntries(ALL_LEVELS.map((l) => [l, true])),
  );
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Snapshot of the filters last submitted, so "load more" pages the same query.
  const submitted = useRef({ levels, search });

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    const { levels: lvl, search: q } = submitted.current;
    const active = ALL_LEVELS.filter((l) => lvl[l]);
    try {
      const { items, total: t } = await getLogs({
        offset,
        limit: PAGE_SIZE,
        level: active.length === ALL_LEVELS.length ? undefined : active,
        search: q.trim() || undefined,
      });
      setTotal(t);
      setLogs((prev) => (offset === 0 ? items : [...prev, ...items]));
    } catch {
      if (offset === 0) { setLogs([]); setTotal(0); }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch, deferred until screen-transition interactions settle.
  useAfterInteractions(() => { load(0); }, []);

  const runSearch = () => {
    submitted.current = { levels, search };
    setExpanded(null);
    load(0);
  };

  const toggleLevel = (key: string) => setLevels((prev) => ({ ...prev, [key]: !prev[key] }));

  const keyFor = (l: LogRecord, i: number) => `${l.timestamp}-${l.context}-${l.level}-${i}`;

  return (
    <View style={styles.tabBody}>
      <View style={styles.toolbar}>
        <LevelChips active={levels} onToggle={toggleLevel} styles={styles} />
        <View style={styles.toolbarRow}>
          <SearchBox value={search} onChange={setSearch} onSubmit={runSearch} styles={styles} colors={colors} />
          <Pressable onPress={runSearch} style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}>
            <Ionicons color={colors.textPrimary} name="search" size={14} />
            <Text style={styles.btnText}>Search</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        {...LIST_PERF_PROPS}
        data={logs}
        keyExtractor={keyFor}
        extraData={expanded}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loading && logs.length < total) load(logs.length);
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: Spacing.xl }} />
          ) : (
            <Text style={styles.empty}>No log entries match the current filters.</Text>
          )
        }
        ListFooterComponent={
          logs.length > 0 ? (
            <View style={styles.footer}>
              {loading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.footerText}>
                  {logs.length.toLocaleString()} of {total.toLocaleString()}
                </Text>
              )}
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const k = keyFor(item, index);
          return (
            <LogItem
              log={item}
              styles={styles}
              colors={colors}
              expanded={expanded === k}
              onToggle={() => setExpanded((cur) => (cur === k ? null : k))}
            />
          );
        }}
      />
    </View>
  );
}

function SearchBox({
  value,
  onChange,
  onSubmit,
  styles,
  colors,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <TextInput
      style={styles.search}
      value={value}
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      returnKeyType={onSubmit ? 'search' : 'done'}
      placeholder="Search messages…"
      placeholderTextColor={colors.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

// Shown when backend logs are disabled. Fetching/streaming server logs is opt-in
// (default off) so the app doesn't hold an open log stream unless it's wanted.
function DisabledState({
  colors,
  styles,
  onEnable,
}: {
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onEnable: () => void;
}) {
  return (
    <View style={styles.disabled}>
      <Ionicons color={colors.textDim} name="server-outline" size={44} />
      <Text style={styles.disabledTitle}>Backend logs are off</Text>
      <Text style={styles.disabledText}>
        Enable backend logs to fetch and live-stream the server's log entries here.
      </Text>
      <Pressable onPress={onEnable} style={({ pressed }) => [styles.enableBtn, pressed && styles.btnPressed]}>
        <Text style={styles.enableBtnText}>Enable backend logs</Text>
      </Pressable>
      <Text style={styles.disabledHint}>You can turn this off again in Settings → Debugging.</Text>
    </View>
  );
}

export default function LogsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<'live' | 'history'>('live');

  const backendLogs = useAppSettings((st) => st.backendLogs);
  const setBackendLogs = useAppSettings((st) => st.setBackendLogs);

  if (!backendLogs) {
    return (
      <View style={styles.screen}>
        <DisabledState colors={colors} styles={styles} onEnable={() => setBackendLogs(true)} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {(['live', 'history'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'live' ? 'Live' : 'History'}
            </Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setBackendLogs(false)}
          style={({ pressed }) => [styles.disableBtn, pressed && styles.btnPressed]}
        >
          <Ionicons color={colors.danger} name="power" size={14} />
          <Text style={styles.disableBtnText}>Disable</Text>
        </Pressable>
      </View>
      {tab === 'live'
        ? <LiveTab colors={colors} styles={styles} />
        : <HistoryTab colors={colors} styles={styles} />}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    screen:  { flex: 1, backgroundColor: c.bgPrimary },
    tabBody: { flex: 1 },

    tabs: {
      flexDirection: 'row',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
    },
    tab: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgSurface,
    },
    tabActive:      { borderColor: c.accent, backgroundColor: c.bgElevated },
    tabText:        { fontSize: Typography.sm, fontWeight: '600', color: c.textMuted },
    tabTextActive:  { color: c.textPrimary },

    disableBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgSurface,
    },
    disableBtnText: { fontSize: Typography.sm, fontWeight: '600', color: c.danger },

    toolbar: {
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

    statusDot:  { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: Typography.sm, fontWeight: '600', color: c.textPrimary },
    countText:  { fontSize: Typography.xs, color: c.textMuted, marginLeft: Spacing.sm },

    chipRow: { flexDirection: 'row', gap: Spacing.xs },
    chip: {
      paddingVertical: 4,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.sm,
      borderWidth: 1,
    },
    chipOn:       { borderColor: c.accent, backgroundColor: c.bgElevated },
    chipOff:      { borderColor: c.border, backgroundColor: 'transparent' },
    chipText:     { fontSize: Typography.xs, fontWeight: '700', fontFamily: Typography.mono },
    chipTextOn:   { color: c.textPrimary },
    chipTextOff:  { color: c.textMuted },

    search: {
      flex: 1,
      fontSize: Typography.sm,
      color: c.textPrimary,
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },

    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.bgSurface,
    },
    btnPressed: { backgroundColor: c.bgElevated },
    btnText:    { fontSize: Typography.sm, fontWeight: '600', color: c.textPrimary },

    listContent: { padding: Spacing.md, gap: Spacing.xs },

    row: {
      backgroundColor: c.bgSurface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: 2,
    },
    rowPressed: { backgroundColor: c.bgElevated },
    rowTop:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    time:    { fontSize: Typography.xs, color: c.textMuted, fontFamily: Typography.mono },
    level:   { fontSize: Typography.xs, fontWeight: '700', fontFamily: Typography.mono, minWidth: 30 },
    context: { flex: 1, fontSize: Typography.xs, color: c.textDim, fontFamily: Typography.mono, textAlign: 'right' },
    message: { fontSize: Typography.sm, color: c.textPrimary },
    exceptionToggle: { fontSize: Typography.xs, color: c.accent, fontWeight: '600' },
    exception: {
      marginTop: Spacing.xs,
      fontSize: Typography.xs,
      color: c.textDim,
      fontFamily: Typography.mono,
    },

    empty: {
      fontSize: Typography.sm,
      color: c.textMuted,
      textAlign: 'center',
      paddingVertical: Spacing.xl,
    },
    footer:     { paddingVertical: Spacing.md, alignItems: 'center' },
    footerText: { fontSize: Typography.xs, color: c.textMuted },

    disabled: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    disabledTitle: { fontSize: Typography.base, fontWeight: '600', color: c.textPrimary },
    disabledText: {
      fontSize: Typography.sm,
      color: c.textMuted,
      textAlign: 'center',
      lineHeight: 20,
    },
    enableBtn: {
      marginTop: Spacing.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.sm,
      backgroundColor: c.accent,
    },
    enableBtnText: { fontSize: Typography.sm, fontWeight: '600', color: '#fff' },
    disabledHint: { fontSize: Typography.xs, color: c.textDim, textAlign: 'center' },
  });
}
