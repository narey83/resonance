// <copyright file="BrowseUserScreen.tsx" company="John Narey">
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as browseApi from '../../api/browse';
import type { DirectoryFile } from '../../api/users';
import { useAuthStore } from '../../store/auth';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography } from '../../theme';
import type { ThemeColors } from '../../theme';
import DownloadModal, { DownloadTarget } from '../../components/DownloadModal';
import UserActionSheet from '../../components/UserActionSheet';
import type { BrowseStackParamList } from '../../navigation/MainTabs';

type Props = NativeStackScreenProps<BrowseStackParamList, 'BrowseUser'>;

const FOLDER_ROW_HEIGHT = 48;
const FILE_ROW_HEIGHT = 52;

const LOSSLESS_EXTS = new Set(['flac', 'alac', 'ape', 'aif', 'aiff', 'wav']);

// ─── Lazily-loaded share model ────────────────────────────────────────────────
// Only the folder list is fetched up front (large shares serialize to tens of
// MB with file detail — a 258k-file share froze the JS thread during JSON
// parse). Each folder's files are fetched from the peer on first expand or
// select, then normalized once with precomputed paths and quality flags.

interface ShareFile {
  fullPath: string;
  name: string;
  size: number;
  meta: string;
  searchText: string;
  isLossless: boolean;
  isHq: boolean;
  isVbr: boolean;
}

interface ShareFolder {
  path: string;
  label: string;
  searchText: string;
  locked: boolean;
  fileCount: number;
  files: ShareFile[] | null;
}

type Row =
  | { type: 'folder'; key: string; folder: ShareFolder }
  | { type: 'file'; key: string; file: ShareFile }
  | { type: 'loading'; key: string };

function fmtBytes(b: number): string {
  if (b < 1_048_576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1_073_741_824).toFixed(2)} GB`;
}

function qualityLabel(f: {
  extension: string;
  bitDepth?: number | null;
  sampleRate?: number | null;
  bitRate?: number | null;
  isVariableBitRate?: boolean | null;
}): string {
  if (f.bitDepth && f.sampleRate) {
    return `${f.extension.toUpperCase()} ${f.bitDepth}/${(f.sampleRate / 1000).toFixed(0)}kHz`;
  }
  if (f.bitRate) return `${f.extension.toUpperCase()} ${f.bitRate}kbps${f.isVariableBitRate ? ' VBR' : ''}`;
  return f.extension ? f.extension.toUpperCase() : '';
}

function buildFiles(folderPath: string, files: DirectoryFile[]): ShareFile[] {
  const sep = folderPath.includes('\\') ? '\\' : '/';
  return files.map(f => {
    const extension = (f.extension || f.filename.split('.').pop() || '').toLowerCase();
    const length = f.length
      ? ` · ${Math.floor(f.length / 60)}:${String(f.length % 60).padStart(2, '0')}`
      : '';
    return {
      fullPath: `${folderPath}${sep}${f.filename}`,
      name: f.filename,
      size: f.size,
      meta: `${qualityLabel(f)}${f.size > 0 ? ` · ${fmtBytes(f.size)}` : ''}${length}`,
      searchText: f.filename.toLowerCase(),
      isLossless: LOSSLESS_EXTS.has(extension),
      isHq: (f.bitRate ?? 0) >= 320,
      isVbr: f.isVariableBitRate === true,
    };
  });
}

function fileMatchesPills(f: ShareFile, pills: Set<PillKey>): boolean {
  if (pills.has('lossless') && !f.isLossless) return false;
  if (pills.has('hq') && !f.isHq) return false;
  if (pills.has('vbr') && !f.isVbr) return false;
  return true;
}

// ─── Rows (memoized; only re-render when their own props change) ─────────────

const FolderRow = React.memo(function FolderRow({
  label, locked, count, expanded, allSelected, colors, onToggleExpand, onToggleSelect,
}: {
  label: string;
  locked: boolean;
  count: number;
  expanded: boolean;
  allSelected: boolean;
  colors: ThemeColors;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
}) {
  const s = useMemo(() => makeRowStyles(colors), [colors]);
  return (
    <Pressable style={({ pressed }) => [s.folderRow, pressed && { opacity: 0.7 }]} onPress={onToggleExpand}>
      <Pressable onPress={onToggleSelect} hitSlop={8}>
        <View style={[s.checkbox, allSelected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
          {allSelected && <Ionicons name="checkmark" size={11} color="#fff" />}
        </View>
      </Pressable>
      <Ionicons
        name={expanded ? 'chevron-down' : 'chevron-forward'}
        size={14}
        color={colors.textMuted}
      />
      <Ionicons
        name={locked ? 'lock-closed-outline' : 'folder-outline'}
        size={15}
        color={colors.textMuted}
      />
      <Text style={s.folderLabel} numberOfLines={1}>{label}</Text>
      <Text style={s.folderCount}>{count}</Text>
    </Pressable>
  );
});

const FileRowItem = React.memo(function FileRowItem({
  name, meta, selected, colors, onToggle,
}: {
  name: string;
  meta: string;
  selected: boolean;
  colors: ThemeColors;
  onToggle: () => void;
}) {
  const s = useMemo(() => makeRowStyles(colors), [colors]);
  return (
    <Pressable
      style={({ pressed }) => [s.fileRow, selected && s.fileRowSelected, pressed && { opacity: 0.7 }]}
      onPress={onToggle}
    >
      <View style={[s.checkbox, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
        {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
      </View>
      <View style={s.fileInfo}>
        <Text style={s.fileName} numberOfLines={1} ellipsizeMode="middle">{name}</Text>
        <Text style={s.fileMeta} numberOfLines={1}>{meta}</Text>
      </View>
    </Pressable>
  );
});

const LoadingRow = React.memo(function LoadingRow({ colors }: { colors: ThemeColors }) {
  const s = useMemo(() => makeRowStyles(colors), [colors]);
  return (
    <View style={s.loadingRow}>
      <ActivityIndicator size="small" color={colors.accent} />
      <Text style={s.fileMeta}>Loading files…</Text>
    </View>
  );
});

const makeRowStyles = (c: ThemeColors) => StyleSheet.create({
  folderRow: {
    height: FOLDER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: c.bgElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  folderLabel: { flex: 1, fontSize: Typography.sm, fontWeight: '600', color: c.textPrimary },
  folderCount: { fontSize: Typography.xs, color: c.textMuted },
  fileRow: {
    height: FILE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.xl,
    paddingRight: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  fileRowSelected: { backgroundColor: `${c.accent}14` },
  fileInfo: { flex: 1, gap: 2 },
  fileName: { fontSize: Typography.sm, color: c.textPrimary, fontWeight: '500' },
  fileMeta: { fontSize: Typography.xs, color: c.textMuted },
  loadingRow: {
    height: FILE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.xl,
    gap: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

const FILTER_PILLS = [
  { key: 'lossless', label: 'Lossless' },
  { key: 'hq', label: '≥ 320kbps' },
  { key: 'vbr', label: 'VBR' },
] as const;

type PillKey = (typeof FILTER_PILLS)[number]['key'];

export default function BrowseUserScreen({ route, navigation }: Props) {
  const { username } = route.params;
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [folders, setFolders] = useState<ShareFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pills, setPills] = useState<Set<PillKey>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Map<string, ShareFile>>(new Map());
  const loadingFoldersRef = useRef<Set<string>>(new Set());

  const [showModal, setShowModal] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget>('server');
  const [destination, setDestination] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [actionUser, setActionUser] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({
      title: username,
      headerRight: () => (
        <Pressable hitSlop={8} onPress={() => setActionUser(username)}>
          <Ionicons color={colors.accent} name="ellipsis-horizontal" size={22} />
        </Pressable>
      ),
    });
  }, [navigation, username, colors]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // ── Fetch the folder list, polling transfer progress while it downloads ────
  useEffect(() => {
    let cancelled = false;

    const poll = setInterval(() => {
      browseApi.getBrowseStatus(username).then(status => {
        if (!cancelled && status) setProgress(Math.round(status.percentComplete || 0));
      });
    }, 500);

    browseApi.browseFolders(username)
      .then(list => {
        if (cancelled) return;
        setFolders(list
          .filter(f => f.fileCount > 0)
          .map(f => ({
            path: f.name,
            label: f.name.split(/[\\/]/).filter(Boolean).pop() ?? f.name,
            searchText: f.name.toLowerCase(),
            locked: f.locked,
            fileCount: f.fileCount,
            files: null,
          }))
          // PERF: plain operators on the precomputed lowercase key — localeCompare on
          // Hermes goes through ICU per call and froze the JS thread for 30s+ on
          // multi-thousand-folder shares (see sortList in LibraryScreen).
          .sort((a, b) => (a.searchText < b.searchText ? -1 : a.searchText > b.searchText ? 1 : 0)));
      })
      .catch(() => {
        if (!cancelled) setError('Could not browse this user — they may be offline or unreachable');
      })
      .finally(() => {
        clearInterval(poll);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [username]);

  // ── Lazy folder loading ─────────────────────────────────────────────────────
  const loadFolder = useCallback(async (path: string): Promise<ShareFile[]> => {
    if (loadingFoldersRef.current.has(path)) return [];
    loadingFoldersRef.current.add(path);
    try {
      const files = await browseApi.getFolderFiles(username, path);
      const built = buildFiles(path, files);
      setFolders(prev => prev.map(f => (f.path === path ? { ...f, files: built } : f)));
      return built;
    } catch {
      setFolders(prev => prev.map(f => (f.path === path ? { ...f, files: [] } : f)));
      return [];
    } finally {
      loadingFoldersRef.current.delete(path);
    }
  }, [username]);

  const toggleExpand = useCallback((folder: ShareFolder) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(folder.path)) {
        next.delete(folder.path);
      } else {
        next.add(folder.path);
        if (folder.files === null) void loadFolder(folder.path);
      }
      return next;
    });
  }, [loadFolder]);

  // ── Filtering ───────────────────────────────────────────────────────────────
  // The text query matches folder paths, and file names within loaded folders.
  // Quality pills apply to loaded files; folders stay listed so their files
  // can be loaded and filtered on expand.
  const visibleFolders = useMemo(() => {
    if (!debouncedQuery && pills.size === 0) return folders;

    const result: ShareFolder[] = [];
    for (const folder of folders) {
      const folderMatches = !debouncedQuery || folder.searchText.includes(debouncedQuery);
      if (folder.files === null) {
        if (folderMatches) result.push(folder);
        continue;
      }

      const files = folder.files.filter(f =>
        (folderMatches || (debouncedQuery && f.searchText.includes(debouncedQuery))) &&
        fileMatchesPills(f, pills));
      if (files.length > 0) {
        result.push({ ...folder, files, fileCount: files.length });
      } else if (folderMatches && pills.size === 0) {
        result.push({ ...folder, files, fileCount: files.length });
      }
    }

    return result;
  }, [folders, debouncedQuery, pills]);

  // ── Flat virtualized rows with precomputed offsets (O(1) getItemLayout) ────
  const { rows, offsets } = useMemo(() => {
    const rows_: Row[] = [];
    const offsets_: number[] = [];
    let y = 0;

    for (const folder of visibleFolders) {
      offsets_.push(y);
      rows_.push({ type: 'folder', key: folder.path, folder });
      y += FOLDER_ROW_HEIGHT;
      if (expanded.has(folder.path)) {
        if (folder.files === null) {
          offsets_.push(y);
          rows_.push({ type: 'loading', key: `${folder.path}::loading` });
          y += FILE_ROW_HEIGHT;
        } else {
          for (const file of folder.files) {
            offsets_.push(y);
            rows_.push({ type: 'file', key: file.fullPath, file });
            y += FILE_ROW_HEIGHT;
          }
        }
      }
    }

    return { rows: rows_, offsets: offsets_ };
  }, [visibleFolders, expanded]);

  const getItemLayout = useCallback((_data: unknown, index: number) => ({
    length: rows[index]?.type === 'folder' ? FOLDER_ROW_HEIGHT : FILE_ROW_HEIGHT,
    offset: offsets[index] ?? 0,
    index,
  }), [rows, offsets]);

  const totalFiles = useMemo(
    () => visibleFolders.reduce((sum, f) => sum + f.fileCount, 0),
    [visibleFolders],
  );

  // ── Selection ───────────────────────────────────────────────────────────────
  const toggleFile = useCallback((file: ShareFile) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(file.fullPath)) next.delete(file.fullPath); else next.set(file.fullPath, file);
      return next;
    });
  }, []);

  // Selecting an unloaded folder fetches its files first, then selects them.
  const toggleFolderSelect = useCallback(async (folder: ShareFolder) => {
    const files = folder.files ?? await loadFolder(folder.path);
    if (files.length === 0) return;
    setSelected(prev => {
      const next = new Map(prev);
      const allIn = files.every(f => prev.has(f.fullPath));
      for (const f of files) {
        if (allIn) next.delete(f.fullPath); else next.set(f.fullPath, f);
      }
      return next;
    });
  }, [loadFolder]);

  const togglePill = useCallback((key: PillKey) => {
    setPills(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectedFiles = useMemo(() => [...selected.values()], [selected]);

  // ── Download ────────────────────────────────────────────────────────────────
  const confirmDownload = useCallback(async () => {
    if (downloading || selectedFiles.length === 0) return;
    setDownloading(true);
    try {
      if (downloadTarget === 'device') {
        const { serverUrl, accessToken } = useAuthStore.getState();
        const saveDir = new Directory(Paths.document, 'resonance');
        saveDir.create({ intermediates: true, idempotent: true });
        let saved = 0;
        for (const file of selectedFiles) {
          const localFile = new File(saveDir, file.name);
          if (localFile.exists) { saved++; continue; }
          const token = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : '';
          const sizeParam = file.size ? `&size=${file.size}` : '';
          const url = `${serverUrl}/api/v0/streams/${encodeURIComponent(username)}?filename=${encodeURIComponent(file.fullPath)}${sizeParam}${token}`;
          await File.downloadFileAsync(url, localFile);
          saved++;
        }
        setShowModal(false);
        setSelected(new Map());
        Alert.alert('Downloaded', `Saved ${saved} file${saved !== 1 ? 's' : ''} to device.`);
      } else {
        const payload = selectedFiles.map(f => ({
          filename: f.fullPath,
          size: f.size,
          destinationFolder: destination.trim() || undefined,
        }));
        await browseApi.queueDownloads(username, payload);
        setShowModal(false);
        setSelected(new Map());
        Alert.alert(
          'Download queued',
          `Added ${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} to the download queue.`,
        );
      }
    } catch {
      Alert.alert('Error', downloadTarget === 'device'
        ? 'Failed to download to device. Check your connection.'
        : 'Failed to queue download. Check your connection.');
    } finally {
      setDownloading(false);
    }
  }, [downloading, selectedFiles, destination, username, downloadTarget]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: Row }) => {
    if (item.type === 'folder') {
      const allSelected =
        (item.folder.files?.length ?? 0) > 0 &&
        item.folder.files!.every(f => selected.has(f.fullPath));
      return (
        <FolderRow
          label={item.folder.label}
          locked={item.folder.locked}
          count={item.folder.fileCount}
          expanded={expanded.has(item.folder.path)}
          allSelected={allSelected}
          colors={colors}
          onToggleExpand={() => toggleExpand(item.folder)}
          onToggleSelect={() => void toggleFolderSelect(item.folder)}
        />
      );
    }

    if (item.type === 'loading') return <LoadingRow colors={colors} />;

    return (
      <FileRowItem
        name={item.file.name}
        meta={item.file.meta}
        selected={selected.has(item.file.fullPath)}
        colors={colors}
        onToggle={() => toggleFile(item.file)}
      />
    );
  }, [colors, expanded, selected, toggleExpand, toggleFolderSelect, toggleFile]);

  return (
    <View style={s.root}>
      {/* Filter bar */}
      <View style={s.filterBar}>
        <View style={s.searchWrap}>
          <Ionicons name="search" size={14} color={colors.textDim} />
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Filter folders and loaded files…"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textDim} />
            </Pressable>
          )}
        </View>
        <View style={s.pillRow}>
          {FILTER_PILLS.map(p => (
            <Pressable
              key={p.key}
              style={[s.pill, pills.has(p.key) ? s.pillActive : s.pillInactive]}
              onPress={() => togglePill(p.key)}
            >
              <Text style={[s.pillText, { color: pills.has(p.key) ? '#fff' : colors.textMuted }]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
          {!loading && !error && (
            <Text style={s.countText}>
              {totalFiles.toLocaleString()} files · {visibleFolders.length.toLocaleString()} folders
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={s.centerText}>
            Downloading file list…{progress > 0 ? ` ${progress}%` : ''}
          </Text>
        </View>
      ) : error ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textDim} />
          <Text style={s.centerText}>{error}</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="folder-open-outline" size={40} color={colors.textDim} />
          <Text style={s.centerText}>
            {folders.length === 0 ? 'This user is not sharing any files' : 'No files match the filters'}
          </Text>
        </View>
      ) : (
        <FlatList<Row>
          data={rows}
          keyExtractor={row => row.key}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          windowSize={9}
          maxToRenderPerBatch={24}
          initialNumToRender={24}
          removeClippedSubviews
          contentContainerStyle={selected.size > 0 ? { paddingBottom: 80 } : undefined}
        />
      )}

      {selected.size > 0 && (
        <View style={[s.selectionBar, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
          <Text style={[s.selectionCount, { color: colors.textPrimary }]}>
            {selected.size} selected
          </Text>
          <Pressable onPress={() => setSelected(new Map())} hitSlop={8} style={s.selectionClear}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            onPress={() => setShowModal(true)}
            style={[s.selectionDownload, { backgroundColor: colors.accent }]}
          >
            <Ionicons name="arrow-down" size={14} color="#fff" />
            <Text style={s.selectionDownloadText}>Download</Text>
          </Pressable>
        </View>
      )}

      <DownloadModal
        visible={showModal}
        label={`${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} from ${username}`}
        downloadTarget={downloadTarget}
        onChangeDownloadTarget={setDownloadTarget}
        destination={destination}
        onChangeDestination={setDestination}
        onConfirm={confirmDownload}
        onCancel={() => setShowModal(false)}
        downloading={downloading}
      />

      <UserActionSheet
        username={actionUser}
        onClose={() => setActionUser(null)}
        hide={['browse']}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bgPrimary },

  filterBar: {
    padding: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing.sm - 2,
    fontSize: Typography.sm,
    color: c.textPrimary,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  pill: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  pillActive:   { backgroundColor: c.accent, borderColor: c.accent },
  pillInactive: { backgroundColor: 'transparent', borderColor: c.border },
  pillText:     { fontSize: Typography.xs, fontWeight: '600' },
  countText:    { flex: 1, textAlign: 'right', fontSize: Typography.xs, color: c.textDim },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  centerText: { fontSize: Typography.sm, color: c.textMuted, textAlign: 'center' },

  selectionBar: {
    position: 'absolute',
    bottom: Spacing.lg,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    gap: Spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  selectionCount: { flex: 1, fontSize: Typography.sm, fontWeight: '600' },
  selectionClear: { padding: Spacing.xs },
  selectionDownload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  selectionDownloadText: { fontSize: Typography.sm, fontWeight: '700', color: '#fff' },
});
