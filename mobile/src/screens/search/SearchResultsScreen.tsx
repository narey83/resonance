import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { File, Directory, Paths } from 'expo-file-system';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography } from '../../theme';
import type { ThemeColors } from '../../theme';
import * as searchApi from '../../api/searches';
import { useAuthStore } from '../../store/auth';
import type { Search, SearchFile, SearchResponse } from '../../api/searches';
import type { MusicTrack } from '../../api/musicLibrary';
import { usePlaybackStatus, usePlayer } from '../../context/PlayerContext';
import { createSearchHubConnection } from '../../api/searchHub';
import * as usersApi from '../../api/users';
import type { UserPresence, UserStatus } from '../../api/users';
import type { SearchStackParamList } from './SearchScreen';

type Props = NativeStackScreenProps<SearchStackParamList, 'SearchResults'>;

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'tracks' | 'peers' | 'albums';
type SortType = 'speed' | 'queue';

interface FilterState {
  freeSlots:   boolean;
  lossless:    boolean;
  highBitrate: boolean;
}

interface DownloadGroup {
  username: string;
  files: SearchFile[];
}

interface PendingDownload {
  groups: DownloadGroup[];
  label: string;
}

type PeerListItem =
  | { type: 'header'; response: SearchResponse; isExpanded: boolean }
  | { type: 'file';   username: string; file: SearchFile; isLocked: boolean };

interface MobileFolderGroup {
  directory: string;
  label: string;
  username: string;
  files: SearchFile[];
  uploadSpeed: number;
  queueLength: number;
  hasFreeUploadSlot: boolean;
}

interface MobileAlbumGroup {
  normalizedName: string;
  displayName: string;
  sources: MobileFolderGroup[];
  bestSpeed: number;
  hasFreeSlot: boolean;
}

type AlbumListItem =
  | { type: 'album';  id: string; group: MobileAlbumGroup; isExpanded: boolean }
  | { type: 'source'; albumId: string; id: string; folder: MobileFolderGroup };

interface TrackItem {
  key: string;  // username|||filename, unique per item
  file: SearchFile;
  username: string;
  uploadSpeed: number;
  queueLength: number;
  hasFreeUploadSlot: boolean;
  isLocked: boolean;
}

function buildSoulseekPath(username: string, filename: string, size?: number | null): string {
  const sizePart = size && size > 0 ? `?size=${size}` : '';
  return `soulseek://${encodeURIComponent(username)}/${encodeURIComponent(filename)}${sizePart}`;
}

function searchFileToTrack(username: string, file: SearchFile): MusicTrack {
  const name = getFileName(file.filename);
  return {
    path:        buildSoulseekPath(username, file.filename, file.size),
    filename:    name,
    directory:   getDirectory(file.filename),
    duration:    file.length ?? null,
    title:       name.replace(/\.[^.]+$/, ''),
    artist:      username,
    albumArtist: null,
    album:       getFolderLabel(getDirectory(file.displayFilename ?? file.filename)),
    year:        null,
    trackNumber: null,
    discNumber:  null,
    hasArtwork:  false,
    coverPath:   null,
    genre:       null,
    bpm:         null,
    key:         null,
    fileSize:    file.size ?? null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1_048_576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1_073_741_824).toFixed(2)} GB`;
}

function fmtSpeed(bps: number): string {
  if (bps < 1_048_576) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1_048_576).toFixed(1)} MB/s`;
}

function getFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;
}

function getDirectory(filename: string): string {
  // Support both Windows backslash and forward slash paths
  if (filename.includes('\\')) {
    return filename.slice(0, filename.lastIndexOf('\\'));
  }
  const idx = filename.lastIndexOf('/');
  return idx > 0 ? filename.slice(0, idx) : filename;
}


function qualityLabel(file: {
  extension: string;
  bitDepth?: number | null;
  sampleRate?: number | null;
  bitRate?: number | null;
  isVariableBitRate?: boolean | null;
}): string {
  if (file.bitDepth && file.sampleRate) {
    const sr = file.sampleRate >= 1000
      ? `${(file.sampleRate / 1000).toFixed(0)}kHz`
      : `${file.sampleRate}Hz`;
    return `${file.extension.toUpperCase()} ${file.bitDepth}-bit ${sr}`;
  }
  if (file.bitRate) {
    const vbr = file.isVariableBitRate === true
      ? ' VBR'
      : file.isVariableBitRate === false ? ' CBR' : '';
    return `${file.extension.toUpperCase()} ${file.bitRate}kbps${vbr}`;
  }
  return file.extension ? file.extension.toUpperCase() : '';
}

function presenceColor(p: UserPresence | undefined): string {
  if (p === 'Online') return '#22c55e';
  if (p === 'Away')   return '#eab308';
  return '#3a3f47'; // unknown — dark neutral, barely visible until resolved
}

function PresenceIndicator({ presence, size = 10 }: { presence: UserPresence | undefined; size?: number }) {
  if (presence === 'Offline') {
    return <Ionicons name="cloud-offline-outline" size={size + 2} color="#6b7280" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: presenceColor(presence), flexShrink: 0 }} />
  );
}

function stateLabel(s: Search): string {
  if (s.isComplete) return 'Done';
  if (s.state & 4) return 'Searching…';
  if (s.state & 2) return 'Starting…';
  if (s.state & 1) return 'Queued';
  return 'Done';
}

function applyFilters(responses: SearchResponse[], filters: FilterState): SearchResponse[] {
  let r = responses;
  if (filters.freeSlots)   r = r.filter(x => x.hasFreeUploadSlot);
  if (filters.lossless)    r = r.filter(x => x.files.some(f => f.bitDepth != null));
  if (filters.highBitrate) r = r.filter(x => x.files.some(f => (f.bitRate ?? 0) >= 320));
  return r;
}

function sortResponses(responses: SearchResponse[], sort: SortType): SearchResponse[] {
  return [...responses].sort((a, b) =>
    sort === 'speed' ? b.uploadSpeed - a.uploadSpeed : a.queueLength - b.queueLength,
  );
}

// Key uniquely identifies a file within a particular peer's result
function trackKey(username: string, filename: string): string {
  return `${username}|||${filename}`;
}

function normalizeFolderName(folderPath: string): string {
  const segments = folderPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const last   = segments.at(-1) ?? '';
  if (!last) return '';
  const hasArtistSep = / - |_-_/.test(last);
  const raw = hasArtistSep ? last : (segments.at(-2) ? `${segments.at(-2)} ${last}` : last);
  return raw
    .replace(/[\[(][^\])]*[\])]/g, '')
    .replace(/\b(?:19|20)\d{2}\b/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getFolderLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function buildFolderGroups(
  responses: SearchResponse[],
  filters: FilterState,
  sort: SortType,
): MobileFolderGroup[] {
  const sorted = sortResponses(applyFilters(responses, filters), sort);
  const groups: MobileFolderGroup[] = [];
  for (const r of sorted) {
    const byDir = new Map<string, SearchFile[]>();
    const allFiles = [
      ...r.files,
      ...(r.lockedFiles ?? []).map(f => ({ ...f, isLocked: true })),
    ];
    for (const file of allFiles) {
      if (filters.lossless    && file.bitDepth == null)     continue;
      if (filters.highBitrate && (file.bitRate ?? 0) < 320) continue;
      const dir = getDirectory(file.filename);
      const arr = byDir.get(dir) ?? [];
      arr.push(file);
      byDir.set(dir, arr);
    }
    for (const [dir, files] of byDir) {
      groups.push({
        directory:        dir,
        label:            getFolderLabel(getDirectory(files[0].displayFilename ?? files[0].filename)),
        username:         r.username,
        files,
        uploadSpeed:      r.uploadSpeed,
        queueLength:      r.queueLength,
        hasFreeUploadSlot: r.hasFreeUploadSlot,
      });
    }
  }
  return groups;
}

function groupAlbums(folders: MobileFolderGroup[]): MobileAlbumGroup[] {
  const map = new Map<string, MobileAlbumGroup>();
  for (const folder of folders) {
    const key = normalizeFolderName(folder.directory) || folder.directory;
    if (!map.has(key)) {
      map.set(key, { normalizedName: key, displayName: folder.label, sources: [], bestSpeed: 0, hasFreeSlot: false });
    }
    const group = map.get(key)!;
    group.sources.push(folder);
    if (folder.uploadSpeed > group.bestSpeed) {
      group.bestSpeed = folder.uploadSpeed;
      group.displayName = folder.label;
    }
    if (folder.hasFreeUploadSlot) group.hasFreeSlot = true;
  }
  return [...map.values()].sort((a, b) =>
    b.sources.length !== a.sources.length
      ? b.sources.length - a.sources.length
      : b.bestSpeed - a.bestSpeed,
  );
}

function buildAlbumItems(
  responses: SearchResponse[],
  expandedAlbums: Set<string>,
  sort: SortType,
  filters: FilterState,
): AlbumListItem[] {
  const folders = buildFolderGroups(responses, filters, sort);
  const albums  = groupAlbums(folders);
  const items: AlbumListItem[] = [];
  for (const group of albums) {
    const id = group.normalizedName;
    const isExpanded = expandedAlbums.has(id);
    items.push({ type: 'album', id, group, isExpanded });
    if (isExpanded) {
      for (const folder of group.sources) {
        items.push({ type: 'source', albumId: id, id: `${folder.username}|||${folder.directory}`, folder });
      }
    }
  }
  return items;
}

function buildTrackItems(
  responses: SearchResponse[],
  sort: SortType,
  filters: FilterState,
): TrackItem[] {
  const sorted = sortResponses(applyFilters(responses, filters), sort);
  const items: TrackItem[] = [];
  for (const r of sorted) {
    for (const file of r.files) {
      if (filters.lossless    && file.bitDepth == null)      continue;
      if (filters.highBitrate && (file.bitRate ?? 0) < 320)  continue;
      items.push({
        key:               trackKey(r.username, file.filename),
        file,
        username:          r.username,
        uploadSpeed:       r.uploadSpeed,
        queueLength:       r.queueLength,
        hasFreeUploadSlot: r.hasFreeUploadSlot,
        isLocked:          false,
      });
    }
    for (const file of (r.lockedFiles ?? [])) {
      if (filters.lossless    && file.bitDepth == null)      continue;
      if (filters.highBitrate && (file.bitRate ?? 0) < 320)  continue;
      items.push({
        key:               trackKey(r.username, file.filename),
        file,
        username:          r.username,
        uploadSpeed:       r.uploadSpeed,
        queueLength:       r.queueLength,
        hasFreeUploadSlot: r.hasFreeUploadSlot,
        isLocked:          true,
      });
    }
  }
  return items;
}

function buildPeerItems(
  responses: SearchResponse[],
  expanded: Set<string>,
  sort: SortType,
  filters: FilterState,
): PeerListItem[] {
  const sorted = sortResponses(applyFilters(responses, filters), sort);
  const items: PeerListItem[] = [];
  for (const response of sorted) {
    const isExpanded = expanded.has(response.username);
    items.push({ type: 'header', response, isExpanded });
    if (isExpanded) {
      for (const file of response.files) {
        items.push({ type: 'file', username: response.username, file, isLocked: false });
      }
      for (const file of (response.lockedFiles ?? [])) {
        items.push({ type: 'file', username: response.username, file, isLocked: true });
      }
    }
  }
  return items;
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({
  label, active, onPress, colors,
}: { label: string; active: boolean; onPress: () => void; colors: ThemeColors }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        pillStyles.pill,
        { borderColor: active ? colors.accent : colors.border },
        active && { backgroundColor: `${colors.accent}22` },
      ]}
    >
      <Text style={[
        pillStyles.label,
        { color: active ? colors.accent : colors.textMuted, fontWeight: active ? '600' : '400' },
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}
const pillStyles = StyleSheet.create({
  pill:  { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1 },
  label: { fontSize: Typography.xs },
});

// ─── Track row (Tracks view — selectable) ─────────────────────────────────────

function TrackRow({
  item, selected, presence, colors, s, onToggle, onBrowseFolder, onPlayPreview, isPreviewing,
}: {
  item: TrackItem;
  selected: boolean;
  presence: UserPresence | undefined;
  colors: ThemeColors;
  s: ReturnType<typeof makeTrackStyles>;
  onToggle: () => void;
  onBrowseFolder: () => void;
  onPlayPreview: () => void;
  isPreviewing: boolean;
}) {
  const name        = getFileName(item.file.filename);
  const quality     = qualityLabel(item.file);
  const folderLabel = getFolderLabel(getDirectory(item.file.displayFilename ?? item.file.filename));
  const isOffline   = presence === 'Offline';
  const isLocked    = item.isLocked;
  const disabled    = isOffline || isLocked;

  return (
    <Pressable
      style={({ pressed }) => [s.row, selected && s.rowSelected, pressed && s.rowPressed, isLocked && s.rowLocked]}
      onPress={isLocked ? undefined : onToggle}
      disabled={isLocked}
    >
      {/* Line 1: username */}
      <View style={s.userLine}>
        <PresenceIndicator presence={presence} size={10} />
        <Text style={[s.username, isOffline && { color: colors.textDim }]} numberOfLines={1}>
          {item.username} · {fmtSpeed(item.uploadSpeed)}
          {item.queueLength > 0 ? ` · Q:${item.queueLength}` : ''}
          {isOffline ? ' · Offline' : ''}
        </Text>
      </View>

      {/* Line 2: folder (indented) */}
      {folderLabel ? (
        <View style={s.folderLine}>
          <Ionicons name="folder-outline" size={10} color={colors.textDim} />
          <Text style={s.folder} numberOfLines={1}>{folderLabel}</Text>
        </View>
      ) : null}

      {/* Line 3: lock/checkbox + track + actions (indented) */}
      <View style={s.trackLine}>
        {isLocked ? (
          <View style={s.lockIcon}>
            <Ionicons name="lock-closed" size={12} color={colors.textDim} />
          </View>
        ) : (
          <View style={[s.checkbox, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
            {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
          </View>
        )}
        <View style={s.trackInfo}>
          <Text style={[s.name, isLocked && { color: colors.textMuted }]} numberOfLines={1} ellipsizeMode="middle">{name}</Text>
          <Text style={s.quality} numberOfLines={1}>
            {isLocked ? 'Locked · ' : ''}
            {quality}
            {item.file.size > 0 ? ` · ${fmtBytes(item.file.size)}` : ''}
            {item.file.length
              ? ` · ${Math.floor(item.file.length / 60)}:${String(item.file.length % 60).padStart(2, '0')}`
              : ''}
          </Text>
        </View>
        <Pressable
          onPress={disabled ? undefined : onPlayPreview}
          hitSlop={8}
          style={[s.iconBtn, disabled && s.iconBtnDisabled]}
          disabled={disabled}
        >
          <Ionicons
            name={isPreviewing ? 'pause-circle-outline' : 'play-circle-outline'}
            size={17}
            color={isPreviewing ? colors.accent : (disabled ? colors.textDim : colors.textMuted)}
          />
        </Pressable>
        <Pressable
          onPress={disabled ? undefined : onBrowseFolder}
          hitSlop={8}
          style={[s.iconBtn, disabled && s.iconBtnDisabled]}
          disabled={disabled}
        >
          <Ionicons name="folder-outline" size={17} color={disabled ? colors.textDim : colors.textMuted} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const makeTrackStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'column',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: 3,
  },
  rowSelected: { backgroundColor: `${c.accent}14` },
  rowPressed:  { opacity: 0.7 },
  rowLocked:   { opacity: 0.6 },

  userLine:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  username:  { fontSize: Typography.sm, color: c.textPrimary, fontWeight: '600', flex: 1 },

  folderLine: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 16 },
  folder:     { fontSize: Typography.xs, color: c.textMuted, flex: 1 },

  trackLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingLeft: 16 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  lockIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  trackInfo:      { flex: 1, gap: 1 },
  name:           { fontSize: Typography.sm, color: c.textPrimary, fontWeight: '500' },
  quality:        { fontSize: Typography.xs, color: c.textDim },
  iconBtn:        { padding: 4 },
  iconBtnDisabled: { opacity: 0.35 },
});

// ─── Response header row (Peers view) ────────────────────────────────────────

function ResponseHeader({
  response, isExpanded, presence, colors, s, onToggle, onDownloadAll,
}: {
  response: SearchResponse;
  isExpanded: boolean;
  presence: UserPresence | undefined;
  colors: ThemeColors;
  s: ReturnType<typeof makeHeaderStyles>;
  onToggle: () => void;
  onDownloadAll: () => void;
}) {
  const isOffline = presence === 'Offline';

  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.pressed]}
      onPress={onToggle}
    >
      <PresenceIndicator presence={presence} size={12} />
      <View style={s.info}>
        <Text style={[s.username, isOffline && { color: colors.textMuted }]} numberOfLines={1}>
          {response.username}
          {isOffline ? '  · offline' : ''}
        </Text>
        <Text style={s.meta}>
          {fmtSpeed(response.uploadSpeed)}
          {response.queueLength > 0 ? ` · Q:${response.queueLength}` : ''}
          {response.hasFreeUploadSlot ? ' · free slot' : ''}
          {` · ${response.fileCount} file${response.fileCount !== 1 ? 's' : ''}`}
          {response.lockedFileCount > 0 ? ` · ${response.lockedFileCount} locked` : ''}
        </Text>
      </View>
      <Pressable
        onPress={isOffline ? undefined : onDownloadAll}
        hitSlop={8}
        style={[s.iconBtn, isOffline && { opacity: 0.35 }]}
        disabled={isOffline}
      >
        <Ionicons name="arrow-down-circle-outline" size={20} color={colors.accent} />
      </Pressable>
      <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textDim} />
    </Pressable>
  );
}

const makeHeaderStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgPrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: Spacing.xs,
  },
  pressed:  { opacity: 0.7 },
  dot:      { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  info:     { flex: 1 },
  username: { fontSize: Typography.sm, fontWeight: '600', color: c.textPrimary },
  meta:     { fontSize: Typography.xs, color: c.textMuted },
  iconBtn:  { padding: 2 },
});

// ─── File row (Peers view expanded) ──────────────────────────────────────────

function FileRow({
  file, isLocked, colors, s, onDownload, onBrowseFolder,
}: {
  file: SearchFile;
  isLocked: boolean;
  colors: ThemeColors;
  s: ReturnType<typeof makeFileStyles>;
  onDownload: () => void;
  onBrowseFolder: () => void;
}) {
  return (
    <View style={[s.row, isLocked && s.rowLocked]}>
      {isLocked && (
        <Ionicons name="lock-closed" size={12} color={colors.textDim} style={{ marginRight: 2 }} />
      )}
      <View style={s.info}>
        <Text style={[s.name, isLocked && { color: colors.textMuted }]} numberOfLines={1} ellipsizeMode="middle">
          {getFileName(file.filename)}
        </Text>
        <Text style={s.meta}>
          {isLocked ? 'Locked · ' : ''}
          {qualityLabel(file)}
          {file.size > 0 ? ` · ${fmtBytes(file.size)}` : ''}
          {file.length
            ? ` · ${Math.floor(file.length / 60)}:${String(file.length % 60).padStart(2, '0')}`
            : ''}
        </Text>
      </View>
      <Pressable
        onPress={isLocked ? undefined : onBrowseFolder}
        hitSlop={8}
        style={[s.iconBtn, isLocked && { opacity: 0.35 }]}
        disabled={isLocked}
      >
        <Ionicons name="folder-outline" size={16} color={colors.textMuted} />
      </Pressable>
      {!isLocked && (
        <Pressable onPress={onDownload} hitSlop={8} style={s.iconBtn}>
          <Ionicons name="arrow-down-outline" size={16} color={colors.accent} />
        </Pressable>
      )}
    </View>
  );
}

const makeFileStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingLeft: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: Spacing.xs,
  },
  rowLocked: { opacity: 0.6 },
  info:    { flex: 1 },
  name:    { fontSize: Typography.sm, color: c.textPrimary, fontWeight: '500' },
  meta:    { fontSize: Typography.xs, color: c.textMuted, marginTop: 1 },
  iconBtn: { padding: 4 },
});

// ─── Album header row ─────────────────────────────────────────────────────────

function AlbumHeader({
  group, isExpanded, colors, s, onToggle,
}: {
  group: MobileAlbumGroup;
  isExpanded: boolean;
  colors: ThemeColors;
  s: ReturnType<typeof makeAlbumHeaderStyles>;
  onToggle: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]} onPress={onToggle}>
      <View style={s.info}>
        <Text style={s.name} numberOfLines={1}>{group.displayName}</Text>
        <Text style={s.meta}>
          {group.sources.length} {group.sources.length === 1 ? 'source' : 'sources'}
          {' · '}{fmtSpeed(group.bestSpeed)}
          {group.hasFreeSlot ? ' · free slot' : ''}
        </Text>
      </View>
      <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textDim} />
    </Pressable>
  );
}

const makeAlbumHeaderStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgPrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: Spacing.xs,
  },
  info:  { flex: 1 },
  name:  { fontSize: Typography.sm, fontWeight: '700', color: c.textPrimary },
  meta:  { fontSize: Typography.xs, color: c.textMuted, marginTop: 1 },
});

// ─── Album source row (inside an expanded album) ──────────────────────────────

function AlbumSourceRow({
  folder, presence, colors, s, onDownloadAll, onBrowseFolder,
}: {
  folder: MobileFolderGroup;
  presence: UserPresence | undefined;
  colors: ThemeColors;
  s: ReturnType<typeof makeAlbumSourceStyles>;
  onDownloadAll: () => void;
  onBrowseFolder: () => void;
}) {
  const isOffline = presence === 'Offline';
  return (
    <View style={s.row}>
      <PresenceIndicator presence={presence} size={10} />
      <View style={s.info}>
        <Text style={[s.username, isOffline && { color: colors.textMuted }]} numberOfLines={1}>
          {folder.username}
        </Text>
        <Text style={s.meta} numberOfLines={1}>
          {folder.label}
          {' · '}{folder.files.length} {folder.files.length === 1 ? 'file' : 'files'}
          {' · '}{fmtSpeed(folder.uploadSpeed)}
          {folder.queueLength > 0 ? ` · Q:${folder.queueLength}` : ''}
          {folder.hasFreeUploadSlot ? ' · free' : ''}
        </Text>
      </View>
      <Pressable
        onPress={isOffline ? undefined : onBrowseFolder}
        hitSlop={8}
        style={[s.iconBtn, isOffline && { opacity: 0.35 }]}
        disabled={isOffline}
      >
        <Ionicons name="folder-outline" size={16} color={colors.textMuted} />
      </Pressable>
      <Pressable
        onPress={isOffline ? undefined : onDownloadAll}
        hitSlop={8}
        style={[s.iconBtn, isOffline && { opacity: 0.35 }]}
        disabled={isOffline}
      >
        <Ionicons name="arrow-down-circle-outline" size={20} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const makeAlbumSourceStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingLeft: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: Spacing.xs,
  },
  info:     { flex: 1 },
  username: { fontSize: Typography.sm, fontWeight: '600', color: c.textPrimary },
  meta:     { fontSize: Typography.xs, color: c.textMuted, marginTop: 1 },
  iconBtn:  { padding: 4 },
});

// ─── Download modal ───────────────────────────────────────────────────────────

type DownloadTarget = 'server' | 'device';

function DownloadModal({
  pending,
  downloadTarget,
  onChangeDownloadTarget,
  destination,
  onChangeDestination,
  onConfirm,
  onCancel,
  downloading,
  colors,
}: {
  pending: PendingDownload | null;
  downloadTarget: DownloadTarget;
  onChangeDownloadTarget: (t: DownloadTarget) => void;
  destination: string;
  onChangeDestination: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  downloading: boolean;
  colors: ThemeColors;
}) {
  const s = useMemo(() => makeModalStyles(colors), [colors]);

  return (
    <Modal visible={pending !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.overlay} onPress={onCancel} />
      <View style={s.container}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Download</Text>
          {pending && <Text style={s.subtitle} numberOfLines={2}>{pending.label}</Text>}

          <View style={s.segmentRow}>
            {(['server', 'device'] as const).map(t => (
              <Pressable
                key={t}
                style={[s.segment, downloadTarget === t ? s.segmentActive : s.segmentInactive]}
                onPress={() => onChangeDownloadTarget(t)}
              >
                <Text style={[s.segmentText, downloadTarget === t ? s.segmentTextActive : s.segmentTextInactive]}>
                  {t === 'server' ? 'Server' : 'This device'}
                </Text>
              </Pressable>
            ))}
          </View>

          {downloadTarget === 'server' && (
            <>
              <Text style={s.label}>Destination folder</Text>
              <TextInput
                style={s.input}
                value={destination}
                onChangeText={onChangeDestination}
                placeholder="/Music"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          <View style={s.buttons}>
            <Pressable style={[s.btn, s.cancelBtn]} onPress={onCancel} disabled={downloading}>
              <Text style={[s.btnText, { color: colors.textMuted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.btn, { backgroundColor: colors.accent }, downloading && { opacity: 0.6 }]}
              onPress={onConfirm}
              disabled={downloading}
            >
              {downloading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[s.btnText, { color: '#fff' }]}>Download</Text>
              }
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeModalStyles = (c: ThemeColors) => StyleSheet.create({
  overlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.bgSurface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: c.borderStrong,
    alignSelf: 'center', marginBottom: Spacing.sm,
  },
  title:    { fontSize: Typography.lg, fontWeight: '700', color: c.textPrimary },
  subtitle: { fontSize: Typography.sm, color: c.textMuted, marginBottom: Spacing.xs },
  label:    { fontSize: Typography.xs, color: c.textMuted, fontWeight: '600', marginTop: Spacing.xs },
  input: {
    backgroundColor: c.bgElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: c.textPrimary,
  },
  segmentRow:          { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  segment:             { flex: 1, paddingVertical: Spacing.sm - 2, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1 },
  segmentActive:       { backgroundColor: c.accent, borderColor: c.accent },
  segmentInactive:     { backgroundColor: c.bgElevated, borderColor: c.border },
  segmentText:         { fontSize: Typography.sm, fontWeight: '600' },
  segmentTextActive:   { color: '#fff' },
  segmentTextInactive: { color: c.textMuted },
  buttons:   { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  btn: {
    flex: 1, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', minHeight: 40,
  },
  cancelBtn: { backgroundColor: c.bgElevated },
  btnText:   { fontSize: Typography.base, fontWeight: '600' },
});

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ isActive, isFetching, hasFilters, styles, colors }: {
  isActive: boolean;
  isFetching: boolean;
  hasFilters: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.empty}>
      {isActive || isFetching
        ? <ActivityIndicator size="large" color={colors.accent} />
        : <Ionicons name="musical-notes-outline" size={52} color={colors.textDim} />
      }
      <Text style={styles.emptyTitle}>
        {isFetching ? 'Loading results…' : isActive ? 'Searching…' : 'No results'}
      </Text>
      <Text style={styles.emptySub}>
        {isFetching
          ? 'Fetching the full result list'
          : isActive
            ? 'Results will appear as peers respond'
            : hasFilters ? 'Try removing some filters' : 'No files found for this search'}
      </Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SearchResultsScreen({ route, navigation }: Props) {
  const { searchId, searchText } = route.params;
  const { colors } = useTheme();

  const [search, setSearch]         = useState<Search | null>(null);
  const [responses, setResponses]   = useState<SearchResponse[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchingResults, setFetchingResults] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView]             = useState<ViewMode>('tracks');
  const [sort, setSort]             = useState<SortType>('speed');
  const [filters, setFilters]       = useState<FilterState>({
    freeSlots: false, lossless: false, highBitrate: false,
  });
  const [expanded, setExpanded]         = useState<Set<string>>(new Set());
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());

  // Multi-select (Tracks view)
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());

  // Download modal
  const [pending, setPending]           = useState<PendingDownload | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget>('server');
  const [destination, setDestination]   = useState('/Music');
  const [downloading, setDownloading]   = useState(false);

  // Cached presence per username
  const [userStatuses, setUserStatuses] = useState<Record<string, UserPresence>>({});
  // Track which usernames have already been queued so we never double-fetch
  const statusFetchQueued = useRef<Set<string>>(new Set());

  const hasLoadedRef = useRef(false);

  useEffect(() => {
    navigation.setOptions({ title: searchText });
  }, [navigation, searchText]);

  // Fetch presence for every new peer as responses arrive, batched into one request.
  useEffect(() => {
    const newUsernames = responses
      .map(r => r.username)
      .filter(u => !statusFetchQueued.current.has(u));

    if (newUsernames.length === 0) return;
    newUsernames.forEach(u => statusFetchQueued.current.add(u));

    usersApi.getUserStatuses(newUsernames)
      .then(batch => {
        const updates: Record<string, UserPresence> = {};
        for (const [username, status] of Object.entries(batch)) {
          updates[username] = (status as UserStatus).presence;
        }
        setUserStatuses(prev => ({ ...prev, ...updates }));
      })
      .catch(() => {});
  }, [responses]);


  // Soulseek searches time out server-side after ~60 s; 90 s is a safe cutoff.
  // Use lastSearchedAt (set on restart) rather than startedAt so restarted searches
  // are judged against when they last ran, not when they were originally created.
  const searchIsStale = (s: Search) => {
    if (s.isComplete) return false;
    const ref = s.lastSearchedAt ?? s.startedAt;
    return Date.now() - new Date(ref).getTime() > 90_000;
  };

  // Mark a search as locally complete so the spinner stops.
  const markDone = (s: Search) =>
    setSearch({ ...s, isComplete: true });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!hasLoadedRef.current) setLoading(true);

      // Initial snapshot via REST
      (async () => {
        try {
          const [s, r] = await Promise.all([
            searchApi.getStatus(searchId),
            searchApi.getResponses(searchId),
          ]);
          if (cancelled) return;
          setResponses(r);
          if (s.isComplete || searchIsStale(s)) markDone(s);
          else setSearch(s);
        } catch (err: any) {
          if (!cancelled && err?.response?.status === 404) setSearch(null);
        } finally {
          if (!cancelled) {
            hasLoadedRef.current = true;
            setLoading(false);
          }
        }
      })();

      // Real-time updates via SignalR (same hub the web frontend uses)
      const hub = createSearchHubConnection();
      if (!hub) return () => { cancelled = true; };

      const applySearchUpdate = (s: Search) => {
        if (s.isComplete || searchIsStale(s)) {
          markDone(s);
          if (s.isComplete) {
            setFetchingResults(true);
            searchApi.getResponses(searchId)
              .then(r => { if (!cancelled) setResponses(r); })
              .catch(() => {})
              .finally(() => { if (!cancelled) setFetchingResults(false); });
          }
        } else {
          setSearch(s);
        }
      };

      hub.on('list', (searches: Search[]) => {
        if (cancelled) return;
        const s = searches.find(x => x.id.toLowerCase() === searchId.toLowerCase());
        if (s) applySearchUpdate(s);
      });

      hub.on('update', (s: Search) => {
        if (cancelled || s.id.toLowerCase() !== searchId.toLowerCase()) return;
        applySearchUpdate(s);
      });

      const startPromise = hub.start().catch(() => {});

      return () => {
        cancelled = true;
        startPromise.then(() => hub.stop().catch(() => {}));
      };
    }, [searchId]),
  );

  const loadAll = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        searchApi.getStatus(searchId),
        searchApi.getResponses(searchId),
      ]);
      if (s.isComplete || searchIsStale(s)) markDone(s);
      else setSearch(s);
      setResponses(r);
    } catch (err: any) {
      if (err?.response?.status === 404) setSearch(null);
    } finally {
      setLoading(false);
    }
  }, [searchId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const onStop = useCallback(() => {
    if (!search || search.isComplete) return;
    searchApi.stop(searchId).then(() => {
      setSearch(prev => prev ? { ...prev, isComplete: true } : prev);
    }).catch(() => {});
  }, [search, searchId]);

  const onUpdateSearch = useCallback(async () => {
    try {
      await searchApi.restart(searchId);
      // Clear current results — SignalR will push state updates as the search runs
      setResponses([]);
      setSearch(prev => prev ? { ...prev, isComplete: false, fileCount: 0, responseCount: 0 } : prev);
    } catch {
      Alert.alert('Error', 'Failed to update search.');
    }
  }, [searchId]);

  const fetchUserStatus = useCallback((username: string) => {
    usersApi.getUserStatus(username)
      .then(({ presence }) => {
        setUserStatuses(prev => ({ ...prev, [username]: presence }));
      })
      .catch(() => {
        // Leave unknown — don't assume offline on network error
      });
  }, []);

  const toggleAlbum = useCallback((id: string) => {
    setExpandedAlbums(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((username: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
        // Fetch presence when the user expands a peer for the first time
        setUserStatuses(statuses => {
          if (!(username in statuses)) fetchUserStatus(username);
          return statuses;
        });
      }
      return next;
    });
  }, [fetchUserStatus]);

  // Clear selection when sort/filter changes — stale selections no longer make sense
  useEffect(() => {
    setSelectedTracks(new Set());
  }, [sort, filters.freeSlots, filters.lossless, filters.highBitrate]);

  const toggleTrack = useCallback((key: string) => {
    setSelectedTracks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedTracks(new Set()), []);

  const openBrowse = useCallback((username: string, filename: string) => {
    const known = userStatuses[username];
    if (known === 'Offline') {
      Alert.alert('User offline', `${username} is not currently available.`);
      return;
    }
    if (!known) fetchUserStatus(username);
    navigation.navigate('BrowseFolder', { username, directory: getDirectory(filename) });
  }, [userStatuses, fetchUserStatus, navigation]);

  // Kick off download modal with one or more groups
  const triggerDownload = useCallback((groups: DownloadGroup[], label: string) => {
    setPending({ groups, label });
  }, []);

  // Download all currently selected tracks (grouped by username)
  const downloadSelected = useCallback(() => {
    if (selectedTracks.size === 0) return;
    const map = new Map<string, SearchFile[]>();
    for (const item of trackItems) {
      if (!selectedTracks.has(item.key) || item.isLocked) continue;
      const arr = map.get(item.username) ?? [];
      arr.push(item.file);
      map.set(item.username, arr);
    }
    const groups: DownloadGroup[] = [...map.entries()].map(([username, files]) => ({ username, files }));
    const total = groups.reduce((sum, g) => sum + g.files.length, 0);
    setPending({ groups, label: `${total} track${total !== 1 ? 's' : ''}` });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTracks]); // trackItems injected via closure below

  const confirmDownload = useCallback(async () => {
    if (!pending || downloading) return;
    setDownloading(true);
    try {
      const total = pending.groups.reduce((sum, g) => sum + g.files.length, 0);

      if (downloadTarget === 'device') {
        const { serverUrl, accessToken } = useAuthStore.getState();
        const saveDir = new Directory(Paths.document, 'resonance');
        saveDir.create({ intermediates: true, idempotent: true });
        let saved = 0;
        for (const { username, files } of pending.groups) {
          for (const file of files) {
            const localFile = new File(saveDir, getFileName(file.filename));
            if (localFile.exists) { saved++; continue; }
            const token = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : '';
            const sizeParam = file.size ? `&size=${file.size}` : '';
            const url = `${serverUrl}/api/v0/streams/${encodeURIComponent(username)}?filename=${encodeURIComponent(file.filename)}${sizeParam}${token}`;
            await File.downloadFileAsync(url, localFile);
            saved++;
          }
        }
        setPending(null);
        setSelectedTracks(new Set());
        Alert.alert('Downloaded', `Saved ${saved} file${saved !== 1 ? 's' : ''} to device.`);
      } else {
        await Promise.all(
          pending.groups.map(({ username, files }) =>
            searchApi.downloadFiles(
              username,
              files.map(f => ({ ...f, destinationFolder: destination || undefined })) as SearchFile[],
            ),
          ),
        );
        setPending(null);
        setSelectedTracks(new Set());
        Alert.alert(
          'Download queued',
          `Added ${total} file${total !== 1 ? 's' : ''} to the download queue.`,
        );
      }
    } catch {
      Alert.alert('Error', downloadTarget === 'device'
        ? 'Failed to download to device. Check your connection.'
        : 'Failed to queue download. Check your connection.');
    } finally {
      setDownloading(false);
    }
  }, [pending, destination, downloading, downloadTarget]);

  const toggleFilter = useCallback((key: keyof FilterState) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Player integration ────────────────────────────────────────
  const { playTrack, togglePlayPause, track: playerTrack } = usePlayer();
  const { isPlaying } = usePlaybackStatus();

  const onPlayPreview = useCallback((item: TrackItem) => {
    const path = buildSoulseekPath(item.username, item.file.filename, item.file.size);
    if (playerTrack?.path === path) {
      togglePlayPause();
    } else {
      playTrack(searchFileToTrack(item.username, item.file));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerTrack, isPlaying, playTrack, togglePlayPause]);

  const trackItems = useMemo(
    () => buildTrackItems(responses, sort, filters),
    [responses, sort, filters],
  );

  const peerItems = useMemo(
    () => buildPeerItems(responses, expanded, sort, filters),
    [responses, expanded, sort, filters],
  );

  const albumItems = useMemo(
    () => buildAlbumItems(responses, expandedAlbums, sort, filters),
    [responses, expandedAlbums, sort, filters],
  );

  const styles          = useMemo(() => makeStyles(colors), [colors]);
  const trackRowStyles  = useMemo(() => makeTrackStyles(colors), [colors]);
  const headerRowStyles = useMemo(() => makeHeaderStyles(colors), [colors]);
  const fileRowStyles   = useMemo(() => makeFileStyles(colors), [colors]);
  const albumHdrStyles  = useMemo(() => makeAlbumHeaderStyles(colors), [colors]);
  const albumSrcStyles  = useMemo(() => makeAlbumSourceStyles(colors), [colors]);
  const isActive   = search ? !search.isComplete : false;
  const hasFilters = filters.freeSlots || filters.lossless || filters.highBitrate;

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
  );

  return (
    <View style={styles.root}>
      {/* Status bar */}
      {search && (
        <View style={styles.statusBar}>
          <View style={styles.statusInfo}>
            {isActive || fetchingResults
              ? null
              : <Ionicons name="checkmark-circle" size={16} color={colors.success} style={styles.statusIcon} />
            }
            <Text style={styles.statusText}>
              {fetchingResults ? 'Loading results…' : stateLabel(search)}
              {search.fileCount > 0 ? ` · ${search.fileCount} files` : ''}
              {search.responseCount > 0 ? ` · ${search.responseCount} peers` : ''}
            </Text>
          </View>
          {isActive ? (
            <Pressable onPress={onStop} hitSlop={8} style={styles.statusBtn}>
              <Ionicons name="stop-circle-outline" size={18} color={colors.warning} />
              <Text style={[styles.statusBtnLabel, { color: colors.warning }]}>Stop</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onUpdateSearch} hitSlop={8} style={styles.statusBtn}>
              <Ionicons name="refresh-outline" size={18} color={colors.accent} />
              <Text style={[styles.statusBtnLabel, { color: colors.accent }]}>Update Search</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Tracks / Peers / Albums toggle */}
      <View style={styles.segWrapper}>
        {(['tracks', 'peers', 'albums'] as ViewMode[]).map(v => {
          const active = view === v;
          const label  = v === 'tracks' ? 'Tracks' : v === 'peers' ? 'Peers' : 'Albums';
          return (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              style={[styles.segPill, active && { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.segLabel, { color: active ? '#fff' : colors.textMuted }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Sort + filter bar */}
      <View style={styles.controlBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          <Pressable
            onPress={() => setSort('speed')}
            style={[styles.sortPill, sort === 'speed' && { backgroundColor: `${colors.accent}22` }]}
          >
            <Ionicons name="flash-outline" size={11} color={sort === 'speed' ? colors.accent : colors.textMuted} />
            <Text style={[styles.sortLabel, { color: sort === 'speed' ? colors.accent : colors.textMuted, fontWeight: sort === 'speed' ? '600' : '400' }]}>
              Fastest
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSort('queue')}
            style={[styles.sortPill, sort === 'queue' && { backgroundColor: `${colors.accent}22` }]}
          >
            <Ionicons name="list-outline" size={11} color={sort === 'queue' ? colors.accent : colors.textMuted} />
            <Text style={[styles.sortLabel, { color: sort === 'queue' ? colors.accent : colors.textMuted, fontWeight: sort === 'queue' ? '600' : '400' }]}>
              Shortest queue
            </Text>
          </Pressable>
          <View style={styles.separator} />
          <Pill label="Free slots"  active={filters.freeSlots}   onPress={() => toggleFilter('freeSlots')}   colors={colors} />
          <Pill label="Lossless"    active={filters.lossless}    onPress={() => toggleFilter('lossless')}    colors={colors} />
          <Pill label="≥320kbps"    active={filters.highBitrate} onPress={() => toggleFilter('highBitrate')} colors={colors} />
        </ScrollView>
      </View>

      {/* Results list */}
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      ) : (
        <>
          <View style={[styles.listContainer, view !== 'tracks' && styles.listHidden]}>
            <FlatList<TrackItem>
              data={trackItems}
              keyExtractor={item => item.key}
              renderItem={({ item }) => (
                <TrackRow
                  item={item}
                  selected={selectedTracks.has(item.key)}
                  presence={userStatuses[item.username]}
                  colors={colors}
                  s={trackRowStyles}
                  onToggle={() => toggleTrack(item.key)}
                  onBrowseFolder={() => openBrowse(item.username, item.file.filename)}
                  onPlayPreview={() => onPlayPreview(item)}
                  isPreviewing={
                    playerTrack?.path === buildSoulseekPath(item.username, item.file.filename, item.file.size) && isPlaying
                  }
                />
              )}
              refreshControl={refreshControl}
              ListEmptyComponent={<EmptyState isActive={isActive} isFetching={fetchingResults} hasFilters={hasFilters} styles={styles} colors={colors} />}
              contentContainerStyle={trackItems.length === 0 ? styles.listEmpty : undefined}
            />
          </View>

          <View style={[styles.listContainer, view !== 'peers' && styles.listHidden]}>
            <FlatList<PeerListItem>
              data={peerItems}
              keyExtractor={(item, index) =>
                item.type === 'header' ? `h-${item.response.username}` : `f-${(item as { username: string }).username}-${index}`
              }
              renderItem={({ item }) => {
                if (item.type === 'header') {
                  return (
                    <ResponseHeader
                      response={item.response}
                      isExpanded={item.isExpanded}
                      presence={userStatuses[item.response.username]}
                      colors={colors}
                      s={headerRowStyles}
                      onToggle={() => toggleExpanded(item.response.username)}
                      onDownloadAll={() => triggerDownload(
                        [{ username: item.response.username, files: item.response.files }],
                        `${item.response.files.length} file${item.response.files.length !== 1 ? 's' : ''} from ${item.response.username}`,
                      )}
                    />
                  );
                }
                return (
                  <FileRow
                    file={item.file}
                    isLocked={item.isLocked}
                    colors={colors}
                    s={fileRowStyles}
                    onDownload={() => triggerDownload(
                      [{ username: item.username, files: [item.file] }],
                      getFileName(item.file.filename),
                    )}
                    onBrowseFolder={() => openBrowse(item.username, item.file.filename)}
                  />
                );
              }}
              refreshControl={refreshControl}
              ListEmptyComponent={<EmptyState isActive={isActive} isFetching={fetchingResults} hasFilters={hasFilters} styles={styles} colors={colors} />}
              contentContainerStyle={peerItems.length === 0 ? styles.listEmpty : undefined}
            />
          </View>

          <View style={[styles.listContainer, view !== 'albums' && styles.listHidden]}>
            <FlatList<AlbumListItem>
              data={albumItems}
              keyExtractor={item => item.type === 'album' ? `alb-${item.id}` : `src-${item.id}`}
              renderItem={({ item }) => {
                if (item.type === 'album') {
                  return (
                    <AlbumHeader
                      group={item.group}
                      isExpanded={item.isExpanded}
                      colors={colors}
                      s={albumHdrStyles}
                      onToggle={() => toggleAlbum(item.id)}
                    />
                  );
                }
                return (
                  <AlbumSourceRow
                    folder={item.folder}
                    presence={userStatuses[item.folder.username]}
                    colors={colors}
                    s={albumSrcStyles}
                    onDownloadAll={() => {
                      const downloadable = item.folder.files.filter(f => !f.isLocked);
                      if (downloadable.length > 0) triggerDownload(
                        [{ username: item.folder.username, files: downloadable }],
                        `${downloadable.length} file${downloadable.length !== 1 ? 's' : ''} from ${item.folder.username}`,
                      );
                    }}
                    onBrowseFolder={() => openBrowse(item.folder.username, item.folder.files[0]?.filename ?? '')}
                  />
                );
              }}
              refreshControl={refreshControl}
              ListEmptyComponent={<EmptyState isActive={isActive} isFetching={fetchingResults} hasFilters={hasFilters} styles={styles} colors={colors} />}
              contentContainerStyle={albumItems.length === 0 ? styles.listEmpty : undefined}
            />
          </View>
        </>
      )}

      {/* Floating selection bar (Tracks view) */}
      {view === 'tracks' && selectedTracks.size > 0 && (
        <View style={[styles.selectionBar, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
          <Text style={[styles.selectionCount, { color: colors.textPrimary }]}>
            {selectedTracks.size} selected
          </Text>
          <Pressable onPress={clearSelection} hitSlop={8} style={styles.selectionClear}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            onPress={downloadSelected}
            style={[styles.selectionDownload, { backgroundColor: colors.accent }]}
          >
            <Ionicons name="arrow-down" size={14} color="#fff" />
            <Text style={styles.selectionDownloadText}>Download</Text>
          </Pressable>
        </View>
      )}

      <DownloadModal
        pending={pending}
        downloadTarget={downloadTarget}
        onChangeDownloadTarget={setDownloadTarget}
        destination={destination}
        onChangeDestination={setDestination}
        onConfirm={confirmDownload}
        onCancel={() => setPending(null)}
        downloading={downloading}
        colors={colors}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bgPrimary },

  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  statusInfo:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  statusIcon:     { marginRight: 2 },
  statusText:     { fontSize: Typography.xs, color: c.textMuted },
  statusBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.xs },
  statusBtnLabel: { fontSize: Typography.xs, fontWeight: '600' },

  segWrapper: {
    flexDirection: 'row',
    margin: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bgElevated,
    overflow: 'hidden',
    padding: 2,
  },
  segPill:  { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.full },
  segLabel: { fontSize: Typography.sm, fontWeight: '600' },

  controlBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    backgroundColor: c.bgSurface,
  },
  pills: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sortLabel: { fontSize: Typography.xs },
  separator: { width: 1, height: 16, backgroundColor: c.border, marginHorizontal: Spacing.xs },

  spinner:       { marginTop: 48 },
  listContainer: { flex: 1 },
  listHidden:    { display: 'none' },
  listEmpty:     { flex: 1, justifyContent: 'center' },
  empty:      { alignItems: 'center', gap: Spacing.sm, paddingVertical: 60 },
  emptyTitle: {
    fontSize: Typography.lg, fontWeight: '600', color: c.textPrimary, marginTop: Spacing.sm,
  },
  emptySub: {
    fontSize: Typography.sm, color: c.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl,
  },

  // Floating selection bar
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
  selectionCount:        { flex: 1, fontSize: Typography.sm, fontWeight: '600' },
  selectionClear:        { padding: Spacing.xs },
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
