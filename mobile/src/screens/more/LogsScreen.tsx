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
  Modal,
  Pressable,
  ScrollView,
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
import {
  getLogContexts,
  getLogLevel,
  getLogs,
  LogRecord,
  setLogLevel,
} from '../../api/logs';
import { useAfterInteractions } from '../../hooks/useDeferredEffect';
import { useAppSettings } from '../../store/appSettingsStore';
import { LIST_PERF_PROPS } from '../../lib/listPerf';

const MAX_LIVE = 500;
const PAGE_SIZE = 50;

// Backend Serilog levels ↔ short labels shown on the level filter chips. Ordered loosest →
// strictest, so the index doubles as the severity ramp used to work out which levels the server
// discards before they ever reach a sink.
const LEVELS = [
  { key: 'Debug',       label: 'DBG' },
  { key: 'Information', label: 'INF' },
  { key: 'Warning',     label: 'WRN' },
  { key: 'Error',       label: 'ERR' },
] as const;

const ALL_LEVELS = LEVELS.map((l) => l.key);

// Rows in the same list item type, so FlatList can render date separators inline.
type Row =
  | { type: 'date'; day: string }
  | { type: 'log'; log: LogRecord; key: string };

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

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(day: string): string {
  const today = dayOf(new Date().toISOString());
  if (day === today) return 'Today';
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Build the flat date-separated row list the lists actually render.
function toRows(logs: LogRecord[]): Row[] {
  const out: Row[] = [];
  let lastDay: string | null = null;
  logs.forEach((log, i) => {
    const day = dayOf(log.timestamp);
    if (day !== lastDay) {
      out.push({ type: 'date', day });
      lastDay = day;
    }
    out.push({ type: 'log', log, key: `${log.timestamp}-${log.context}-${log.level}-${i}` });
  });
  return out;
}

// Contexts read as "Group / Leaf". Dimming the group lets the eye scan the part that differs.
function ContextLabel({
  context,
  styles,
}: {
  context: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const split = context.lastIndexOf(' / ');
  if (split === -1) return <Text numberOfLines={1} style={styles.contextLeaf}>{context}</Text>;
  return (
    <Text numberOfLines={1} style={styles.contextLeaf}>
      <Text style={styles.contextGroup}>{context.slice(0, split + 3)}</Text>
      {context.slice(split + 3)}
    </Text>
  );
}

function DateSeparator({ day, styles }: { day: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.dateSep}>
      <Text style={styles.dateSepText}>{formatDay(day)}</Text>
      <View style={styles.dateSepLine} />
    </View>
  );
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
  const tint = levelColor(colors, log.level);
  return (
    <Pressable
      disabled={!log.exception}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        { borderLeftColor: tint },
        log.level === 'Error' ? styles.rowError : null,
        log.level === 'Warning' ? styles.rowWarning : null,
        pressed && log.exception ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.levelTag, { color: tint }]}>{levelLabel(log.level)}</Text>
        <Text style={styles.time}>{formatTime(log.timestamp)}</Text>
        {log.context ? (
          <View style={styles.contextWrap}>
            <ContextLabel context={log.context} styles={styles} />
          </View>
        ) : null}
      </View>
      <Text selectable style={styles.message}>
        {log.message}
        {log.exception ? (
          <Text style={styles.exceptionToggle}>{expanded ? '  ▾ hide trace' : '  ▸ stack trace'}</Text>
        ) : null}
      </Text>
      {expanded && log.exception ? (
        <Text selectable style={styles.exception}>{log.exception}</Text>
      ) : null}
    </Pressable>
  );
}

// Level filter pills carrying severity colour plus a count of what each would reveal. A level the
// server is not emitting at all is drawn dashed — filtering it would do nothing.
function LevelChips({
  active,
  counts,
  onToggle,
  styles,
  colors,
  suppressedBelow,
}: {
  active: Record<string, boolean>;
  counts?: Record<string, number>;
  onToggle: (key: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  suppressedBelow?: number;
}) {
  return (
    <View style={styles.chipRow}>
      {LEVELS.map((l, i) => {
        const on = active[l.key];
        const tint = levelColor(colors, l.key);
        const suppressed = suppressedBelow !== undefined && i < suppressedBelow;
        return (
          <Pressable
            key={l.key}
            onPress={() => onToggle(l.key)}
            style={[
              styles.chip,
              on ? { borderColor: tint, backgroundColor: colors.bgElevated } : styles.chipOff,
              suppressed ? styles.chipSuppressed : null,
            ]}
          >
            <Text style={[styles.chipText, { color: on ? tint : colors.textMuted }]}>{l.label}</Text>
            {counts?.[l.key] ? (
              <Text style={[styles.chipCount, { color: on ? tint : colors.textMuted }]}>
                {counts[l.key]}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// Full-screen sheet listing every context the backend can emit, grouped and searchable — the
// mobile counterpart to the web dropdown. Beats a chip strip that only shows what happened to
// arrive and scrolls off the edge on a phone.
function ContextPicker({
  all,
  active,
  counts,
  onChange,
  styles,
  colors,
}: {
  all: string[];
  active: string[];
  counts?: Record<string, number>;
  onChange: (next: string[]) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const matching = query
      ? all.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
      : all;
    const map = new Map<string, string[]>();
    for (const context of matching) {
      const split = context.lastIndexOf(' / ');
      const group = split === -1 ? 'General' : context.slice(0, split);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(context);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === 'General') return -1;
      if (b === 'General') return 1;
      return a.localeCompare(b);
    });
  }, [all, query]);

  const toggle = (context: string) =>
    onChange(
      active.includes(context)
        ? active.filter((c) => c !== context)
        : [...active, context],
    );

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.btn,
          active.length > 0 ? { borderColor: colors.accent } : null,
          pressed && styles.btnPressed,
        ]}
      >
        <Ionicons color={active.length > 0 ? colors.accent : colors.textPrimary} name="funnel-outline" size={14} />
        <Text style={[styles.btnText, active.length > 0 ? { color: colors.accent } : null]}>
          {active.length > 0 ? `Contexts (${active.length})` : 'Contexts'}
        </Text>
      </Pressable>

      <Modal animationType="slide" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <View style={styles.sheetBackdrop}>
          <Pressable onPress={() => setOpen(false)} style={{ flex: 1 }} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Filter by context</Text>
              {active.length > 0 ? (
                <Pressable onPress={() => onChange([])}>
                  <Text style={styles.sheetClear}>Clear</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setOpen(false)}>
                <Ionicons color={colors.textMuted} name="close" size={22} />
              </Pressable>
            </View>

            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Filter contexts…"
              placeholderTextColor={colors.textMuted}
              style={styles.sheetSearch}
              value={query}
            />

            <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetBody}>
              {groups.length === 0 ? (
                <Text style={styles.empty}>No matching contexts</Text>
              ) : null}
              {groups.map(([group, contexts]) => (
                <View key={group}>
                  <Text style={styles.sheetGroup}>{group}</Text>
                  {contexts.map((context) => {
                    const split = context.lastIndexOf(' / ');
                    const on = active.includes(context);
                    return (
                      <Pressable
                        key={context}
                        onPress={() => toggle(context)}
                        style={({ pressed }) => [styles.sheetItem, pressed && styles.rowPressed]}
                      >
                        <Ionicons
                          color={on ? colors.accent : colors.textDim}
                          name={on ? 'checkbox' : 'square-outline'}
                          size={18}
                        />
                        <Text style={[styles.sheetItemText, on ? { color: colors.accent } : null]}>
                          {split === -1 ? context : context.slice(split + 3)}
                        </Text>
                        {counts?.[context] ? (
                          <Text style={styles.sheetItemCount}>{counts[context]}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

// Shown only when a level is switched on that the server never emits, so it stays actionable
// rather than becoming permanent wallpaper.
function ServerLevelNotice({
  suppressed,
  serverLevel,
  onChange,
  styles,
  colors,
}: {
  suppressed: string[];
  serverLevel: string;
  onChange: (level: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>
        No <Text style={styles.noticeStrong}>{suppressed.map(levelLabel).join(' or ')}</Text> entries
        will appear — the server discards everything below{' '}
        <Text style={styles.noticeStrong}>{serverLevel}</Text> before it is recorded.
      </Text>
      <View style={styles.chipRow}>
        {LEVELS.map((l) => (
          <Pressable
            key={l.key}
            onPress={() => onChange(l.key)}
            style={[
              styles.levelBtn,
              serverLevel === l.key ? { backgroundColor: colors.accent, borderColor: colors.accent } : null,
            ]}
          >
            <Text
              style={[
                styles.levelBtnText,
                serverLevel === l.key ? { color: '#fff' } : null,
              ]}
            >
              {l.label}
            </Text>
          </Pressable>
        ))}
      </View>
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
  const [knownContexts, setKnownContexts] = useState<string[]>([]);
  const [seenContexts, setSeenContexts] = useState<string[]>([]);
  const [activeContexts, setActiveContexts] = useState<string[]>([]);
  const [serverLevel, setServerLevel] = useState<string | null>(null);

  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    getLogContexts().then(setKnownContexts).catch(() => {});
    getLogLevel().then(setServerLevel).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hub: HubConnection | null = createLogsHubConnection();
    if (!hub) return;

    hub.on('BUFFER', (buffer: LogRecord[]) => {
      if (cancelled) return;
      setConnected(true);
      const next = [...buffer].reverse().slice(0, MAX_LIVE);
      setLogs(next);
      setSeenContexts([...new Set(next.map((l) => l.context).filter(Boolean) as string[])]);
    });

    hub.on('LOG', (log: LogRecord) => {
      if (cancelled) return;
      setConnected(true);
      if (log.context) {
        setSeenContexts((prev) => (prev.includes(log.context!) ? prev : [...prev, log.context!]));
      }
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

  // Matching is split from level/context selection so each pill can show how many entries it
  // *would* reveal, rather than leaving the user guessing what a disabled filter is hiding.
  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        (l.message ?? '').toLowerCase().includes(q) ||
        (l.context ?? '').toLowerCase().includes(q),
    );
  }, [logs, search]);

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of matched) {
      if (activeContexts.length > 0 && !activeContexts.includes(l.context ?? '')) continue;
      counts[l.level] = (counts[l.level] ?? 0) + 1;
    }
    return counts;
  }, [matched, activeContexts]);

  const contextCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of matched) {
      if (!levels[l.level] || !l.context) continue;
      counts[l.context] = (counts[l.context] ?? 0) + 1;
    }
    return counts;
  }, [matched, levels]);

  const filtered = useMemo(
    () =>
      matched.filter(
        (l) =>
          levels[l.level] &&
          (activeContexts.length === 0 || activeContexts.includes(l.context ?? '')),
      ),
    [matched, levels, activeContexts],
  );

  const rows = useMemo(() => toRows(filtered), [filtered]);

  const allContexts = useMemo(
    () => [...new Set([...knownContexts, ...seenContexts])].sort((a, b) => a.localeCompare(b)),
    [knownContexts, seenContexts],
  );

  const serverFloor = serverLevel ? ALL_LEVELS.indexOf(serverLevel as typeof ALL_LEVELS[number]) : 0;
  const suppressed = ALL_LEVELS.filter((l, i) => levels[l] && i < serverFloor);

  const changeServerLevel = (level: string) => {
    setServerLevel(level);
    setLogLevel(level).catch(() => { getLogLevel().then(setServerLevel).catch(() => {}); });
  };

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
        <View style={styles.toolbarRow}>
          <LevelChips
            active={levels}
            colors={colors}
            counts={levelCounts}
            onToggle={toggleLevel}
            styles={styles}
            suppressedBelow={serverLevel ? serverFloor : undefined}
          />
          <View style={{ flex: 1 }} />
          <ContextPicker
            active={activeContexts}
            all={allContexts}
            colors={colors}
            counts={contextCounts}
            onChange={setActiveContexts}
            styles={styles}
          />
        </View>
        <SearchBox value={search} onChange={setSearch} styles={styles} colors={colors} />
        {suppressed.length > 0 && serverLevel ? (
          <ServerLevelNotice
            colors={colors}
            onChange={changeServerLevel}
            serverLevel={serverLevel}
            styles={styles}
            suppressed={[...suppressed]}
          />
        ) : null}
      </View>

      <FlatList
        {...LIST_PERF_PROPS}
        data={rows}
        keyExtractor={(row) => (row.type === 'date' ? `date-${row.day}` : row.key)}
        extraData={expanded}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>{connected ? 'No log entries match the current filters.' : 'Waiting for the server…'}</Text>
        }
        renderItem={({ item }) =>
          item.type === 'date' ? (
            <DateSeparator day={item.day} styles={styles} />
          ) : (
            <LogItem
              log={item.log}
              styles={styles}
              colors={colors}
              expanded={expanded === item.key}
              onToggle={() => setExpanded((cur) => (cur === item.key ? null : item.key))}
            />
          )
        }
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
  const [knownContexts, setKnownContexts] = useState<string[]>([]);
  const [activeContexts, setActiveContexts] = useState<string[]>([]);

  // Snapshot of the filters last submitted, so "load more" pages the same query.
  const submitted = useRef({ levels, search, activeContexts });

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    const { levels: lvl, search: q, activeContexts: ctx } = submitted.current;
    const active = ALL_LEVELS.filter((l) => lvl[l]);
    try {
      const { items, total: t } = await getLogs({
        offset,
        limit: PAGE_SIZE,
        level: active.length === ALL_LEVELS.length ? undefined : active,
        context: ctx.length > 0 ? ctx : undefined,
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

  useEffect(() => {
    getLogContexts().then(setKnownContexts).catch(() => {});
  }, []);

  const runSearch = () => {
    submitted.current = { levels, search, activeContexts };
    setExpanded(null);
    load(0);
  };

  const toggleLevel = (key: string) => setLevels((prev) => ({ ...prev, [key]: !prev[key] }));

  const rows = useMemo(() => toRows(logs), [logs]);

  return (
    <View style={styles.tabBody}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarRow}>
          <LevelChips active={levels} colors={colors} onToggle={toggleLevel} styles={styles} />
          <View style={{ flex: 1 }} />
          <ContextPicker
            active={activeContexts}
            all={knownContexts}
            colors={colors}
            onChange={setActiveContexts}
            styles={styles}
          />
        </View>
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
        data={rows}
        keyExtractor={(row) => (row.type === 'date' ? `date-${row.day}` : row.key)}
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
        renderItem={({ item }) =>
          item.type === 'date' ? (
            <DateSeparator day={item.day} styles={styles} />
          ) : (
            <LogItem
              log={item.log}
              styles={styles}
              colors={colors}
              expanded={expanded === item.key}
              onToggle={() => setExpanded((cur) => (cur === item.key ? null : item.key))}
            />
          )
        }
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
        Enable backend logs to fetch and live-stream the server&apos;s log entries here.
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

    chipRow: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.sm,
      borderWidth: 1,
    },
    chipOff:        { borderColor: c.border, backgroundColor: 'transparent', opacity: 0.5 },
    chipSuppressed: { borderStyle: 'dashed', opacity: 0.4 },
    chipText:       { fontSize: Typography.xs, fontWeight: '700', fontFamily: Typography.mono },
    chipCount:      { fontSize: 9, fontWeight: '600' },

    levelBtn: {
      paddingVertical: 3,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    levelBtnText: {
      fontSize: Typography.xs,
      fontWeight: '700',
      fontFamily: Typography.mono,
      color: c.textMuted,
    },

    notice: {
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.warning,
      backgroundColor: c.bgSurface,
    },
    noticeText:   { fontSize: Typography.xs, color: c.textMuted, lineHeight: 17 },
    noticeStrong: { color: c.textPrimary, fontWeight: '700' },

    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: {
      maxHeight: '75%',
      backgroundColor: c.bgPrimary,
      borderTopLeftRadius: Radius.md,
      borderTopRightRadius: Radius.md,
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    sheetHead:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    sheetTitle: { flex: 1, fontSize: Typography.base, fontWeight: '700', color: c.textPrimary },
    sheetClear: { fontSize: Typography.sm, fontWeight: '600', color: c.accent },
    sheetSearch: {
      fontSize: Typography.sm,
      color: c.textPrimary,
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    sheetBody: { flexGrow: 0 },
    sheetGroup: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
      color: c.textMuted,
      textTransform: 'uppercase',
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xs,
    },
    sheetItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.sm,
    },
    sheetItemText:  { flex: 1, fontSize: Typography.sm, color: c.textPrimary },
    sheetItemCount: { fontSize: Typography.xs, color: c.textMuted, fontFamily: Typography.mono },

    dateSep: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xs,
    },
    dateSepText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
      color: c.textMuted,
      textTransform: 'uppercase',
    },
    dateSepLine: { flex: 1, height: 1, backgroundColor: c.border },

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
      borderLeftWidth: 3,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: 2,
    },
    rowPressed: { backgroundColor: c.bgElevated },
    rowWarning: { backgroundColor: c.bgElevated },
    rowError:   { backgroundColor: c.bgElevated, borderColor: c.danger },
    rowTop:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    time:     { fontSize: Typography.xs, color: c.textMuted, fontFamily: Typography.mono },
    levelTag: { fontSize: Typography.xs, fontWeight: '700', fontFamily: Typography.mono, minWidth: 30 },
    contextWrap:  { flex: 1, alignItems: 'flex-end' },
    contextLeaf:  { fontSize: Typography.xs, color: c.textMuted, fontFamily: Typography.mono },
    contextGroup: { color: c.textDim },
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
