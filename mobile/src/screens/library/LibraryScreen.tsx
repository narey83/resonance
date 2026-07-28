// <copyright file="LibraryScreen.tsx" company="John Narey">
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
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { makeScreenOptions, Radius, Spacing, ThemeColors, Typography } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import {
  getAlbums, getArtists, getFolders, getGenres, getYears, getTracks, getLovedTracks,
  getArtworkUrl, getTrackTitle, getTrackArtworkPath,
  analyzeFolder, deleteFolder as deleteFolderApi,
  renameFolder as renameFolderApi, renameTrack as renameTrackApi,
  seedCoverSignatures, seedTrackSignatures,
  cancelSync,
  MusicAlbum, MusicArtist, MusicFolder, MusicGenre, MusicTrack, MusicYear,
} from '../../api/musicLibrary';
import { useLibrarySync } from '../../store/librarySyncStore';
import { peekListCache, readListCache, writeListCache, hasListCache } from '../../services/libraryCache';
import { dbg, isSyncDebugOn } from '../../api/debugLog';
import {
  getLocalAlbums, getLocalArtists, getLocalAlbumTracks,
  getAllLocalTracks, getLocalFolders, getLocalFolderTracks,
  isLocalPath, forceRescanLocalTracks, setScanProgressCallback,
} from '../../services/localMusicLibrary';
import { exportTrackToUsb, exportTracksToUsb } from '../../services/usbExport';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { getArtworkCacheKey, ARTWORK_THUMB_SIZE, PLAYER_ART_SIZE } from '../../services/artworkCache';
import { LEAD_IN, MAX_QUEUE, usePlayer } from '../../context/PlayerContext';
import { useMixtapeStore } from '../../store/mixtapeStore';
import { useLibraryActivityStore } from '../../store/libraryActivityStore';
import { getPlayHistory, type PlayRecord } from '../../api/libraryActivity';
import * as mixtapesAPI from '../../api/mixtapes';
import { create as createSearch, stripRemixInfo } from '../../api/searches';
import { MixtapeTrack, getMixtapeArtworkUrl } from '../../api/mixtapes';
import { useLibrarySettings, ALL_TABS, LibraryTab } from '../../store/librarySettingsStore';
import { useAuthStore } from '../../store/auth';
import { LIST_PERF_PROPS } from '../../lib/listPerf';

// ── Navigation types ──────────────────────────────────────────────────────────

type LibraryStackParamList = {
  LibraryHome:    undefined;
  Artist:         { artistName: string };
  Album:          { album: MusicAlbum; localAlbumTitle?: string };
  FolderDetail:   { folderPath: string; folderName: string; isLocal?: boolean };
  GenreDetail:    { genre: string; trackCount: number };
  YearDetail:     { year: number; trackCount: number };
  PlaylistDetail: { playlistId: string };
};

const Stack = createNativeStackNavigator<LibraryStackParamList>();
type LibraryNav = NativeStackNavigationProp<LibraryStackParamList>;

const TRACKS_PER_PAGE = 50;

// Fetches that feed the player are bounded to what the queue will actually keep. Folders here
// run to tens of thousands of tracks (HATE is ~25k), and asking for one in a single response
// parsed ~10 MB of JSON on the JS thread — that, not the queue length, is what hung the app.
// `index` centres the window on a tapped row; `random` asks the DB for the sample so shuffle
// still draws from the whole set rather than its alphabetical head.
type QueueFetch = { index?: number; random?: boolean };

const queueWindow = (opts?: QueueFetch) => ({
  limit: MAX_QUEUE,
  offset: opts?.index == null ? 0 : Math.max(0, opts.index - LEAD_IN),
  ...(opts?.random ? { sort: 'random' } : {}),
});

const mixtapeTrackToMusicTrack = (t: MixtapeTrack): MusicTrack => ({
  path: t.filePath,
  filename: t.filePath.split(/[/\\]/).pop() ?? t.filePath,
  directory: t.filePath.includes('/') ? t.filePath.substring(0, t.filePath.lastIndexOf('/')) : '',
  duration: t.duration,
  title: t.title,
  artist: t.artist,
  albumArtist: null,
  album: t.album,
  year: null,
  trackNumber: null,
  discNumber: null,
  hasArtwork: true,
  coverPath: null,
  genre: null,
  bpm: null,
  key: null,
  fileSize: null,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ── useKeyboardHeight ─────────────────────────────────────────────────────────

function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setHeight(0),
    );
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

// ── ArtworkBox ────────────────────────────────────────────────────────────────

const ArtworkBox = React.memo(({ path, size, overrideUrl, overrideCacheKey, source }: {
  path: string | null; size: number; overrideUrl?: string | null; overrideCacheKey?: string;
  source?: 'local' | 'server';
}) => {
  const { s, c } = useLibStyles();
  const [error, setError] = React.useState(false);

  // All small cells request one canonical thumbnail size (not a per-layout pixel size), so the
  // same cover hits the same expo-image cacheKey + server transcode across every list and screen.
  const isLocalPath = path?.startsWith('file://') ?? false;
  const downloadUrl = path ? (isLocalPath ? path : getArtworkUrl(path, ARTWORK_THUMB_SIZE)) : null;
  const url = overrideUrl ?? downloadUrl;
  const cacheKey = overrideUrl ? overrideCacheKey : (path && !isLocalPath ? getArtworkCacheKey(path, ARTWORK_THUMB_SIZE) : undefined);

  const badge = source ? (
    <View style={{
      position: 'absolute', bottom: 1, right: 1,
      width: 14, height: 14, borderRadius: 7,
      backgroundColor: source === 'local' ? '#e08030' : c.accent,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Ionicons
        name={source === 'local' ? 'phone-portrait' : 'cloud'}
        size={8}
        color="#fff"
      />
    </View>
  ) : null;

  if (url && !error) {
    return (
      <View style={{ width: size, height: size }}>
        <Image
          source={{ uri: url, cacheKey }}
          style={[s.artwork, { width: size, height: size, borderRadius: size / 8 }]}
          onError={() => setError(true)}
          cachePolicy="memory-disk"
          recyclingKey={cacheKey ?? url}
        />
        {badge}
      </View>
    );
  }
  return (
    <View style={[s.artworkPlaceholder, { width: size, height: size, borderRadius: size / 8 }]}>
      <Ionicons name="musical-note" size={size * 0.4} color={c.textDim} />
      {badge}
    </View>
  );
});
ArtworkBox.displayName = 'ArtworkBox';

// ── SearchBar ─────────────────────────────────────────────────────────────────

const SearchBar = ({ value, onChange, placeholder, trailing }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  trailing?: React.ReactNode;
}) => {
  const { s, c } = useLibStyles();
  return (
    <View style={s.searchWrap}>
      <Ionicons name="search" size={15} color={c.textMuted} style={s.searchIcon} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.textDim}
        returnKeyType="search"
        style={s.searchInput}
        value={value}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color={c.textMuted} />
        </Pressable>
      )}
      {trailing != null && (
        <>
          <View style={s.searchTrailingDivider} />
          {trailing}
        </>
      )}
    </View>
  );
};

// ── SortControl ───────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

interface SortOption { field: string; label: string }

// A compact sort trigger (icon) that opens a bottom sheet of the fields valid for the current view.
// Each view passes its own `options`, so the sheet only ever offers sorts that make sense there.
// Tapping a new field selects it (ascending) and closes; tapping the active field flips direction
// and keeps the sheet open so the change is visible.
const SortControl = ({ options, sortBy, sortDir, onSort }: {
  options: SortOption[];
  sortBy: string | null;
  sortDir: SortDir;
  onSort: (field: string) => void;
}) => {
  const { s, c } = useLibStyles();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={10} style={s.sortTrigger}>
        <Ionicons name="swap-vertical" size={18} color={c.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setOpen(false)} />
        <View style={s.sheetContainer}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Sort by</Text>
            <View style={s.sheetDivider} />
            {options.map((o) => {
              const active = sortBy === o.field;
              return (
                <Pressable
                  key={o.field}
                  onPress={() => {
                    const wasActive = sortBy === o.field;
                    onSort(o.field);
                    if (!wasActive) setOpen(false);
                  }}
                  style={({ pressed }) => [s.sortSheetRow, pressed && s.rowPressed]}
                >
                  <Text style={[s.sortSheetLabel, active && s.sortSheetLabelActive]}>{o.label}</Text>
                  {active && (
                    <View style={s.sortSheetRight}>
                      <Ionicons name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={17} color={c.accent} />
                      <Ionicons name="checkmark" size={19} color={c.accent} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
};

// Right-hand metadata for a track row: musical key + BPM (each shown only when present), with the
// duration underneath. Shared across every track list so key/BPM render identically everywhere.
const TrackMetaRight = React.memo(({ item }: { item: MusicTrack }) => {
  const { s } = useLibStyles();
  return (
    <View style={s.trackRight}>
      {(item.key || item.bpm != null) && (
        <View style={s.trackKeyBpm}>
          {item.key ? <Text style={s.trackKey} numberOfLines={1}>{item.key}</Text> : null}
          {item.bpm != null ? <Text style={s.trackBpm}>{Math.round(item.bpm)}</Text> : null}
        </View>
      )}
      <Text style={s.trackDur}>{formatDuration(item.duration)}</Text>
    </View>
  );
});
TrackMetaRight.displayName = 'TrackMetaRight';

// Tap a field to sort by it; tap again to flip direction.
function useSort(defaultField: string | null = null, defaultDir: SortDir = 'asc') {
  const [sortBy, setSortBy] = useState<string | null>(defaultField);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  const onSort = useCallback((field: string) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);
  return { sortBy, sortDir, onSort };
}

// Client-side sort for fully loaded lists; nulls always sort last.
//
// PERF: precompute each item's comparison key ONCE (lowercased string or number) and compare with
// plain operators. The previous implementation called String.localeCompare (with an options object,
// recreating a collator) on every comparison — on Hermes that is pathologically slow and froze the
// JS thread for ~70s when sorting the ~8k-row artist/album lists. Plain comparison is case-insensitive
// (via toLowerCase) but not locale-aware; for library browsing that trade-off is well worth it.
function sortList<T>(
  list: T[],
  sortBy: string | null,
  sortDir: SortDir,
  get: (item: T, field: string) => unknown,
): T[] {
  if (!sortBy) return list;
  const dir = sortDir === 'asc' ? 1 : -1;
  const keyed = list.map((item) => {
    const v = get(item, sortBy);
    const key: number | string | null =
      v == null ? null : typeof v === 'number' ? v : String(v).toLowerCase();
    return { item, key };
  });
  keyed.sort((x, y) => {
    const a = x.key;
    const b = y.key;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    let cmp: number;
    if (typeof a === 'number' && typeof b === 'number') {
      cmp = a - b;
    } else {
      const sa = String(a);
      const sb = String(b);
      cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
    }
    return cmp * dir;
  });
  return keyed.map((k) => k.item);
}

// ── TabBar ────────────────────────────────────────────────────────────────────

const TabBar = ({ tabs, active, onSelect }: {
  tabs: string[];
  active: string;
  onSelect: (t: string) => void;
}) => {
  const { s } = useLibStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.tabBarScroll}
      contentContainerStyle={s.tabBarContent}
    >
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onSelect(tab)}
          style={[s.tabBtn, active === tab && s.tabBtnActive]}
        >
          <Text style={[s.tabText, active === tab && s.tabTextActive]}>{tab}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
};

// ── SourcePicker ──────────────────────────────────────────────────────────────

type SourceMode = 'server' | 'local';

function SourcePicker() {
  const { s } = useLibStyles();
  const {
    includeLocalLibrary, setIncludeLocalLibrary,
    setMergeLocalAndServer,
  } = useLibrarySettings();

  const mode: SourceMode = includeLocalLibrary ? 'local' : 'server';

  const setMode = (m: SourceMode) => {
    setMergeLocalAndServer(false);
    setIncludeLocalLibrary(m === 'local');
  };

  return (
    <View style={s.sourcePicker}>
      {(['server', 'local'] as SourceMode[]).map((m) => (
        <Pressable key={m} onPress={() => setMode(m)} style={[s.sourceBtn, mode === m && s.sourceBtnActive]}>
          <Text style={[s.sourceBtnText, mode === m && s.sourceBtnTextActive]}>
            {m === 'server' ? 'Server Library' : 'Local Library'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Action row button used inside bottom sheets ───────────────────────────────

const SheetRow = ({
  icon, label, onPress, danger = false,
}: {
  icon: string; label: string; onPress: () => void; danger?: boolean;
}) => {
  const { s, c } = useLibStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
    >
      <Ionicons name={icon as any} size={20} color={danger ? c.danger : c.textPrimary} />
      <Text style={[s.sheetBtnText, danger && { color: c.danger }]}>{label}</Text>
    </Pressable>
  );
};

// ── PlaylistPickerModal ───────────────────────────────────────────────────────

function PlaylistPickerModal({
  visible, onClose, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (playlistId: string) => void;
}) {
  const { s, c } = useLibStyles();
  const { mixtapes: playlists, create } = useMixtapeStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const pl = await create(name);
    setCreating(false);
    setNewName('');
    onSelect(pl.id);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose} />
      <View style={s.sheetContainer}>
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Add to Mixtape</Text>

          {creating ? (
            <View style={s.inlineCreate}>
              <TextInput
                autoFocus
                style={s.inlineInput}
                value={newName}
                onChangeText={setNewName}
                placeholder="Mixtape name…"
                placeholderTextColor={c.textDim}
                returnKeyType="done"
                onSubmitEditing={handleCreate}
              />
              <Pressable onPress={handleCreate} style={s.inlineConfirm}>
                <Text style={s.inlineConfirmText}>Create</Text>
              </Pressable>
              <Pressable onPress={() => { setCreating(false); setNewName(''); }} hitSlop={8}>
                <Ionicons name="close" size={18} color={c.textMuted} />
              </Pressable>
            </View>
          ) : (
            <SheetRow icon="add-circle-outline" label="New Mixtape" onPress={() => setCreating(true)} />
          )}

          {playlists.length === 0 && !creating && (
            <Text style={[s.empty, { paddingVertical: Spacing.md }]}>No mixtapes yet</Text>
          )}

          {playlists.map((pl) => (
            <Pressable
              key={pl.id}
              onPress={() => onSelect(pl.id)}
              style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
            >
              <Ionicons name="musical-notes" size={18} color={c.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={s.sheetBtnText}>{pl.name}</Text>
                <Text style={s.rowMeta}>{pl.tracks?.length ?? 0} track{(pl.tracks?.length ?? 0) !== 1 ? 's' : ''}</Text>
              </View>
            </Pressable>
          ))}

          <Pressable style={s.sheetCancel} onPress={onClose}>
            <Text style={s.sheetCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── RenameModal ───────────────────────────────────────────────────────────────

function RenameModal({
  initialValue, onCancel, onConfirm, title, visible,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const { s, c } = useLibStyles();
  const [value, setValue] = useState(initialValue);
  const keyboardHeight = useKeyboardHeight();
  useEffect(() => { if (visible) setValue(initialValue); }, [visible, initialValue]);

  const commit = () => { if (value.trim()) onConfirm(value.trim()); };

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <Pressable
        onPress={onCancel}
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
      />
      <View style={[s.renameSheet, { position: 'absolute', left: 0, right: 0, bottom: keyboardHeight }]}>
        <Text style={s.renameTitle}>{title}</Text>
        <TextInput
          autoFocus
          onChangeText={setValue}
          onSubmitEditing={commit}
          placeholderTextColor={c.textMuted}
          returnKeyType="done"
          style={s.renameInput}
          value={value}
        />
        <View style={s.renameActions}>
          <Pressable onPress={onCancel} style={s.renameCancelBtn}>
            <Text style={s.renameCancelText}>Cancel</Text>
          </Pressable>
          <Pressable onPress={commit} style={s.renameConfirmBtn}>
            <Text style={s.renameConfirmText}>Save</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── PlaylistRenameSheet ───────────────────────────────────────────────────────
// Separate component so useKeyboardHeight hook works inside the modal

function PlaylistRenameSheet({ name, onChange, onCancel, onConfirm }: {
  name: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { s, c } = useLibStyles();
  const keyboardHeight = useKeyboardHeight();
  return (
    <>
      <Pressable
        onPress={onCancel}
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
      />
      <View style={[s.renameSheet, { position: 'absolute', left: 0, right: 0, bottom: keyboardHeight }]}>
        <Text style={s.renameTitle}>Rename mixtape</Text>
        <TextInput
          autoFocus
          onChangeText={onChange}
          onSubmitEditing={onConfirm}
          placeholder="Mixtape name…"
          placeholderTextColor={c.textMuted}
          returnKeyType="done"
          style={s.renameInput}
          value={name}
        />
        <View style={s.renameActions}>
          <Pressable onPress={onCancel} style={s.renameCancelBtn}>
            <Text style={s.renameCancelText}>Cancel</Text>
          </Pressable>
          <Pressable onPress={onConfirm} style={s.renameConfirmBtn}>
            <Text style={s.renameConfirmText}>Save</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

// ── FolderActionSheet ─────────────────────────────────────────────────────────

function FolderActionSheet({
  folder, onClose, onRename,
}: {
  folder: MusicFolder | null;
  onClose: () => void;
  onRename: (folder: MusicFolder) => void;
}) {
  const { s } = useLibStyles();
  const { addTrack } = useMixtapeStore();
  const [showPicker, setShowPicker] = useState(false);

  if (!folder) return null;

  const handleSelectMixtape = async (playlistId: string) => {
    setShowPicker(false);
    onClose();
    try {
      const result = await getTracks({ folder: folder.path, limit: 5000 });
      await Promise.allSettled((result.tracks ?? []).map((t) => addTrack(playlistId, t.path)));
    } catch { /* ignore */ }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete folder',
      `Delete "${folder.name}" and all its files? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteFolderApi(folder.path).catch((e: any) =>
              Alert.alert('Delete failed', e?.response?.data || e?.message || 'Unknown error'),
            );
            onClose();
          },
        },
      ],
    );
  };

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={s.overlay} onPress={onClose} />
        <View style={s.sheetContainer}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle} numberOfLines={1}>{folder.name}</Text>
            {folder.trackCount > 0 && (
              <Text style={s.sheetMeta}>{folder.trackCount} track{folder.trackCount !== 1 ? 's' : ''}</Text>
            )}
            <View style={s.sheetDivider} />
            <SheetRow
              icon="analytics-outline"
              label="Analyse all tracks (Key & BPM)"
              onPress={() => { analyzeFolder(folder.path, { key: true, bpm: true }).catch(() => {}); onClose(); }}
            />
            <SheetRow
              icon="key-outline"
              label="Analyse all tracks (Key only)"
              onPress={() => { analyzeFolder(folder.path, { key: true, bpm: false }).catch(() => {}); onClose(); }}
            />
            <SheetRow
              icon="pulse-outline"
              label="Analyse all tracks (BPM only)"
              onPress={() => { analyzeFolder(folder.path, { key: false, bpm: true }).catch(() => {}); onClose(); }}
            />
            <View style={s.sheetDivider} />
            <SheetRow icon="list" label="Add to Mixtape" onPress={() => setShowPicker(true)} />
            <View style={s.sheetDivider} />
            <SheetRow icon="pencil-outline" label="Rename folder…" onPress={() => onRename(folder)} />
            <View style={s.sheetDivider} />
            <SheetRow icon="trash-outline" label="Delete folder…" onPress={handleDelete} danger />
            <Pressable style={s.sheetCancel} onPress={onClose}>
              <Text style={s.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {showPicker && (
        <PlaylistPickerModal
          visible
          onClose={() => setShowPicker(false)}
          onSelect={handleSelectMixtape}
        />
      )}
    </>
  );
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── AlbumActionSheet ──────────────────────────────────────────────────────────

function AlbumActionSheet({ album, onClose }: {
  album: MusicAlbum | null;
  onClose: () => void;
}) {
  const { s } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const { playQueue, addToQueue, playNext } = usePlayer();
  const { addTrack } = useMixtapeStore();
  const [showPicker, setShowPicker] = useState(false);

  if (!album) return null;

  const fetchAlbumTracks = async (): Promise<MusicTrack[]> => {
    try {
      const result = await getTracks({
        album: album.album,
        ...(album.directory ? { folder: album.directory } : { artist: album.artist }),
        limit: 500,
      });
      return [...(result.tracks ?? [])].sort((a, b) => {
        if ((a.discNumber ?? 1) !== (b.discNumber ?? 1))
          return (a.discNumber ?? 1) - (b.discNumber ?? 1);
        return (a.trackNumber ?? 999) - (b.trackNumber ?? 999);
      });
    } catch { return []; }
  };

  const withTracks = (fn: (tracks: MusicTrack[]) => void) => async () => {
    onClose();
    const tracks = await fetchAlbumTracks();
    if (tracks.length) fn(tracks);
  };

  const handleSelectMixtape = async (playlistId: string) => {
    setShowPicker(false);
    onClose();
    const tracks = await fetchAlbumTracks();
    await Promise.allSettled(tracks.map((t) => addTrack(playlistId, t.path)));
  };

  const searchSoulseek = async () => {
    onClose();
    const searchText = [album.artist, album.album].filter(Boolean).join(' ');
    if (!searchText) return;
    const id = randomUUID();
    const newSearch = await createSearch(id, searchText);
    (navigation as any).getParent()?.navigate('SearchTab', {
      screen: 'SearchResults',
      params: { searchId: newSearch.id, searchText },
    });
  };

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={s.overlay} onPress={onClose} />
        <View style={s.sheetContainer}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle} numberOfLines={1}>{album.album || '(Untitled)'}</Text>
            <Text style={s.sheetMeta} numberOfLines={1}>
              {[album.artist, album.year?.toString(), `${album.trackCount} track${album.trackCount !== 1 ? 's' : ''}`]
                .filter(Boolean).join(' · ')}
            </Text>
            <View style={s.sheetDivider} />
            <SheetRow
              icon="play-circle"
              label="Play Album"
              onPress={withTracks((t) => { playQueue(t, 0); })}
            />
            <SheetRow
              icon="shuffle"
              label="Shuffle Album"
              onPress={withTracks((t) => {
                playQueue([...t].sort(() => Math.random() - 0.5), 0);
              })}
            />
            <SheetRow icon="play-skip-forward" label="Play Next" onPress={withTracks((t) => playNext(t))} />
            <SheetRow icon="add-circle-outline" label="Add to Queue" onPress={withTracks((t) => addToQueue(t))} />
            <SheetRow icon="list" label="Add to Mixtape" onPress={() => setShowPicker(true)} />
            {album.artist && (
              <>
                <View style={s.sheetDivider} />
                <SheetRow
                  icon="person-outline"
                  label={`Go to ${album.artist}`}
                  onPress={() => { navigation.push('Artist', { artistName: album.artist }); onClose(); }}
                />
                <SheetRow
                  icon="search"
                  label={`More from ${album.artist}`}
                  onPress={async () => {
                    onClose();
                    const id = randomUUID();
                    const newSearch = await createSearch(id, album.artist);
                    (navigation as any).getParent()?.navigate('SearchTab', {
                      screen: 'SearchResults',
                      params: { searchId: newSearch.id, searchText: album.artist },
                    });
                  }}
                />
              </>
            )}
            <SheetRow icon="search" label="Find album on Soulseek" onPress={searchSoulseek} />
            <Pressable style={s.sheetCancel} onPress={onClose}>
              <Text style={s.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {showPicker && (
        <PlaylistPickerModal
          visible
          onClose={() => setShowPicker(false)}
          onSelect={handleSelectMixtape}
        />
      )}
    </>
  );
}

// ── TrackActionSheet ──────────────────────────────────────────────────────────

interface TrackActionSheetProps {
  track: MusicTrack | null;
  onClose: () => void;
  onPlayNow: (track: MusicTrack) => void;
  onPlayNext: (track: MusicTrack) => void;
  onAddToQueue: (track: MusicTrack) => void;
  onRename?: (track: MusicTrack) => void;
  extraActions?: { icon: string; label: string; onPress: () => void; danger?: boolean }[];
}

function TrackActionSheet({
  track, onClose, onPlayNow, onPlayNext, onAddToQueue, onRename, extraActions = [],
}: TrackActionSheetProps) {
  const { s } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const [showPicker, setShowPicker] = useState(false);
  const { mixtapes: playlists, addTrack } = useMixtapeStore();

  if (!track) return null;

  const metaParts = [
    track.genre,
    track.key,
    track.bpm ? `${Math.round(track.bpm)} BPM` : null,
  ].filter(Boolean);

  const handleSelectPlaylist = async (playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    if (playlist?.tracks?.some((t) => t.filePath === track.path)) {
      Alert.alert('Already in mixtape', `"${getTrackTitle(track)}" is already in "${playlist.name}".`);
      setShowPicker(false);
      onClose();
      return;
    }
    await addTrack(playlistId, track.path);
    setShowPicker(false);
    onClose();
  };

  const fName = track.directory ? folderName(track.directory) : null;

  const goArtist = track.directory
    ? () => {
        const norm = track.directory!.replace(/\\/g, '/').replace(/\/$/, '');
        const lastSlash = norm.lastIndexOf('/');
        const parent = lastSlash > 0 ? norm.slice(0, lastSlash) : norm;
        const pName = parent.split('/').filter(Boolean).pop() ?? parent;
        navigation.push('FolderDetail', { folderPath: parent, folderName: pName });
        onClose();
      }
    : null;

  const goFolder = track.directory && fName
    ? () => { navigation.push('FolderDetail', { folderPath: track.directory!, folderName: fName }); onClose(); }
    : null;

  const searchSoulseek = async (searchText: string) => {
    onClose();
    const id = randomUUID();
    const newSearch = await createSearch(id, searchText);
    (navigation as any).getParent()?.navigate('SearchTab', {
      screen: 'SearchResults',
      params: { searchId: newSearch.id, searchText },
    });
  };

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={s.overlay} onPress={onClose} />
        <View style={s.sheetContainer}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle} numberOfLines={1}>{getTrackTitle(track)}</Text>
            <Text style={s.sheetMeta} numberOfLines={1}>
              {[track.artist, track.album].filter(Boolean).join(' · ')}
            </Text>
            {metaParts.length > 0 && (
              <Text style={s.sheetMetaSub}>{metaParts.join(' · ')}</Text>
            )}
            <View style={s.sheetDivider} />
            <SheetRow icon="play-circle" label="Play Now" onPress={() => onPlayNow(track)} />
            <SheetRow icon="play-skip-forward" label="Play Next" onPress={() => onPlayNext(track)} />
            <SheetRow icon="add-circle-outline" label="Add to Queue" onPress={() => onAddToQueue(track)} />
            <SheetRow icon="list" label="Add to Mixtape" onPress={() => setShowPicker(true)} />
            {(goArtist || goFolder) && <View style={s.sheetDivider} />}
            {goArtist && <SheetRow icon="folder-open-outline" label="Go to artist folder" onPress={goArtist} />}
            {goFolder && <SheetRow icon="folder-outline" label={`Show in folder: ${fName}`} onPress={goFolder} />}
            {onRename && (
              <SheetRow
                icon="pencil-outline"
                label="Rename track…"
                onPress={() => { onRename(track); onClose(); }}
              />
            )}
            {isLocalPath(track.path) && (
              <SheetRow
                icon="save-outline"
                label="Export to USB"
                onPress={async () => {
                  onClose();
                  const result = await exportTrackToUsb(track);
                  Alert.alert('Export to USB', result.message ?? result.reason ?? 'Done');
                }}
              />
            )}
            <View style={s.sheetDivider} />
            {track.artist && (
              <SheetRow
                icon="search"
                label={`More from ${track.artist}`}
                onPress={() => searchSoulseek(track.artist!)}
              />
            )}
            {track.title && (() => {
              const clean = stripRemixInfo(track.title);
              return (
                <>
                  <SheetRow
                    icon="search"
                    label={`Find similar: "${clean.length > 28 ? clean.slice(0, 28) + '…' : clean}"`}
                    onPress={() => searchSoulseek(`"${clean}"`)}
                  />
                  <SheetRow
                    icon="search"
                    label={`Find remixes: "${clean.length > 26 ? clean.slice(0, 26) + '…' : clean}"`}
                    onPress={() => searchSoulseek(`"${clean}" remix`)}
                  />
                </>
              );
            })()}
            {extraActions.map((a) => (
              <SheetRow key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} danger={a.danger} />
            ))}
            <Pressable style={s.sheetCancel} onPress={onClose}>
              <Text style={s.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {showPicker && (
        <PlaylistPickerModal
          visible
          onClose={() => setShowPicker(false)}
          onSelect={handleSelectPlaylist}
        />
      )}
    </>
  );
}

// ── LibrarySettingsModal ──────────────────────────────────────────────────────

function LibrarySettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { s, c } = useLibStyles();
  const {
    visibleTabs, setVisibleTabs,
    includeLocalLibrary, setIncludeLocalLibrary,
    mergeLocalAndServer, setMergeLocalAndServer,
  } = useLibrarySettings();
  const bumpLibraryRevision = useLibraryActivityStore((s) => s.bumpLibraryRevision);
  const [rescanning, setRescanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 });

  const handleRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    await forceRescanLocalTracks();
    await getAllLocalTracks(); // returns immediately; background scan fires _onScanProgress batches
    bumpLibraryRevision();
    setRescanning(false);
  };

  const handleExportAll = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress({ done: 0, total: 0 });
    const tracks = await getAllLocalTracks();
    const result = await exportTracksToUsb(tracks, (done, total) => setExportProgress({ done, total }));
    setExporting(false);
    Alert.alert('Export to USB', result.ok
      ? `Exported ${result.exported}, skipped ${result.skipped}, failed ${result.failed}.`
      : result.reason ?? 'Export failed.');
  };

  const toggle = (tab: LibraryTab) => {
    if (visibleTabs.includes(tab)) {
      if (visibleTabs.length <= 1) return;
      setVisibleTabs(visibleTabs.filter((t) => t !== tab));
    } else {
      const next = [...visibleTabs, tab].sort(
        (a, b) => ALL_TABS.indexOf(a) - ALL_TABS.indexOf(b),
      );
      setVisibleTabs(next);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose} />
      <View style={s.sheetContainer}>
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Library Options</Text>

          <View style={s.sheetDivider} />
          <Pressable
            onPress={() => setIncludeLocalLibrary(!includeLocalLibrary)}
            style={[s.sheetBtn, { justifyContent: 'space-between' }]}
          >
            <View>
              <Text style={s.sheetBtnText}>Include Local Music</Text>
              <Text style={s.sheetMetaSub}>Scan music from your device storage</Text>
            </View>
            <Switch
              value={includeLocalLibrary}
              onValueChange={setIncludeLocalLibrary}
              thumbColor={includeLocalLibrary ? c.accent : c.textMuted}
              trackColor={{ false: c.bgElevated, true: `${c.accent}88` }}
            />
          </Pressable>

          {includeLocalLibrary && (
            <Pressable
              onPress={() => setMergeLocalAndServer(!mergeLocalAndServer)}
              style={[s.sheetBtn, { justifyContent: 'space-between' }]}
            >
              <View>
                <Text style={s.sheetBtnText}>Merge with Server Library</Text>
                <Text style={s.sheetMetaSub}>Show local and server tracks in one list</Text>
              </View>
              <Switch
                value={mergeLocalAndServer}
                onValueChange={setMergeLocalAndServer}
                thumbColor={mergeLocalAndServer ? c.accent : c.textMuted}
                trackColor={{ false: c.bgElevated, true: `${c.accent}88` }}
              />
            </Pressable>
          )}

          {includeLocalLibrary && (
            <Pressable
              onPress={handleRescan}
              disabled={rescanning}
              style={[s.sheetBtn, { justifyContent: 'space-between', opacity: rescanning ? 0.5 : 1 }]}
            >
              <View>
                <Text style={s.sheetBtnText}>{rescanning ? 'Rescanning…' : 'Rescan Local Library'}</Text>
                <Text style={s.sheetMetaSub}>Re-read metadata and artwork from all local files</Text>
              </View>
              <Ionicons name="refresh" size={20} color={c.textMuted} />
            </Pressable>
          )}

          {includeLocalLibrary && (
            <Pressable
              onPress={handleExportAll}
              disabled={exporting}
              style={[s.sheetBtn, { justifyContent: 'space-between', opacity: exporting ? 0.5 : 1 }]}
            >
              <View>
                <Text style={s.sheetBtnText}>
                  {exporting ? `Exporting… (${exportProgress.done}/${exportProgress.total})` : 'Export All Local Tracks to USB'}
                </Text>
                <Text style={s.sheetMetaSub}>Copy all local tracks to a folder on a USB drive</Text>
              </View>
              <Ionicons name="save-outline" size={20} color={c.textMuted} />
            </Pressable>
          )}

          {includeLocalLibrary && mergeLocalAndServer && (
            <View style={[s.sheetBtn, { flexDirection: 'row', gap: Spacing.lg }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="cloud" size={10} color="#fff" />
                </View>
                <Text style={s.sheetMetaSub}>Server</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#e08030', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="phone-portrait" size={10} color="#fff" />
                </View>
                <Text style={s.sheetMetaSub}>Device</Text>
              </View>
            </View>
          )}

          <View style={s.sheetDivider} />
          <Text style={[s.sheetMeta, { paddingHorizontal: Spacing.md, paddingTop: Spacing.xs }]}>
            Tabs to show
          </Text>
          <ScrollView style={{ maxHeight: 300 }}>
            {ALL_TABS.map((tab) => {
              const on = visibleTabs.includes(tab);
              return (
                <Pressable
                  key={tab}
                  onPress={() => toggle(tab)}
                  style={[s.sheetBtn, { justifyContent: 'space-between' }]}
                >
                  <Text style={s.sheetBtnText}>{tab}</Text>
                  <Switch
                    value={on}
                    onValueChange={() => toggle(tab)}
                    thumbColor={on ? c.accent : c.textMuted}
                    trackColor={{ false: c.bgElevated, true: `${c.accent}88` }}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={s.sheetCancel} onPress={onClose}>
            <Text style={s.sheetCancelText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Tab: Artists ──────────────────────────────────────────────────────────────

// First-populate ("downloading") and background-revalidate ("updating") visualizations.
// loading = cold start, nothing cached yet → full-screen downloading state.
// refreshing = revalidating already-shown data → slim non-blocking banner above the list.
function DownloadingLibrary({ label = 'Downloading metadata…', percent, detail }: {
  label?: string;
  percent?: number;   // 0-100; when provided, shows a determinate progress bar + %
  detail?: string;    // e.g. the list currently downloading
}) {
  const { s, c } = useLibStyles();
  const hasPct = typeof percent === 'number' && percent >= 0;
  return (
    <View style={[s.flex, { justifyContent: 'center', alignItems: 'center', padding: Spacing.xl }]}>
      <Ionicons name="cloud-download-outline" size={44} color={c.accent} />
      <Text style={[s.rowTitle, { marginTop: Spacing.md, textAlign: 'center' }]}>{label}</Text>
      {hasPct ? (
        <>
          <View style={{
            width: 220, height: 6, borderRadius: 3, marginTop: Spacing.md,
            backgroundColor: c.bgElevated, overflow: 'hidden',
          }}>
            <View style={{
              width: `${Math.min(100, Math.max(0, percent!))}%`,
              height: '100%', borderRadius: 3, backgroundColor: c.accent,
            }} />
          </View>
          <Text style={[s.rowMeta, { marginTop: 8 }]}>
            {Math.round(percent!)}%{detail ? ` · ${detail}` : ''}
          </Text>
        </>
      ) : (
        <ActivityIndicator color={c.accent} style={{ marginTop: Spacing.md }} />
      )}
    </View>
  );
}

function UpdatingBanner({ visible }: { visible: boolean }) {
  const { c } = useLibStyles();
  if (!visible) return null;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, paddingVertical: 5, backgroundColor: c.bgElevated,
    }}>
      <ActivityIndicator size="small" color={c.accent} />
      <Text style={{ color: c.textMuted, fontSize: 12 }}>Updating metadata…</Text>
    </View>
  );
}

// Pure reader over the on-device library cache. The whole library is downloaded in one go by the
// bulk sync (useLibrarySync), so tabs never fetch individually — they just read their slice and
// re-read when the sync writes (cacheVersion bumps). loading/refreshing derive from the global
// sync status. `_fetcher` is unused (the bulk sync owns all network) but kept so call sites read
// naturally. `enabled=false` is local-only mode (no server slice).
function useServerCachedList<T>(
  cacheKey: string,
  _fetcher: unknown,
  enabled: boolean,
  seed?: (rows: T[]) => void,
): { data: T[]; loading: boolean; refreshing: boolean } {
  const cacheVersion = useLibrarySync((st) => st.cacheVersion);
  const syncing = useLibrarySync((st) => st.status === 'syncing');
  const [data, setData] = useState<T[] | undefined>(
    () => (enabled ? peekListCache<T[]>(cacheKey) : undefined),
  );

  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (!enabled) { setData(undefined); return; }
    let cancelled = false;
    const apply = (d: T[], how: string, ms: number) => {
      if (cancelled) return;
      const t = Date.now();
      setData(d);
      seedRef.current?.(d);
      dbg(`[slice] ${cacheKey} ${how} rows=${d.length} read=${ms}ms seed=${Date.now() - t}ms`);
    };
    const t0 = Date.now();
    const memHit = peekListCache<T[]>(cacheKey);
    if (memHit !== undefined) apply(memHit, 'mem', Date.now() - t0);
    else readListCache<T[]>(cacheKey).then((d) => { if (d) apply(d, 'disk', Date.now() - t0); }).catch(() => {});
    return () => { cancelled = true; };
     
  }, [cacheKey, enabled, cacheVersion]);

  const list = data ?? [];
  return {
    data: list,
    loading: enabled && syncing && list.length === 0,
    refreshing: enabled && syncing && list.length > 0,
  };
}

// Loads the on-device local library list (fast, no network) when local music is enabled.
function useLocalList<T>(fetcher: () => Promise<T[]>, enabled: boolean): T[] {
  const [data, setData] = useState<T[]>([]);
  const libraryRevision = useLibraryActivityStore((st) => st.libraryRevision);
  useEffect(() => {
    if (!enabled) { setData([]); return; }
    let cancelled = false;
    fetcher().then((d) => { if (!cancelled) setData(d ?? []); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, libraryRevision]);
  return data;
}

// True while the backend is running a full (re)scan that rebuilds the track DB. Track fetches hang
// or come back empty during that window, so the paginated track views gate their loads on this and
// show a "rebuilding" placeholder instead of an endless spinner. They reload once it flips false.
const useServerScanning = () => useLibraryActivityStore((s) => s.syncState?.running ?? false);

const REBUILDING_MSG = 'Library is rebuilding — tracks will appear when it’s done.';

function ArtistsTab() {
  const { s, c } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const [search, setSearch] = useState('');
  const { sortBy, sortDir, onSort } = useSort('artist');
  const { includeLocalLibrary, mergeLocalAndServer } = useLibrarySettings();

  const wantServer = !includeLocalLibrary || mergeLocalAndServer;
  const { data: serverArtists, loading: serverLoading, refreshing } =
    useServerCachedList<MusicArtist>('artists', getArtists, wantServer, seedCoverSignatures);
  const localArtists = useLocalList<MusicArtist>(getLocalArtists, includeLocalLibrary);

  const artists = useMemo<MusicArtist[]>(() => {
    if (includeLocalLibrary && !mergeLocalAndServer) return localArtists;
    if (includeLocalLibrary && mergeLocalAndServer) {
      // Merge and deduplicate by artist name
      const merged = new Map<string, MusicArtist>();
      [...serverArtists, ...localArtists].forEach((a) => {
        const existing = merged.get(a.artist);
        if (existing) {
          existing.albumCount += a.albumCount;
          existing.trackCount += a.trackCount;
        } else {
          merged.set(a.artist, { ...a });
        }
      });
      return Array.from(merged.values());
    }
    return serverArtists;
  }, [serverArtists, localArtists, includeLocalLibrary, mergeLocalAndServer]);

  const loading = wantServer && serverLoading && artists.length === 0;

  const filtered = useMemo(() => {
    let list = artists;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.artist?.toLowerCase().includes(q));
    }
    return sortList(list, sortBy, sortDir, (a, f) => a[f as keyof MusicArtist]);
  }, [artists, search, sortBy, sortDir]);

  const renderItem = useCallback(({ item }: { item: MusicArtist }) => (
    <Pressable
      onPress={() => navigation.push('Artist', { artistName: item.artist })}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      <View style={s.artistIcon}>
        <Ionicons name="person" size={18} color={c.textMuted} />
      </View>
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{item.artist || '(Unknown Artist)'}</Text>
        <Text style={s.rowMeta}>
          {item.albumCount} album{item.albumCount !== 1 ? 's' : ''} · {item.trackCount} track{item.trackCount !== 1 ? 's' : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </Pressable>
  ), [navigation, s, c]);

  if (!loading && includeLocalLibrary && !mergeLocalAndServer && filtered.length === 0) {
    return (
      <View style={[s.flex, { justifyContent: 'center', alignItems: 'center', padding: Spacing.xl }]}>
        <Ionicons name="phone-portrait-outline" size={48} color={c.textDim} />
        <Text style={[s.rowMeta, { marginTop: 12, textAlign: 'center' }]}>
          {'Artist info isn\'t available for device music.\nBrowse your local tracks via Albums or Tracks.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.flex}>
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search artists…"
        trailing={
          <SortControl
            options={[
              { field: 'artist', label: 'Name' },
              { field: 'albumCount', label: 'Albums' },
              { field: 'trackCount', label: 'Tracks' },
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        }
      />
      <UpdatingBanner visible={refreshing && !loading} />
      {loading
        ? <DownloadingLibrary />
        : (
          <FlatList
            {...LIST_PERF_PROPS}
            data={filtered}
            keyExtractor={(item) => item.artist}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.empty}>{search ? 'No artists match' : 'No artists in library'}</Text>
            }
          />
        )}
    </View>
  );
}

// ── Tab: Albums ───────────────────────────────────────────────────────────────

type AlbumWithSource = MusicAlbum & { _local?: boolean };

function AlbumsTab() {
  const { s, c } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const [search, setSearch] = useState('');
  const [actionAlbum, setActionAlbum] = useState<MusicAlbum | null>(null);
  const { sortBy, sortDir, onSort } = useSort('album');
  const { includeLocalLibrary, mergeLocalAndServer } = useLibrarySettings();

  const wantServer = !includeLocalLibrary || mergeLocalAndServer;
  const { data: serverAlbums, loading: serverLoading, refreshing } =
    useServerCachedList<AlbumWithSource>('albums', getAlbums, wantServer, seedCoverSignatures);
  const localAlbumsRaw = useLocalList<MusicAlbum>(getLocalAlbums, includeLocalLibrary);
  const localAlbums = useMemo<AlbumWithSource[]>(
    () => localAlbumsRaw.map((a) => ({ ...a, _local: true })),
    [localAlbumsRaw],
  );

  const albums = useMemo<AlbumWithSource[]>(() => {
    if (includeLocalLibrary && !mergeLocalAndServer) return localAlbums;
    if (includeLocalLibrary && mergeLocalAndServer) return [...serverAlbums, ...localAlbums];
    return serverAlbums;
  }, [serverAlbums, localAlbums, includeLocalLibrary, mergeLocalAndServer]);

  const loading = wantServer && serverLoading && albums.length === 0;

  const filtered = useMemo(() => {
    let list = albums;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) => a.album?.toLowerCase().includes(q) || a.artist?.toLowerCase().includes(q),
      );
    }
    return sortList(list, sortBy, sortDir, (a, f) => a[f as keyof MusicAlbum]);
  }, [albums, search, sortBy, sortDir]);

  const showBadge = includeLocalLibrary && mergeLocalAndServer;

  const renderItem = useCallback(({ item }: { item: AlbumWithSource }) => (
    <Pressable
      onPress={() => item._local
        ? navigation.push('Album', { album: item, localAlbumTitle: item.album ?? undefined })
        : navigation.push('Album', { album: item })}
      onLongPress={() => !item._local && setActionAlbum(item)}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      <ArtworkBox
        path={item.coverPath}
        size={48}
        source={showBadge ? (item._local ? 'local' : 'server') : undefined}
      />
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{item.album || '(Untitled)'}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[item.artist, item.year?.toString()].filter(Boolean).join(' · ')}
          {item._local && !showBadge && (
            <Text style={{ color: '#e08030' }}> · device</Text>
          )}
        </Text>
      </View>
      {!item._local && (
        <Pressable onPress={() => setActionAlbum(item)} hitSlop={8} style={s.moreBtn}>
          <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
        </Pressable>
      )}
    </Pressable>
  ), [navigation, s, c, showBadge]);

  return (
    <View style={s.flex}>
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search albums…"
        trailing={
          <SortControl
            options={[
              { field: 'album', label: 'Title' },
              { field: 'artist', label: 'Artist' },
              { field: 'year', label: 'Year' },
              { field: 'trackCount', label: 'Tracks' },
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        }
      />
      <UpdatingBanner visible={refreshing && !loading} />
      {loading
        ? <DownloadingLibrary />
        : (
          <FlatList
            {...LIST_PERF_PROPS}
            data={filtered}
            keyExtractor={(item) => `${item.album}-${item.artist}`}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.empty}>{search ? 'No albums match' : 'No albums in library'}</Text>
            }
          />
        )}
      <AlbumActionSheet album={actionAlbum} onClose={() => setActionAlbum(null)} />
    </View>
  );
}

// ── Tab: Tracks ───────────────────────────────────────────────────────────────

function TracksTab() {
  const { s, c } = useLibStyles();
  const { playQueue, addToQueue, playNext } = usePlayer();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(false);
  // Distinct from `fetching` (which also covers infinite-scroll paging): true only during a full
  // reload, so the downloading/updating visualizations don't flash while paging.
  const [reloading, setReloading] = useState(false);
  const [search, setSearch] = useState('');
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);
  const [renameTarget, setRenameTarget] = useState<MusicTrack | null>(null);
  const { sortBy, sortDir, onSort } = useSort('artist');
  // Freeze the revision the reload effects react to while the backend is mid-rescan: a full rescan
  // fires LIBRARY_UPDATED (→ libraryRevision++) on every batch, and reloading the track list on each
  // one just thrashes the network against a half-built DB. `libraryRevision` thaws to the latest
  // value once the scan ends, triggering a single refresh. (Search/sort changes still reload live.)
  const rawRevision = useLibraryActivityStore((s) => s.libraryRevision);
  const serverScanning = useLibraryActivityStore((s) => s.syncState?.running ?? false);
  const [libraryRevision, setLibraryRevision] = useState(rawRevision);
  useEffect(() => {
    if (!serverScanning) setLibraryRevision(rawRevision);
  }, [rawRevision, serverScanning]);
  const { includeLocalLibrary, mergeLocalAndServer } = useLibrarySettings();

  // Client-side mode: used when local library is enabled (local-only or merged)
  // We load everything upfront and sort/filter in memory.
  const clientMode = includeLocalLibrary;
  const [allTracks, setAllTracks] = useState<MusicTrack[]>([]);

  // Server-side paginated mode (only when clientMode === false)
  const fetchingRef = useRef(false);
  const tracksRef   = useRef<MusicTrack[]>([]);
  const totalRef    = useRef(0);
  const searchRef   = useRef('');
  const sortRef     = useRef<{ sortBy: string | null; sortDir: SortDir }>({ sortBy: 'artist', sortDir: 'asc' });
  const scanningRef = useRef(serverScanning);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { totalRef.current = total; }, [total]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { sortRef.current = { sortBy, sortDir }; }, [sortBy, sortDir]);
  useEffect(() => { scanningRef.current = serverScanning; }, [serverScanning]);

  const loadPage = useCallback(async (reset: boolean, query: string) => {
    if (clientMode) return;
    if (scanningRef.current) return; // backend is rebuilding the DB — don't fetch into a hang
    if (fetchingRef.current) return;
    const offset = reset ? 0 : tracksRef.current.length;
    if (!reset && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    if (reset) setReloading(true);
    try {
      const result = await getTracks({
        search: query,
        limit: TRACKS_PER_PAGE,
        offset,
        sort: sortRef.current.sortBy ?? 'artist',
        descending: String(sortRef.current.sortDir === 'desc'),
      });
      setTracks((prev) => reset ? result.tracks : [...prev, ...result.tracks]);
      setTotal(result.total);
      totalRef.current = result.total;
      // Persist the first page (default, unsearched) so the tab can paint instantly next time.
      if (reset && !query) {
        writeListCache(
          `tracks:first:${sortRef.current.sortBy ?? 'artist'}:${sortRef.current.sortDir}`,
          { tracks: result.tracks, total: result.total },
        );
      }
    } catch {}
    finally { fetchingRef.current = false; setFetching(false); setReloading(false); }
  }, [clientMode]);

  // Server-side mode: reload on search/sort/revision change. For the default (unsearched) view,
  // paint the cached first page instantly while the network revalidates in the background.
  useEffect(() => {
    if (clientMode) return;
    let cancelled = false;
    if (!search) {
      const key = `tracks:first:${sortBy}:${sortDir}`;
      const applyCached = (cached?: { tracks: MusicTrack[]; total: number }) => {
        if (cancelled || !cached || searchRef.current) return;
        seedTrackSignatures(cached.tracks);
        setTracks(cached.tracks);
        setTotal(cached.total);
      };
      const memHit = peekListCache<{ tracks: MusicTrack[]; total: number }>(key);
      if (memHit) applyCached(memHit);
      else readListCache<{ tracks: MusicTrack[]; total: number }>(key).then(applyCached).catch(() => {});
    }
    const t = setTimeout(() => loadPage(true, search), search ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, libraryRevision, sortBy, sortDir, clientMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side mode: load all tracks when settings change
  useEffect(() => {
    if (!clientMode) return;
    let cancelled = false;
    const loadAll = async () => {
      setFetching(true);
      setReloading(true);
      try {
        const localTracks = await getAllLocalTracks().catch(() => [] as MusicTrack[]);
        if (cancelled) return;
        if (mergeLocalAndServer) {
          // Paint instantly from the cached server portion, then revalidate the 5k server pull.
          const cachedServer = await readListCache<MusicTrack[]>('tracks:all:server');
          if (!cancelled && cachedServer) {
            seedTrackSignatures(cachedServer);
            setAllTracks([...cachedServer, ...localTracks]);
          }
          const result = await getTracks({ limit: 5000 }).catch(() => ({ tracks: [] as MusicTrack[], total: 0 }));
          if (cancelled) return;
          writeListCache('tracks:all:server', result.tracks);
          setAllTracks([...result.tracks, ...localTracks]);
        } else {
          setAllTracks(localTracks);
        }
      } finally {
        if (!cancelled) { setFetching(false); setReloading(false); }
      }
    };
    loadAll();
    return () => { cancelled = true; };
  }, [clientMode, mergeLocalAndServer, libraryRevision]);

  // Client-mode filtered + sorted list
  const clientTracks = useMemo(() => {
    if (!clientMode) return [];
    let list = allTracks;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        getTrackTitle(t).toLowerCase().includes(q) ||
        t.artist?.toLowerCase().includes(q) ||
        t.album?.toLowerCase().includes(q),
      );
    }
    return sortList(list, sortBy, sortDir, (t, f) =>
      f === 'title' ? getTrackTitle(t) : t[f as keyof MusicTrack]);
  }, [clientMode, allTracks, search, sortBy, sortDir]);

  const displayTracks = clientMode ? clientTracks : tracks;
  const displayRef    = useRef<MusicTrack[]>([]);
  useEffect(() => { displayRef.current = displayTracks; }, [displayTracks]);

  const showBadge = clientMode && mergeLocalAndServer;

  // Play the tapped track and queue the *whole* list, not just the pages scrolled into view.
  // In clientMode `displayRef` already holds everything; in server-paginated mode only ~50 rows
  // are loaded, so we fetch the full ordered set (current search/sort) and queue that — otherwise
  // playback would stop after the first loaded page.
  const playFromList = useCallback(async (tapped: MusicTrack, fallbackIndex: number) => {
    if (clientMode) {
      playQueue(displayRef.current, fallbackIndex);
      return;
    }
    try {
      const window = queueWindow({ index: fallbackIndex });
      const result = await getTracks({
        search: searchRef.current,
        ...window,
        sort: sortRef.current.sortBy ?? 'artist',
        descending: String(sortRef.current.sortDir === 'desc'),
      });
      const full = result.tracks?.length ? result.tracks : displayRef.current;
      const idx = full.findIndex((x) => x.path === tapped.path);
      // Index within the fetched window, not the full list — the window starts at `offset`.
      playQueue(full, idx >= 0 ? idx : Math.max(0, fallbackIndex - window.offset));
    } catch {
      playQueue(displayRef.current, fallbackIndex);
    }
  }, [clientMode, playQueue]);

  const renderTrack = useCallback(({ item, index }: { item: MusicTrack; index: number }) => {
    const local = isLocalPath(item.path);
    return (
      <Pressable
        onPress={() => { playFromList(item, index); }}
        style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
      >
        <ArtworkBox
          path={item.hasArtwork && !local ? item.path : null}
          overrideUrl={local && item.hasArtwork ? item.coverPath : undefined}
          size={42}
          source={showBadge ? (local ? 'local' : 'server') : undefined}
        />
        <View style={s.rowInfo}>
          <Text style={s.rowTitle} numberOfLines={1}>{getTrackTitle(item)}</Text>
          <Text style={s.rowMeta} numberOfLines={1}>
            {[item.artist, item.album].filter(Boolean).join(' · ')}
            {clientMode && !mergeLocalAndServer && local && (
              <Text style={{ color: '#e08030' }}> · device</Text>
            )}
          </Text>
        </View>
        <TrackMetaRight item={item} />
        <Pressable onPress={() => setActionTrack(item)} hitSlop={8} style={s.moreBtn}>
          <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
        </Pressable>
      </Pressable>
    );
  }, [playFromList, s, c, showBadge, clientMode, mergeLocalAndServer]);

  const handleRenameConfirm = useCallback(async (newFilename: string) => {
    if (!renameTarget) return;
    const target = renameTarget;
    setRenameTarget(null);
    try {
      await renameTrackApi(target.path, newFilename);
    } catch (e: any) {
      Alert.alert('Rename failed', e?.response?.data || e?.message || 'Unknown error');
    }
  }, [renameTarget]);

  return (
    <View style={s.flex}>
      <RenameModal
        initialValue={renameTarget?.filename ?? ''}
        onCancel={() => setRenameTarget(null)}
        onConfirm={handleRenameConfirm}
        title="Rename track"
        visible={renameTarget !== null}
      />
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search tracks…"
        trailing={
          <SortControl
            options={[
              { field: 'artist', label: 'Artist' },
              { field: 'title', label: 'Title' },
              { field: 'album', label: 'Album' },
              { field: 'year', label: 'Year' },
              { field: 'key', label: 'Key' },
              ...(clientMode ? [] : [
                { field: 'bpm', label: 'BPM' },
                { field: 'added', label: 'Added' },
              ]),
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        }
      />
      {reloading && displayTracks.length === 0 && !search
        ? <DownloadingLibrary label="Downloading metadata…" />
        : (
          <>
            <UpdatingBanner visible={reloading && displayTracks.length > 0} />
            <FlatList
              {...LIST_PERF_PROPS}
              data={displayTracks}
              keyExtractor={(item, index) => `${item.path}-${index}`}
              renderItem={renderTrack}
              contentContainerStyle={s.listContent}
              onEndReached={clientMode ? undefined : () => loadPage(false, searchRef.current)}
              onEndReachedThreshold={0.4}
              ListFooterComponent={fetching && !reloading
                ? <ActivityIndicator color={c.accent} style={{ padding: Spacing.md }} />
                : null}
              ListEmptyComponent={
                serverScanning ? <Text style={s.empty}>{REBUILDING_MSG}</Text>
                : !fetching ? <Text style={s.empty}>{search ? 'No tracks match' : 'No tracks in library'}</Text>
                : null}
            />
          </>
        )}
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => {
          const idx = displayRef.current.findIndex((x) => x.path === t.path);
          playFromList(t, idx >= 0 ? idx : 0);
          setActionTrack(null);
        }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
        onRename={!clientMode ? (t) => { setActionTrack(null); setRenameTarget(t); } : undefined}
      />
    </View>
  );
}

// ── Tab: Loved ───────────────────────────────────────────────────────────────

function LovedTab() {
  const { s, c } = useLibStyles();
  const { playQueue, addToQueue, playNext } = usePlayer();
  const { lovedPaths, toggleLove, clearAllLoved } = useLibraryActivityStore();
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);
  const { sortBy, sortDir, onSort } = useSort(null);

  // Fetch only the loved tracks (resolved server-side) rather than the whole 20k+ library.
  // We still filter by the reactive lovedPaths below so unloving updates the list live.
  const { data: allTracks, loading, refreshing } =
    useServerCachedList<MusicTrack>('loved', getLovedTracks, true, seedTrackSignatures);

  const lovedTracks = useMemo(() => {
    const list = allTracks.filter((t) => lovedPaths.has(t.path));
    return sortList(list, sortBy, sortDir, (t, f) =>
      f === 'title' ? getTrackTitle(t) : t[f as keyof MusicTrack]);
  }, [allTracks, lovedPaths, sortBy, sortDir]);

  const handleClearAll = useCallback(() => {
    Alert.alert('Clear all loved tracks?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: () => clearAllLoved() },
    ]);
  }, [clearAllLoved]);

  const renderTrack = useCallback(({ item, index }: { item: MusicTrack; index: number }) => {
    const local = isLocalPath(item.path);
    return (
    <Pressable
      onPress={() => { playQueue(lovedTracks, index); }}
      onLongPress={() => setActionTrack(item)}
      style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
    >
      <ArtworkBox
        path={item.hasArtwork && !local ? item.path : null}
        overrideUrl={local && item.hasArtwork ? item.coverPath : undefined}
        size={42}
      />
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{getTrackTitle(item)}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[item.artist, item.album].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Pressable onPress={() => toggleLove(item.path)} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="heart" size={18} color="#e05a7a" />
      </Pressable>
    </Pressable>
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playQueue, lovedTracks, toggleLove, s, isLocalPath]);

  if (loading) return <DownloadingLibrary label="Downloading metadata…" />;

  if (!lovedTracks.length) {
    return (
      <View style={[s.flex, { justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="heart-outline" size={48} color={c.textDim} />
        <Text style={[s.rowMeta, { marginTop: 12, textAlign: 'center' }]}>
          {'No loved tracks yet.\nLong-press any track to see options.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.flex}>
      <View style={s.sortRow}>
        <SortControl
          options={[
            { field: 'title', label: 'Title' },
            { field: 'artist', label: 'Artist' },
            { field: 'album', label: 'Album' },
          ]}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
        />
      </View>
      <UpdatingBanner visible={refreshing && !loading} />
      <FlatList
        {...LIST_PERF_PROPS}
        data={lovedTracks}
        keyExtractor={(item) => item.path}
        renderItem={renderTrack}
        contentContainerStyle={s.listContent}
        ListHeaderComponent={
          <Pressable onPress={handleClearAll} style={s.clearAllBtn}>
            <Ionicons name="trash-outline" size={15} color={c.textMuted} />
            <Text style={[s.rowMeta, { marginLeft: 6 }]}>Clear all loved</Text>
          </Pressable>
        }
      />
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => { playQueue([t], 0); setActionTrack(null); }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
      />
    </View>
  );
}

// ── Tab: History ─────────────────────────────────────────────────────────────

const recordToTrack = (entry: PlayRecord): MusicTrack => {
  const parts = entry.path.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1] ?? entry.path;
  return {
    path: entry.path,
    filename,
    directory: entry.folder || parts.slice(0, -1).join('/'),
    title: entry.title || filename.replace(/\.[^.]+$/, ''),
    artist: entry.artist || null,
    albumArtist: null,
    album: null,
    year: null,
    trackNumber: null,
    discNumber: null,
    hasArtwork: true,
    coverPath: null,
    genre: null,
    bpm: null,
    key: null,
    fileSize: null,
    duration: null,
  };
};

const folderName = (folder: string): string => {
  if (!folder) return '';
  return folder.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? folder;
};

const formatWhen = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function HistoryTab() {
  const { s, c } = useLibStyles();
  const { playQueue, addToQueue, playNext } = usePlayer();
  const { recentPlays, historyVersion, deletePlay, clearHistory } = useLibraryActivityStore();
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);
  const { sortBy, sortDir, onSort } = useSort('playedAt', 'desc');

  const [restEntries, setRestEntries] = useState<PlayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const restEntriesRef = useRef<PlayRecord[]>([]);

  useEffect(() => { restEntriesRef.current = restEntries; }, [restEntries]);

  // Reload from REST whenever a delete/clear happened (historyVersion bumps)
  const loadRest = useCallback(async (reset: boolean) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const offset = reset ? 0 : restEntriesRef.current.length;
      const data = await getPlayHistory(50, offset);
      setRestEntries((prev) => reset ? data : [...prev, ...data]);
    } catch {}
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadRest(true); }, [historyVersion]);

  // Merge: recentPlays (SignalR) on top, REST below, deduplicated.
  // Sorting only covers loaded entries; older pages stream in as the list is scrolled.
  const entries = useMemo(() => {
    const restIds = new Set(restEntries.map((e) => e.id));
    const fresh = recentPlays.filter((r) => !restIds.has(r.id));
    return sortList([...fresh, ...restEntries], sortBy, sortDir, (e, f) => e[f as keyof PlayRecord]);
  }, [recentPlays, restEntries, sortBy, sortDir]);

  const tracksFromEntries = useMemo(
    () => entries.map(recordToTrack),
    [entries],
  );

  const handleDeletePlay = useCallback((id: string) => {
    // Optimistically remove from local REST list; store handles recentPlays
    setRestEntries((prev) => prev.filter((e) => e.id !== id));
    deletePlay(id);
  }, [deletePlay]);

  const handleClearAll = useCallback(() => {
    Alert.alert('Clear play history?', 'All play history will be deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: () => {
        setRestEntries([]);
        clearHistory();
      }},
    ]);
  }, [clearHistory]);

  const renderEntry = useCallback(({ item, index }: { item: PlayRecord; index: number }) => {
    const track = tracksFromEntries[index];
    return (
      <Pressable
        onPress={() => { playQueue(tracksFromEntries, index); }}
        onLongPress={() => setActionTrack(track)}
        style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
      >
        <ArtworkBox path={track ? getTrackArtworkPath(track) : item.path} size={42} />
        <View style={s.rowInfo}>
          <Text style={s.rowTitle} numberOfLines={1}>{track.title}</Text>
          <Text style={s.rowMeta} numberOfLines={1}>
            {[item.artist, formatWhen(item.playedAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable onPress={() => handleDeletePlay(item.id)} hitSlop={8} style={s.moreBtn}>
          <Ionicons name="close-circle-outline" size={20} color={c.textDim} />
        </Pressable>
      </Pressable>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksFromEntries, playQueue, handleDeletePlay, s]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} color={c.accent} />;

  if (!entries.length) {
    return (
      <View style={[s.flex, { justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="time-outline" size={48} color={c.textDim} />
        <Text style={[s.rowMeta, { marginTop: 12, textAlign: 'center' }]}>
          {'No play history yet.\nStart playing tracks to see them here.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.flex}>
      <View style={s.sortRow}>
        <SortControl
          options={[
            { field: 'playedAt', label: 'Played' },
            { field: 'title', label: 'Title' },
            { field: 'artist', label: 'Artist' },
          ]}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
        />
      </View>
      <FlatList
        {...LIST_PERF_PROPS}
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderEntry}
        contentContainerStyle={s.listContent}
        onEndReached={() => loadRest(false)}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <Pressable onPress={handleClearAll} style={s.clearAllBtn}>
            <Ionicons name="trash-outline" size={15} color={c.textMuted} />
            <Text style={[s.rowMeta, { marginLeft: 6 }]}>Clear all history</Text>
          </Pressable>
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={c.accent} /> : null}
      />
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => { playQueue([t], 0); setActionTrack(null); }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
      />
    </View>
  );
}

// ── Tab: Folders ─────────────────────────────────────────────────────────────

type FolderWithSource = MusicFolder & { _local?: boolean };

function FoldersTab() {
  const { s, c } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const [search, setSearch] = useState('');
  const [actionFolder, setActionFolder] = useState<MusicFolder | null>(null);
  const [renameTarget, setRenameTarget] = useState<MusicFolder | null>(null);
  const { sortBy, sortDir, onSort } = useSort('name');
  const { mixtapes } = useMixtapeStore();
  const { includeLocalLibrary, mergeLocalAndServer } = useLibrarySettings();

  const wantServer = !includeLocalLibrary || mergeLocalAndServer;
  const { data: serverFolders, loading: serverLoading, refreshing } =
    useServerCachedList<FolderWithSource>('folders', getFolders, wantServer, seedCoverSignatures);
  const localFoldersRaw = useLocalList<MusicFolder>(getLocalFolders, includeLocalLibrary);
  const localFolders = useMemo<FolderWithSource[]>(
    () => localFoldersRaw.map((f) => ({ ...f, _local: true })),
    [localFoldersRaw],
  );

  const folders = useMemo<FolderWithSource[]>(() => {
    if (includeLocalLibrary && !mergeLocalAndServer) return localFolders;
    if (includeLocalLibrary && mergeLocalAndServer) return [...serverFolders, ...localFolders];
    return serverFolders;
  }, [serverFolders, localFolders, includeLocalLibrary, mergeLocalAndServer]);

  const loading = wantServer && serverLoading && folders.length === 0;

  const showBadge = includeLocalLibrary && mergeLocalAndServer;

  const filtered = useMemo(() => {
    let list = folders;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
      );
    }
    if (!includeLocalLibrary || mergeLocalAndServer) {
      // Server folders: deduplicate by name (server can return same name from different roots)
      const serverDeduped = new Map<string, FolderWithSource>();
      const localList: FolderWithSource[] = [];
      for (const f of list) {
        if (f._local) { localList.push(f); continue; }
        const existing = serverDeduped.get(f.name);
        if (!existing) { serverDeduped.set(f.name, f); continue; }
        const hasMixtape = mixtapes.some((m) => m.name === f.name);
        if (hasMixtape && !mixtapes.some((m) => m.name === existing.name)) {
          serverDeduped.set(f.name, f);
        } else if (f.trackCount > existing.trackCount) {
          serverDeduped.set(f.name, f);
        }
      }
      list = [...Array.from(serverDeduped.values()), ...localList];
    }
    return sortList(list, sortBy, sortDir, (f, field) => f[field as keyof MusicFolder]);
  }, [folders, mixtapes, search, sortBy, sortDir, includeLocalLibrary, mergeLocalAndServer]);

  const handleRenameConfirm = useCallback(async (newName: string) => {
    if (!renameTarget) return;
    const target = renameTarget;
    setRenameTarget(null);
    try {
      await renameFolderApi(target.path, newName);
    } catch (e: any) {
      Alert.alert('Rename failed', e?.response?.data || e?.message || 'Unknown error');
    }
  }, [renameTarget]);

  const renderItem = useCallback(({ item }: { item: FolderWithSource }) => {
    const mixtape = !item._local ? mixtapes.find((m) => item.name === m.name) : null;
    const artworkOverride = mixtape?.hasArtwork ? getMixtapeArtworkUrl(mixtape.id) : null;
    const artworkOverrideCacheKey = mixtape?.hasArtwork ? `mixtape_${mixtape.id}` : undefined;
    return (
      <Pressable
        onPress={() => navigation.push('FolderDetail', {
          folderPath: item.path,
          folderName: item.name,
          isLocal: item._local,
        })}
        style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      >
        <ArtworkBox
          path={item.hasArtwork ? item.coverPath : null}
          size={48}
          overrideUrl={artworkOverride}
          overrideCacheKey={artworkOverrideCacheKey}
          source={showBadge ? (item._local ? 'local' : 'server') : undefined}
        />
        <View style={s.rowInfo}>
          <Text style={s.rowTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={s.rowMeta} numberOfLines={1}>
            {item.trackCount} track{item.trackCount !== 1 ? 's' : ''}
          </Text>
        </View>
        {!item._local && (
          <Pressable hitSlop={8} onPress={() => setActionFolder(item)} style={s.moreBtn}>
            <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
          </Pressable>
        )}
      </Pressable>
    );
  }, [navigation, s, c, mixtapes, showBadge]);

  return (
    <View style={s.flex}>
      <FolderActionSheet
        folder={actionFolder}
        onClose={() => setActionFolder(null)}
        onRename={(f) => { setActionFolder(null); setRenameTarget(f); }}
      />
      <RenameModal
        initialValue={renameTarget?.name ?? ''}
        onCancel={() => setRenameTarget(null)}
        onConfirm={handleRenameConfirm}
        title="Rename folder"
        visible={renameTarget !== null}
      />
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search folders…"
        trailing={
          <SortControl
            options={[
              { field: 'name', label: 'Name' },
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        }
      />
      <UpdatingBanner visible={refreshing && !loading} />
      {loading
        ? <DownloadingLibrary />
        : (
          <FlatList
            {...LIST_PERF_PROPS}
            data={filtered}
            keyExtractor={(item, index) => `${item.path}-${index}`}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.empty}>{search ? 'No folders match' : 'No folders in library'}</Text>
            }
          />
        )}
    </View>
  );
}

// ── Tab: Genres ───────────────────────────────────────────────────────────────

function GenresTab() {
  const { s, c } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const [search, setSearch] = useState('');
  const { sortBy, sortDir, onSort } = useSort('genre');
  const { includeLocalLibrary, mergeLocalAndServer } = useLibrarySettings();

  // Local tracks have no genre metadata; show server genres in both server-only
  // and merged modes. In local-only mode the list will be empty.
  const wantServer = !includeLocalLibrary || mergeLocalAndServer;
  const { data: genres, loading: serverLoading, refreshing } =
    useServerCachedList<MusicGenre>('genres', getGenres, wantServer);
  const loading = wantServer && serverLoading && genres.length === 0;

  const filtered = useMemo(() => {
    let list = genres;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((g) => g.genre?.toLowerCase().includes(q));
    }
    return sortList(list, sortBy, sortDir, (g, f) => g[f as keyof MusicGenre]);
  }, [genres, search, sortBy, sortDir]);

  const renderItem = useCallback(({ item }: { item: MusicGenre }) => (
    <Pressable
      onPress={() => navigation.push('GenreDetail', { genre: item.genre, trackCount: item.trackCount })}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      <View style={s.artistIcon}>
        <Ionicons name="headset" size={18} color={c.textMuted} />
      </View>
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{item.genre || '(Unknown Genre)'}</Text>
        <Text style={s.rowMeta}>{item.trackCount} track{item.trackCount !== 1 ? 's' : ''}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </Pressable>
  ), [navigation, s, c]);

  return (
    <View style={s.flex}>
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search genres…"
        trailing={
          <SortControl
            options={[
              { field: 'genre', label: 'Name' },
              { field: 'trackCount', label: 'Tracks' },
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        }
      />
      <UpdatingBanner visible={refreshing && !loading} />
      {loading
        ? <DownloadingLibrary />
        : (
          <FlatList
            {...LIST_PERF_PROPS}
            data={filtered}
            keyExtractor={(item) => item.genre}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.empty}>
                {search
                  ? 'No genres match'
                  : includeLocalLibrary && !mergeLocalAndServer
                    ? 'Genre tags are not available for device music'
                    : 'No genres in library'}
              </Text>
            }
          />
        )}
    </View>
  );
}

// ── Tab: Playlists ────────────────────────────────────────────────────────────

const MixtapeThumbLib = React.memo(({ id }: { id: string }) => {
  const { s, c } = useLibStyles();
  const [error, setError] = React.useState(false);
  const url = getMixtapeArtworkUrl(id);
  if (url && !error) {
    return (
      <Image
        onError={() => setError(true)}
        source={{ uri: url, cacheKey: `mixtape_${id}` }}
        style={s.artistIcon}
        cachePolicy="memory-disk"
        recyclingKey={`mixtape_${id}`}
      />
    );
  }
  return (
    <View style={s.artistIcon}>
      <Ionicons name="musical-notes" size={18} color={c.textMuted} />
    </View>
  );
});
MixtapeThumbLib.displayName = 'MixtapeThumbLib';

function PlaylistsTab() {
  const { s, c } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const { mixtapes: playlists, create, remove, rename } = useMixtapeStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const { sortBy, sortDir, onSort } = useSort(null);

  const sorted = useMemo(
    () => sortList(playlists, sortBy, sortDir, (p, f) =>
      f === 'trackCount' ? (p.tracks?.length ?? 0) : p.name),
    [playlists, sortBy, sortDir],
  );

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    await create(name);
    setShowCreate(false);
    setNewName('');
  };

  const handleRename = async () => {
    if (!renameId || !renameName.trim()) return;
    await rename(renameId, renameName.trim());
    setRenameId(null);
    setRenameName('');
  };

  const renderItem = useCallback(({ item }: { item: typeof playlists[number] }) => (
    <Pressable
      onPress={() => navigation.push('PlaylistDetail', { playlistId: item.id })}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      {item.hasArtwork
        ? <MixtapeThumbLib id={item.id} />
        : <View style={s.artistIcon}><Ionicons name="musical-notes" size={18} color={c.textMuted} /></View>
      }
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{item.name}</Text>
        <Text style={s.rowMeta}>{item.tracks?.length ?? 0} track{(item.tracks?.length ?? 0) !== 1 ? 's' : ''}</Text>
      </View>
      <Pressable onPress={() => { setRenameId(item.id); setRenameName(item.name); }} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="pencil-outline" size={15} color={c.textMuted} />
      </Pressable>
      <Pressable onPress={() => remove(item.id)} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="trash-outline" size={16} color={c.textMuted} />
      </Pressable>
    </Pressable>
  ), [navigation, remove, setRenameId, setRenameName, s, c]);

  return (
    <View style={s.flex}>
      {renameId && (
        <View style={s.inlineBar}>
          <TextInput
            autoFocus
            style={s.inlineBarInput}
            value={renameName}
            onChangeText={setRenameName}
            placeholder="New mixtape name…"
            placeholderTextColor={c.textDim}
            returnKeyType="done"
            onSubmitEditing={handleRename}
          />
          <Pressable onPress={handleRename} style={s.inlineBarBtn}>
            <Text style={s.inlineBarBtnText}>Rename</Text>
          </Pressable>
          <Pressable onPress={() => setRenameId(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={c.textMuted} />
          </Pressable>
        </View>
      )}

      {showCreate ? (
        <View style={s.inlineBar}>
          <TextInput
            autoFocus
            style={s.inlineBarInput}
            value={newName}
            onChangeText={setNewName}
            placeholder="Mixtape name…"
            placeholderTextColor={c.textDim}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <Pressable onPress={handleCreate} style={s.inlineBarBtn}>
            <Text style={s.inlineBarBtnText}>Create</Text>
          </Pressable>
          <Pressable onPress={() => { setShowCreate(false); setNewName(''); }} hitSlop={8}>
            <Ionicons name="close" size={18} color={c.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setShowCreate(true)}
          style={({ pressed }) => [s.row, pressed && s.rowPressed]}
        >
          <View style={[s.artistIcon, { backgroundColor: `${c.accent}22` }]}>
            <Ionicons name="add" size={20} color={c.accent} />
          </View>
          <Text style={[s.rowTitle, { color: c.accent }]}>New Mixtape</Text>
        </Pressable>
      )}

      <View style={s.sortRow}>
        <SortControl
          options={[
            { field: 'name', label: 'Name' },
            { field: 'trackCount', label: 'Tracks' },
          ]}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
        />
      </View>
      <FlatList
        {...LIST_PERF_PROPS}
        data={sorted}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          <Text style={s.empty}>{'No mixtapes yet\nTap New Mixtape to get started'}</Text>
        }
      />
    </View>
  );
}

// ── LibraryHome ───────────────────────────────────────────────────────────────

type HomeProps = NativeStackScreenProps<LibraryStackParamList, 'LibraryHome'>;

function LibraryHome({ navigation }: HomeProps) {
  const { s, c } = useLibStyles();
  const { visibleTabs, loaded: settingsLoaded, load: loadSettings } = useLibrarySettings();
  const { load: loadMixtapes } = useMixtapeStore();
  const [tab, setTab] = useState<LibraryTab>('Artists');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const bumpRevisionOnce = useLibraryActivityStore((s) => s.bumpLibraryRevision);
  useEffect(() => {
    setScanProgressCallback(bumpRevisionOnce);
    if (!settingsLoaded) loadSettings();
    loadMixtapes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Download the whole library in one go into the on-device cache (tabs read from cache). Re-runs
  // only when the backend library actually changes (libraryRevision), not on every screen visit.
  const libraryRevision = useLibraryActivityStore((s) => s.libraryRevision);
  const sync = useLibrarySync((s) => s.sync);
  const syncStatus = useLibrarySync((s) => s.status);
  const syncPercent = useLibrarySync((s) => s.percent);
  const syncLabel = useLibrarySync((s) => s.currentLabel);
  const hasSyncedOnce = useLibrarySync((s) => s.hasSyncedOnce);

  // Backend library scan state (server-side BPM/key/metadata indexing). The LibraryActivity hub pushes
  // SYNC_STATE — on connect and on every lifecycle transition — so we read it straight from the store
  // to drive a "scanning" banner. The list keeps rendering cached data underneath; this only surfaces
  // that a server-side (re)scan is in flight.
  const serverScan = useLibraryActivityStore((s) => s.syncState);
  const applyServerSyncState = useLibraryActivityStore((s) => s.applySyncState);
  const serverScanPercent =
    serverScan?.running && serverScan.progress > 0
      ? Math.round(serverScan.progress * 100)
      : null;

  // Sync the on-device cache from the backend when the library changes — BUT hold off while the
  // backend is mid-rescan. During a full rescan the server fires LIBRARY_UPDATED repeatedly, bumping
  // libraryRevision on every batch; re-running the whole 7-list sync each time just thrashes the
  // network and leaves the lists flickering empty ("stuck retrying"). So while serverScan.running we
  // skip syncing entirely (tabs keep showing the last cached data), and once the scan finishes we do
  // one authoritative forced sync to pull the freshly-built DB.
  const serverScanning = serverScan?.running ?? false;
  const wasScanningRef = useRef(false);
  useEffect(() => {
    if (serverScanning) {
      wasScanningRef.current = true;
      dbg('[home] skip cache sync — backend rescan in progress');
      return;
    }
    const justFinished = wasScanningRef.current;
    wasScanningRef.current = false;
    if (justFinished) dbg('[home] backend rescan finished — forcing one cache sync');
    sync(libraryRevision, justFinished);
  }, [sync, libraryRevision, serverScanning]);

  // DEBUG (opt-in via "Library sync debug" setting): heartbeat that detects a frozen JS thread. A 1s
  // timer firing late means the JS engine stalled — either the OS suspended a backgrounded app, or
  // something blocked the thread (e.g. a slow sort). The reported gap tells us how long and when.
  useEffect(() => {
    if (!isSyncDebugOn()) return;
    let last = Date.now();
    dbg(`[hb] start t=${last}`);
    const id = setInterval(() => {
      const now = Date.now();
      const gap = now - last;
      if (gap > 2500) dbg(`[hb] JS stalled ${gap}ms (resumed t=${now})`);
      last = now;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The cached metadata persists across app restarts (SQLite). If it's already there, never block
  // with the full-screen overlay — render tabs instantly from cache and let the (incremental, mostly
  // 304) re-sync run quietly. The overlay is only for the genuine first populate.
  const [cachePresent, setCachePresent] = useState<boolean | null>(null);
  useEffect(() => {
    const t0 = Date.now();
    hasListCache('artists')
      .then((p) => { setCachePresent(p); dbg(`[home] hasCache=${p} in ${Date.now() - t0}ms`); })
      .catch(() => setCachePresent(false));
  }, []);
  // Only block with the overlay when the cache is CONFIRMED absent (genuine first install). While
  // cachePresent is still null (checking) we must NOT show it: the cached library renders in a few
  // ms, and if the app is backgrounded during that check the overlay would otherwise freeze
  // on-screen until the app resumes — hiding a library that was actually ready instantly.
  const showFirstSync = syncStatus === 'syncing' && !hasSyncedOnce && cachePresent === false;
  useEffect(() => {
    dbg(`[home] render showFirstSync=${showFirstSync} (status=${syncStatus} hasSynced=${hasSyncedOnce} cachePresent=${cachePresent})`);
  }, [showFirstSync, syncStatus, hasSyncedOnce, cachePresent]);

  useEffect(() => {
    if (settingsLoaded && !visibleTabs.includes(tab)) {
      setTab(visibleTabs[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabs, settingsLoaded]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setSettingsOpen(true)} style={{ marginRight: Spacing.md }}>
          <Ionicons name="options-outline" size={22} color={c.textPrimary} />
        </Pressable>
      ),
    });
  }, [navigation, c]);

  if (showFirstSync) {
    return (
      <View style={s.flex}>
        <DownloadingLibrary percent={syncPercent} detail={syncLabel || undefined} />
      </View>
    );
  }

  // Background (refresh) sync feedback: a thin top progress line that overlays the very top edge
  // without shifting layout. The full % lives in the first-install overlay; here it's just a subtle
  // "library is updating" hint, shown only while an actual sync is running.
  const showSyncBar = syncStatus === 'syncing' && !showFirstSync;

  return (
    <View style={s.flex}>
      <TabBar tabs={visibleTabs} active={tab} onSelect={(t) => setTab(t as LibraryTab)} />
      {serverScan?.running && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          gap: 8, paddingVertical: 5, backgroundColor: c.bgElevated,
        }}>
          <ActivityIndicator size="small" color={c.accent} />
          <Text style={{ color: c.textMuted, fontSize: 12 }}>
            Scanning music library
            {serverScanPercent === null ? '…' : ` — ${serverScanPercent}%`}
          </Text>
          <Pressable
            onPress={() => {
              cancelSync().catch(() => {});
              // optimistic: hide the banner now; the hub will push the confirmed running=false state
              if (serverScan) applyServerSyncState({ ...serverScan, running: false });
            }}
            hitSlop={8}
          >
            <Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>Stop</Text>
          </Pressable>
        </View>
      )}
      {showSyncBar && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: c.bgElevated, zIndex: 10 }}
        >
          <View style={{ width: `${syncPercent}%`, height: '100%', backgroundColor: c.accent }} />
        </View>
      )}
      <SourcePicker />
      {tab === 'Artists'   && <ArtistsTab />}
      {tab === 'Albums'    && <AlbumsTab />}
      {tab === 'Tracks'    && <TracksTab />}
      {tab === 'Loved'     && <LovedTab />}
      {tab === 'History'   && <HistoryTab />}
      {tab === 'Folders'   && <FoldersTab />}
      {tab === 'Genres'    && <GenresTab />}
      {tab === 'Years'     && <YearsTab />}
      {tab === 'Mixtapes'  && <PlaylistsTab />}
      <LibrarySettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

// ── ArtistDetail ──────────────────────────────────────────────────────────────

type ArtistProps = NativeStackScreenProps<LibraryStackParamList, 'Artist'>;

function ArtistDetail({ route }: ArtistProps) {
  const { s, c } = useLibStyles();
  const { artistName } = route.params;
  const { playQueue, addToQueue, playNext } = usePlayer();
  const navigation = useNavigation<LibraryNav>();
  const [albums, setAlbums] = useState<MusicAlbum[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);
  const [renameTarget, setRenameTarget] = useState<MusicTrack | null>(null);

  useEffect(() => {
    getAlbums(artistName).then((d) => setAlbums(d ?? [])).catch(() => {});
  }, [artistName]);

  const fetchingRef  = useRef(false);
  const tracksRef    = useRef<MusicTrack[]>([]);
  const totalRef     = useRef(0);
  const searchRef    = useRef('');
  const artistRef    = useRef(artistName);
  const scanning     = useServerScanning();
  const scanningRef  = useRef(scanning);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { totalRef.current = total; }, [total]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { scanningRef.current = scanning; }, [scanning]);

  const loadPage = useCallback(async (reset: boolean, query: string) => {
    if (scanningRef.current) return; // backend is rebuilding the DB — don't fetch into a hang
    if (fetchingRef.current) return;
    const offset = reset ? 0 : tracksRef.current.length;
    if (!reset && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    try {
      const result = await getTracks({ artist: artistRef.current, search: query, limit: TRACKS_PER_PAGE, offset });
      setTracks((prev) => reset ? result.tracks : [...prev, ...result.tracks]);
      setTotal(result.total);
      totalRef.current = result.total;
    } catch {}
    finally { fetchingRef.current = false; setFetching(false); }
  }, []);

  useEffect(() => {
    if (scanning) return;
    const t = setTimeout(() => loadPage(true, search), search ? 300 : 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, scanning]);

  const fetchAllTracks = useCallback(async (opts?: QueueFetch): Promise<MusicTrack[]> => {
    if (!opts?.random && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return tracksRef.current;
    try {
      const result = await getTracks({
        artist: artistRef.current, search: searchRef.current, ...queueWindow(opts),
      });
      return result.tracks;
    } catch { return tracksRef.current; }
  }, []);

  const handlePlayAll = useCallback(async () => {
    const all = await fetchAllTracks();
    if (!all.length) return;
    playQueue(all, 0);
  }, [fetchAllTracks, playQueue]);

  const handleShuffle = useCallback(async () => {
    // Ask the DB for the random sample; the local shuffle then just orders that window
    // (and still applies if the backend is too old to know the `random` sort).
    const all = await fetchAllTracks({ random: true });
    if (!all.length) return;
    playQueue([...all].sort(() => Math.random() - 0.5), 0);
  }, [fetchAllTracks, playQueue]);

  const renderTrack = useCallback(({ item, index }: { item: MusicTrack; index: number }) => (
    <Pressable
      onPress={() => {
        fetchAllTracks({ index }).then((all) => {
          const list = all.length ? all : tracksRef.current;
          const i = list.findIndex((x) => x.path === item.path);
          playQueue(list, i >= 0 ? i : Math.max(0, index - queueWindow({ index }).offset));
        });
      }}
      style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
    >
      <ArtworkBox path={getTrackArtworkPath(item)} size={42} />
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{getTrackTitle(item)}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[item.album].filter(Boolean).join('')}
        </Text>
      </View>
      <TrackMetaRight item={item} />
      <Pressable onPress={() => setActionTrack(item)} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
      </Pressable>
    </Pressable>
  ), [fetchAllTracks, playQueue, s, c]);

  return (
    <View style={s.flex}>
      <View style={s.detailHeaderActions}>
        <Pressable onPress={handlePlayAll} style={[s.actionBtn, s.actionBtnPrimary]}>
          <Ionicons name="play" size={14} color="#fff" />
          <Text style={s.actionBtnText}>Play All</Text>
        </Pressable>
        <Pressable onPress={handleShuffle} style={s.actionBtn}>
          <Ionicons name="shuffle" size={14} color={c.textPrimary} />
          <Text style={[s.actionBtnText, { color: c.textPrimary }]}>Shuffle</Text>
        </Pressable>
        {total > 0 && <Text style={s.detailTotal}>{total} tracks</Text>}
      </View>
      <SearchBar value={search} onChange={setSearch} placeholder="Search tracks…" />
      <FlatList
        {...LIST_PERF_PROPS}
        data={tracks}
        keyExtractor={(item, index) => `${item.path}-${index}`}
        renderItem={renderTrack}
        contentContainerStyle={s.listContent}
        onEndReached={() => loadPage(false, searchRef.current)}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={albums.length > 0 ? (
          <>
            {albums.map((al) => (
              <Pressable
                key={`${al.album}-${al.artist}`}
                onPress={() => navigation.push('Album', { album: al })}
                style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              >
                <ArtworkBox path={al.hasArtwork ? al.coverPath : null} size={48} />
                <View style={s.rowInfo}>
                  <Text style={s.rowTitle} numberOfLines={1}>{al.album || '(Untitled)'}</Text>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {[al.year?.toString(), `${al.trackCount} tracks`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
              </Pressable>
            ))}
            <View style={[s.sheetDivider, { marginVertical: Spacing.sm }]} />
          </>
        ) : null}
        ListFooterComponent={fetching && !scanning
          ? <ActivityIndicator color={c.accent} style={{ padding: Spacing.md }} />
          : null}
        ListEmptyComponent={
          scanning ? <Text style={s.empty}>{REBUILDING_MSG}</Text>
          : !fetching ? <Text style={s.empty}>No tracks found</Text>
          : null}
      />
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => {
          fetchAllTracks().then((all) => {
            const list = all.length ? all : tracksRef.current;
            const idx = list.findIndex((x) => x.path === t.path);
            // Action sheets carry no row index, so the queue window may not contain this
            // track. Play it on its own rather than starting the queue at the wrong row.
            if (idx >= 0) playQueue(list, idx); else playQueue([t], 0);
          });
          setActionTrack(null);
        }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
        onRename={(t) => { setActionTrack(null); setRenameTarget(t); }}
      />
      <RenameModal
        initialValue={renameTarget?.filename ?? ''}
        onCancel={() => setRenameTarget(null)}
        onConfirm={async (newFilename) => {
          if (!renameTarget) return;
          const target = renameTarget;
          setRenameTarget(null);
          try { await renameTrackApi(target.path, newFilename); }
          catch (e: any) { Alert.alert('Rename failed', e?.response?.data || e?.message || 'Unknown error'); }
        }}
        title="Rename track"
        visible={renameTarget !== null}
      />
    </View>
  );
}

// ── AlbumDetail ───────────────────────────────────────────────────────────────

type AlbumProps = NativeStackScreenProps<LibraryStackParamList, 'Album'>;

function AlbumDetail({ route }: AlbumProps) {
  const { s, c } = useLibStyles();
  const { album, localAlbumTitle } = route.params;
  const { playQueue, addToQueue, playNext } = usePlayer();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);
  const [renameTarget, setRenameTarget] = useState<MusicTrack | null>(null);
  const tracksRef = useRef<MusicTrack[]>([]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  useEffect(() => {
    if (localAlbumTitle) {
      getLocalAlbumTracks(localAlbumTitle)
        .then(setTracks)
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }
    // Scope by folder when the grouped album carries its source directory — for Various-Artists
    // albums `artist` is the literal "Various Artists" and matches no track. Falls back to artist
    // only when directory is absent. Mirrors albumTrackParams() on the web.
    getTracks({
      album: album.album,
      ...(album.directory ? { folder: album.directory } : { artist: album.artist }),
      limit: 500,
    })
      .then((result) => {
        const sorted = [...(result.tracks ?? [])].sort((a, b) => {
          if ((a.discNumber ?? 1) !== (b.discNumber ?? 1))
            return (a.discNumber ?? 1) - (b.discNumber ?? 1);
          return (a.trackNumber ?? 999) - (b.trackNumber ?? 999);
        });
        setTracks(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [album.album, album.artist, album.directory, localAlbumTitle]);

  // Album tracks are all loaded up front (limit 500), so the full list already lives in tracksRef.
  // Kept for parity with the paginated detail views so the shared play handlers can await it.
  const fetchAllTracks = useCallback(async (): Promise<MusicTrack[]> => tracksRef.current, []);

  const handlePlayAll = useCallback(() => {
    if (!tracksRef.current.length) return;
    playQueue(tracksRef.current, 0);
  }, [playQueue]);

  const handleShuffle = useCallback(() => {
    if (!tracksRef.current.length) return;
    playQueue([...tracksRef.current].sort(() => Math.random() - 0.5), 0);
  }, [playQueue]);

  const artworkUrl      = album.coverPath ? getArtworkUrl(album.coverPath, PLAYER_ART_SIZE) : null;
  const artworkCacheKey = album.coverPath ? getArtworkCacheKey(album.coverPath, PLAYER_ART_SIZE) : undefined;

  const renderTrack = useCallback(({ item, index }: { item: MusicTrack; index: number }) => (
    <Pressable
      onPress={() => { playQueue(tracksRef.current, index); }}
      style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
    >
      <Text style={s.trackNum}>{item.trackNumber ?? index + 1}</Text>
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{getTrackTitle(item)}</Text>
        {item.artist && item.artist !== album.artist && (
          <Text style={s.rowMeta} numberOfLines={1}>{item.artist}</Text>
        )}
      </View>
      <TrackMetaRight item={item} />
      <Pressable onPress={() => setActionTrack(item)} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
      </Pressable>
    </Pressable>
  ), [album.artist, playQueue, s, c]);

  return (
    <View style={s.flex}>
      <FlatList
        {...LIST_PERF_PROPS}
        data={tracks}
        keyExtractor={(item, index) => `${item.path}-${index}`}
        renderItem={renderTrack}
        contentContainerStyle={s.listContent}
        ListHeaderComponent={
          <View style={s.albumHeader}>
            {artworkUrl
              ? <Image cachePolicy="memory-disk" source={{ uri: artworkUrl, cacheKey: artworkCacheKey }} style={s.albumArt} />
              : <View style={[s.albumArt, s.artworkPlaceholder]}>
                  <Ionicons name="musical-notes" size={56} color={c.textDim} />
                </View>
            }
            <Text style={s.albumTitle}>{album.album || '(Untitled)'}</Text>
            <Text style={s.albumArtist}>{album.artist}</Text>
            {album.year && <Text style={s.albumMeta}>{album.year}</Text>}
            <Text style={s.albumMeta}>{album.trackCount} tracks</Text>
            <View style={s.albumActions}>
              <Pressable
                disabled={loading || !tracks.length}
                onPress={handlePlayAll}
                style={[s.actionBtn, s.actionBtnPrimary]}
              >
                <Ionicons name="play" size={15} color="#fff" />
                <Text style={s.actionBtnText}>Play</Text>
              </Pressable>
              <Pressable
                disabled={loading || !tracks.length}
                onPress={handleShuffle}
                style={s.actionBtn}
              >
                <Ionicons name="shuffle" size={15} color={c.textPrimary} />
                <Text style={[s.actionBtnText, { color: c.textPrimary }]}>Shuffle</Text>
              </Pressable>
            </View>
            {loading && <ActivityIndicator color={c.accent} style={{ marginTop: Spacing.md }} />}
          </View>
        }
        ListEmptyComponent={!loading ? <Text style={s.empty}>No tracks found</Text> : null}
      />
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => {
          fetchAllTracks().then((all) => {
            const list = all.length ? all : tracksRef.current;
            const idx = list.findIndex((x) => x.path === t.path);
            // Action sheets carry no row index, so the queue window may not contain this
            // track. Play it on its own rather than starting the queue at the wrong row.
            if (idx >= 0) playQueue(list, idx); else playQueue([t], 0);
          });
          setActionTrack(null);
        }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
        onRename={(t) => { setActionTrack(null); setRenameTarget(t); }}
      />
      <RenameModal
        initialValue={renameTarget?.filename ?? ''}
        onCancel={() => setRenameTarget(null)}
        onConfirm={async (newFilename) => {
          if (!renameTarget) return;
          const target = renameTarget;
          setRenameTarget(null);
          try { await renameTrackApi(target.path, newFilename); }
          catch (e: any) { Alert.alert('Rename failed', e?.response?.data || e?.message || 'Unknown error'); }
        }}
        title="Rename track"
        visible={renameTarget !== null}
      />
    </View>
  );
}

// ── GenreDetail ───────────────────────────────────────────────────────────────

type GenreDetailProps = NativeStackScreenProps<LibraryStackParamList, 'GenreDetail'>;

function GenreDetail({ route }: GenreDetailProps) {
  const { s, c } = useLibStyles();
  const { genre } = route.params;
  const { playQueue, addToQueue, playNext } = usePlayer();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);

  const fetchingRef = useRef(false);
  const tracksRef   = useRef<MusicTrack[]>([]);
  const totalRef    = useRef(0);
  const searchRef   = useRef('');
  const genreRef    = useRef(genre);
  const scanning    = useServerScanning();
  const scanningRef = useRef(scanning);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { totalRef.current = total; }, [total]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { scanningRef.current = scanning; }, [scanning]);

  const loadPage = useCallback(async (reset: boolean, query: string) => {
    if (scanningRef.current) return; // backend is rebuilding the DB — don't fetch into a hang
    if (fetchingRef.current) return;
    const offset = reset ? 0 : tracksRef.current.length;
    if (!reset && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    try {
      const result = await getTracks({ genre: genreRef.current, search: query, limit: TRACKS_PER_PAGE, offset });
      setTracks((prev) => reset ? result.tracks : [...prev, ...result.tracks]);
      setTotal(result.total);
      totalRef.current = result.total;
    } catch {}
    finally { fetchingRef.current = false; setFetching(false); }
  }, []);

  useEffect(() => {
    if (scanning) return;
    const t = setTimeout(() => loadPage(true, search), search ? 300 : 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, scanning]);

  const fetchAllTracks = useCallback(async (opts?: QueueFetch): Promise<MusicTrack[]> => {
    if (!opts?.random && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return tracksRef.current;
    try {
      const result = await getTracks({ genre: genreRef.current, search: searchRef.current, ...queueWindow(opts) });
      return result.tracks;
    } catch { return tracksRef.current; }
  }, []);

  const handlePlayAll = useCallback(async () => {
    const all = await fetchAllTracks();
    if (!all.length) return;
    playQueue(all, 0);
  }, [fetchAllTracks, playQueue]);

  const handleShuffle = useCallback(async () => {
    // Ask the DB for the random sample; the local shuffle then just orders that window
    // (and still applies if the backend is too old to know the `random` sort).
    const all = await fetchAllTracks({ random: true });
    if (!all.length) return;
    playQueue([...all].sort(() => Math.random() - 0.5), 0);
  }, [fetchAllTracks, playQueue]);

  const renderTrack = useCallback(({ item, index }: { item: MusicTrack; index: number }) => (
    <Pressable
      onPress={() => {
        fetchAllTracks({ index }).then((all) => {
          const list = all.length ? all : tracksRef.current;
          const i = list.findIndex((x) => x.path === item.path);
          playQueue(list, i >= 0 ? i : Math.max(0, index - queueWindow({ index }).offset));
        });
      }}
      style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
    >
      <ArtworkBox path={getTrackArtworkPath(item)} size={42} />
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{getTrackTitle(item)}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[item.artist, item.album].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <TrackMetaRight item={item} />
      <Pressable onPress={() => setActionTrack(item)} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
      </Pressable>
    </Pressable>
  ), [fetchAllTracks, playQueue, s, c]);

  return (
    <View style={s.flex}>
      <View style={s.detailHeaderActions}>
        <Pressable
          onPress={handlePlayAll}
          style={[s.actionBtn, s.actionBtnPrimary]}
        >
          <Ionicons name="play" size={14} color="#fff" />
          <Text style={s.actionBtnText}>Play All</Text>
        </Pressable>
        <Pressable
          onPress={handleShuffle}
          style={s.actionBtn}
        >
          <Ionicons name="shuffle" size={14} color={c.textPrimary} />
          <Text style={[s.actionBtnText, { color: c.textPrimary }]}>Shuffle</Text>
        </Pressable>
        {total > 0 && <Text style={s.detailTotal}>{total} tracks</Text>}
      </View>
      <SearchBar value={search} onChange={setSearch} placeholder="Search in genre…" />
      <FlatList
        {...LIST_PERF_PROPS}
        data={tracks}
        keyExtractor={(item, index) => `${item.path}-${index}`}
        renderItem={renderTrack}
        contentContainerStyle={s.listContent}
        onEndReached={() => loadPage(false, searchRef.current)}
        onEndReachedThreshold={0.4}
        ListFooterComponent={fetching && !scanning
          ? <ActivityIndicator color={c.accent} style={{ padding: Spacing.md }} />
          : null}
        ListEmptyComponent={
          scanning ? <Text style={s.empty}>{REBUILDING_MSG}</Text>
          : !fetching ? <Text style={s.empty}>No tracks found</Text>
          : null}
      />
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => {
          fetchAllTracks().then((all) => {
            const list = all.length ? all : tracksRef.current;
            const idx = list.findIndex((x) => x.path === t.path);
            // Action sheets carry no row index, so the queue window may not contain this
            // track. Play it on its own rather than starting the queue at the wrong row.
            if (idx >= 0) playQueue(list, idx); else playQueue([t], 0);
          });
          setActionTrack(null);
        }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
      />
    </View>
  );
}

// ── YearsTab ──────────────────────────────────────────────────────────────────

function YearsTab() {
  const { s, c } = useLibStyles();
  const navigation = useNavigation<LibraryNav>();
  const { sortBy, sortDir, onSort } = useSort('year', 'desc');
  const { includeLocalLibrary, mergeLocalAndServer } = useLibrarySettings();

  // Local tracks have no year metadata; show server years in both server-only
  // and merged modes. In local-only mode the list will be empty.
  const wantServer = !includeLocalLibrary || mergeLocalAndServer;
  const { data: years, loading: serverLoading, refreshing } =
    useServerCachedList<MusicYear>('years', getYears, wantServer);
  const loading = wantServer && serverLoading && years.length === 0;

  const sorted = useMemo(
    () => sortList(years, sortBy, sortDir, (y, f) => y[f as keyof MusicYear]),
    [years, sortBy, sortDir],
  );

  const renderItem = useCallback(({ item }: { item: MusicYear }) => (
    <Pressable
      onPress={() => navigation.push('YearDetail', { year: item.year, trackCount: item.trackCount })}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      <View style={s.artistIcon}>
        <Ionicons name="calendar-outline" size={18} color={c.textMuted} />
      </View>
      <View style={s.rowInfo}>
        <Text style={s.rowTitle}>{item.year}</Text>
        <Text style={s.rowMeta}>
          {item.trackCount} track{item.trackCount !== 1 ? 's' : ''}
          {item.albumCount > 0 ? ` · ${item.albumCount} album${item.albumCount !== 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </Pressable>
  ), [navigation, s, c]);

  return (
    <View style={s.flex}>
      <View style={s.sortRow}>
        <SortControl
          options={[
            { field: 'year', label: 'Year' },
            { field: 'trackCount', label: 'Tracks' },
            { field: 'albumCount', label: 'Albums' },
          ]}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
        />
      </View>
      <UpdatingBanner visible={refreshing && !loading} />
      {loading
        ? <DownloadingLibrary />
        : (
          <FlatList
            {...LIST_PERF_PROPS}
            data={sorted}
            keyExtractor={(item) => String(item.year)}
            renderItem={renderItem}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.empty}>
                {includeLocalLibrary && !mergeLocalAndServer
                  ? 'Year tags are not available for device music'
                  : 'No years in library'}
              </Text>
            }
          />
        )}
    </View>
  );
}

// ── YearDetail ────────────────────────────────────────────────────────────────

type YearDetailProps = NativeStackScreenProps<LibraryStackParamList, 'YearDetail'>;

function YearDetail({ route }: YearDetailProps) {
  const { s, c } = useLibStyles();
  const { year } = route.params;
  const { playQueue, addToQueue, playNext } = usePlayer();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);

  const fetchingRef = useRef(false);
  const tracksRef   = useRef<MusicTrack[]>([]);
  const totalRef    = useRef(0);
  const scanning    = useServerScanning();
  const scanningRef = useRef(scanning);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { totalRef.current = total; }, [total]);
  useEffect(() => { scanningRef.current = scanning; }, [scanning]);

  const loadPage = useCallback(async (reset: boolean) => {
    if (scanningRef.current) return; // backend is rebuilding the DB — don't fetch into a hang
    if (fetchingRef.current) return;
    const offset = reset ? 0 : tracksRef.current.length;
    if (!reset && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    try {
      const result = await getTracks({ year, limit: TRACKS_PER_PAGE, offset });
      setTracks((prev) => reset ? result.tracks : [...prev, ...result.tracks]);
      setTotal(result.total);
      totalRef.current = result.total;
    } catch {}
    finally { fetchingRef.current = false; setFetching(false); }
  }, [year]);

  useEffect(() => { if (!scanning) loadPage(true); }, [loadPage, scanning]);

  const fetchAllTracks = useCallback(async (opts?: QueueFetch): Promise<MusicTrack[]> => {
    if (!opts?.random && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return tracksRef.current;
    try {
      const result = await getTracks({ year, ...queueWindow(opts) });
      return result.tracks;
    } catch { return tracksRef.current; }
  }, [year]);

  const handlePlayAll = useCallback(async () => {
    const all = await fetchAllTracks();
    if (!all.length) return;
    playQueue(all, 0);
  }, [fetchAllTracks, playQueue]);

  const handleShuffle = useCallback(async () => {
    // Ask the DB for the random sample; the local shuffle then just orders that window
    // (and still applies if the backend is too old to know the `random` sort).
    const all = await fetchAllTracks({ random: true });
    if (!all.length) return;
    playQueue([...all].sort(() => Math.random() - 0.5), 0);
  }, [fetchAllTracks, playQueue]);

  const renderTrack = useCallback(({ item, index }: { item: MusicTrack; index: number }) => (
    <Pressable
      onPress={() => {
        fetchAllTracks({ index }).then((all) => {
          const list = all.length ? all : tracksRef.current;
          const i = list.findIndex((x) => x.path === item.path);
          playQueue(list, i >= 0 ? i : Math.max(0, index - queueWindow({ index }).offset));
        });
      }}
      style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
    >
      <ArtworkBox path={getTrackArtworkPath(item)} size={42} />
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{getTrackTitle(item)}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[item.artist, item.album].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <TrackMetaRight item={item} />
      <Pressable onPress={() => setActionTrack(item)} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
      </Pressable>
    </Pressable>
  ), [fetchAllTracks, playQueue, s, c]);

  return (
    <View style={s.flex}>
      <View style={s.detailHeaderActions}>
        <Pressable onPress={handlePlayAll} style={[s.actionBtn, s.actionBtnPrimary]}>
          <Ionicons name="play" size={14} color="#fff" />
          <Text style={s.actionBtnText}>Play All</Text>
        </Pressable>
        <Pressable onPress={handleShuffle} style={s.actionBtn}>
          <Ionicons name="shuffle" size={14} color={c.textPrimary} />
          <Text style={[s.actionBtnText, { color: c.textPrimary }]}>Shuffle</Text>
        </Pressable>
        {total > 0 && <Text style={s.detailTotal}>{total} tracks</Text>}
      </View>
      <FlatList
        {...LIST_PERF_PROPS}
        data={tracks}
        keyExtractor={(item, index) => `${item.path}-${index}`}
        renderItem={renderTrack}
        contentContainerStyle={s.listContent}
        onEndReached={() => loadPage(false)}
        onEndReachedThreshold={0.3}
        ListFooterComponent={fetching ? <ActivityIndicator color={c.accent} style={{ padding: Spacing.md }} /> : null}
        ListEmptyComponent={!fetching ? <Text style={s.empty}>No tracks found</Text> : null}
      />
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => {
          fetchAllTracks().then((all) => {
            const list = all.length ? all : tracksRef.current;
            const idx = list.findIndex((x) => x.path === t.path);
            // Action sheets carry no row index, so the queue window may not contain this
            // track. Play it on its own rather than starting the queue at the wrong row.
            if (idx >= 0) playQueue(list, idx); else playQueue([t], 0);
          });
          setActionTrack(null);
        }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
      />
    </View>
  );
}

// ── FolderDetail ──────────────────────────────────────────────────────────────

type FolderDetailProps = NativeStackScreenProps<LibraryStackParamList, 'FolderDetail'>;

function FolderDetail({ route }: FolderDetailProps) {
  const { s, c } = useLibStyles();
  const { folderPath, folderName, isLocal } = route.params;
  const { playQueue, addToQueue, playNext } = usePlayer();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);
  const [renameTrackTarget, setRenameTrackTarget] = useState<MusicTrack | null>(null);
  const [folderActionOpen, setFolderActionOpen] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  // '' = "Track order": the server's natural order (album → disc → track number), i.e. the folder's
  // real running order, and the default. It's falsy, so every `sortBy ? …` check below treats it as
  // "no sort" (server default / no client re-sort). Picking a field re-sorts (server-side for the
  // shared library, client-side for on-device folders); the user can tap "Track order" to go back.
  const { sortBy, sortDir, onSort } = useSort('');

  const fetchingRef  = useRef(false);
  const tracksRef    = useRef<MusicTrack[]>([]);
  const totalRef     = useRef(0);
  const searchRef    = useRef('');
  const folderRef    = useRef(folderPath);
  const scanning     = useServerScanning();
  const scanningRef  = useRef(scanning);
  const sortRef      = useRef<{ sortBy: string | null; sortDir: SortDir }>({ sortBy: null, sortDir: 'asc' });
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { totalRef.current = total; }, [total]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { scanningRef.current = scanning; }, [scanning]);
  useEffect(() => { sortRef.current = { sortBy, sortDir }; }, [sortBy, sortDir]);

  // Local folder: load all tracks from device storage, then filter client-side
  const [allLocalTracks, setAllLocalTracks] = useState<MusicTrack[]>([]);
  useEffect(() => {
    if (!isLocal) return;
    setFetching(true);
    getLocalFolderTracks(folderPath)
      .then((t) => { setAllLocalTracks(t); setTotal(t.length); totalRef.current = t.length; })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [isLocal, folderPath]);

  const localFiltered = useMemo(() => {
    if (!isLocal) return [];
    let list = allLocalTracks;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        getTrackTitle(t).toLowerCase().includes(q) ||
        t.artist?.toLowerCase().includes(q) ||
        t.album?.toLowerCase().includes(q),
      );
    }
    return sortList(list, sortBy, sortDir, (t, f) =>
      f === 'title' ? getTrackTitle(t) : t[f as keyof MusicTrack]);
  }, [isLocal, allLocalTracks, search, sortBy, sortDir]);

  // Server folder: paginated
  const loadPage = useCallback(async (reset: boolean, query: string) => {
    if (isLocal) return;
    if (scanningRef.current) return; // backend is rebuilding the DB — don't fetch into a hang
    if (fetchingRef.current) return;
    const offset = reset ? 0 : tracksRef.current.length;
    if (!reset && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    try {
      const sort = sortRef.current;
      const result = await getTracks({
        folder: folderRef.current, search: query, limit: TRACKS_PER_PAGE, offset,
        ...(sort.sortBy ? { sort: sort.sortBy, descending: String(sort.sortDir === 'desc') } : {}),
      });
      setTracks((prev) => reset ? result.tracks : [...prev, ...result.tracks]);
      setTotal(result.total);
      totalRef.current = result.total;
    } catch {}
    finally { fetchingRef.current = false; setFetching(false); }
  }, [isLocal]);

  // Load on mount, on search/sort change, and once a backend rescan finishes (scanning → false).
  useEffect(() => {
    if (isLocal || scanning) return;
    const t = setTimeout(() => loadPage(true, search), search ? 300 : 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, isLocal, scanning, sortBy, sortDir]);

  const fetchAllTracks = useCallback(async (opts?: QueueFetch): Promise<MusicTrack[]> => {
    const sort = sortRef.current;
    if (isLocal) {
      return sortList(allLocalTracks, sort.sortBy, sort.sortDir, (t, f) =>
        f === 'title' ? getTrackTitle(t) : t[f as keyof MusicTrack]);
    }
    if (!opts?.random && totalRef.current > 0 && tracksRef.current.length >= totalRef.current) return tracksRef.current;
    try {
      const result = await getTracks({
        folder: folderRef.current, search: searchRef.current,
        // A chosen sort still applies to Play All / tapping a row; only shuffle overrides it.
        ...(sort.sortBy ? { sort: sort.sortBy, descending: String(sort.sortDir === 'desc') } : {}),
        ...queueWindow(opts),
      });
      return result.tracks;
    } catch { return tracksRef.current; }
  }, [isLocal, allLocalTracks]);

  const handlePlayAll = useCallback(async () => {
    const all = await fetchAllTracks();
    if (!all.length) return;
    playQueue(all, 0);
  }, [fetchAllTracks, playQueue]);

  const handleShuffle = useCallback(async () => {
    // Ask the DB for the random sample; the local shuffle then just orders that window
    // (and still applies if the backend is too old to know the `random` sort).
    const all = await fetchAllTracks({ random: true });
    if (!all.length) return;
    playQueue([...all].sort(() => Math.random() - 0.5), 0);
  }, [fetchAllTracks, playQueue]);

  // Queue a window of the folder around the tapped track — not the whole folder, which for
  // the big ones is tens of thousands of rows and hangs the JS thread before playback starts.
  const playFromList = useCallback(async (tapped: MusicTrack, fallbackIndex: number) => {
    const all = await fetchAllTracks({ index: fallbackIndex });
    const list = all.length ? all : displayRef.current;
    const idx = list.findIndex((x) => x.path === tapped.path);
    playQueue(list, idx >= 0 ? idx : Math.max(0, fallbackIndex - queueWindow({ index: fallbackIndex }).offset));
  }, [fetchAllTracks, playQueue]);

  const displayTracks = isLocal ? localFiltered : tracks;
  const displayRef = useRef<MusicTrack[]>([]);
  useEffect(() => { displayRef.current = displayTracks; }, [displayTracks]);

  const renderTrack = useCallback(({ item, index }: { item: MusicTrack; index: number }) => (
    <Pressable
      onPress={() => { playFromList(item, index); }}
      style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
    >
      <ArtworkBox
        path={item.hasArtwork && !isLocal ? item.path : null}
        overrideUrl={isLocal && item.hasArtwork ? item.coverPath : undefined}
        size={42}
      />
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{getTrackTitle(item)}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {[item.artist, item.album].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <TrackMetaRight item={item} />
      <Pressable onPress={() => setActionTrack(item)} hitSlop={8} style={s.moreBtn}>
        <Ionicons name="ellipsis-horizontal" size={18} color={c.textMuted} />
      </Pressable>
    </Pressable>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [playFromList, s, c]);

  return (
    <View style={s.flex}>
      <View style={s.detailHeaderActions}>
        <Pressable
          onPress={handlePlayAll}
          style={[s.actionBtn, s.actionBtnPrimary]}
        >
          <Ionicons name="play" size={14} color="#fff" />
          <Text style={s.actionBtnText}>Play All</Text>
        </Pressable>
        <Pressable
          onPress={handleShuffle}
          style={s.actionBtn}
        >
          <Ionicons name="shuffle" size={14} color={c.textPrimary} />
          <Text style={[s.actionBtnText, { color: c.textPrimary }]}>Shuffle</Text>
        </Pressable>
        {total > 0 && <Text style={s.detailTotal}>{total} tracks</Text>}
        {!isLocal && (
          <Pressable hitSlop={8} onPress={() => setFolderActionOpen(true)} style={s.moreBtn}>
            <Ionicons name="ellipsis-horizontal" size={20} color={c.textMuted} />
          </Pressable>
        )}
      </View>
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search in folder…"
        trailing={
          <SortControl
            options={[
              { field: '', label: 'Track order' },
              { field: 'title', label: 'Title' },
              { field: 'artist', label: 'Artist' },
              { field: 'key', label: 'Key' },
              { field: 'duration', label: 'Length' },
              ...(isLocal ? [] : [
                { field: 'bpm', label: 'BPM' },
                { field: 'added', label: 'Added' },
              ]),
            ]}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        }
      />
      <FlatList
        {...LIST_PERF_PROPS}
        data={displayTracks}
        keyExtractor={(item, index) => `${item.path}-${index}`}
        renderItem={renderTrack}
        contentContainerStyle={s.listContent}
        onEndReached={isLocal ? undefined : () => loadPage(false, searchRef.current)}
        onEndReachedThreshold={0.4}
        ListFooterComponent={fetching && !scanning
          ? <ActivityIndicator color={c.accent} style={{ padding: Spacing.md }} />
          : null}
        ListEmptyComponent={
          scanning ? <Text style={s.empty}>{REBUILDING_MSG}</Text>
          : !fetching ? <Text style={s.empty}>No tracks found</Text>
          : null}
      />
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => {
          const idx = displayRef.current.findIndex((x) => x.path === t.path);
          playFromList(t, idx >= 0 ? idx : 0);
          setActionTrack(null);
        }}
        onPlayNext={(t) => { playNext([t]); setActionTrack(null); }}
        onAddToQueue={(t) => { addToQueue([t]); setActionTrack(null); }}
        onRename={!isLocal ? (t) => { setActionTrack(null); setRenameTrackTarget(t); } : undefined}
      />
      {!isLocal && (
        <FolderActionSheet
          folder={folderActionOpen
            ? { path: folderPath, name: folderName, trackCount: total, coverPath: null, hasArtwork: false }
            : null}
          onClose={() => setFolderActionOpen(false)}
          onRename={(_f) => { setFolderActionOpen(false); setRenamingFolder(true); }}
        />
      )}
      <RenameModal
        initialValue={renameTrackTarget?.filename ?? ''}
        onCancel={() => setRenameTrackTarget(null)}
        onConfirm={async (newFilename) => {
          if (!renameTrackTarget) return;
          const target = renameTrackTarget;
          setRenameTrackTarget(null);
          try { await renameTrackApi(target.path, newFilename); }
          catch (e: any) { Alert.alert('Rename failed', e?.response?.data || e?.message || 'Unknown error'); }
        }}
        title="Rename track"
        visible={renameTrackTarget !== null}
      />
      <RenameModal
        initialValue={folderName}
        onCancel={() => setRenamingFolder(false)}
        onConfirm={async (newName) => {
          setRenamingFolder(false);
          try { await renameFolderApi(folderPath, newName); }
          catch (e: any) { Alert.alert('Rename failed', e?.response?.data || e?.message || 'Unknown error'); }
        }}
        title="Rename folder"
        visible={renamingFolder}
      />
    </View>
  );
}

// ── PlaylistDetail ────────────────────────────────────────────────────────────

type PlaylistDetailProps = NativeStackScreenProps<LibraryStackParamList, 'PlaylistDetail'>;

function PlaylistDetail({ route, navigation: nav }: PlaylistDetailProps) {
  const { s, c } = useLibStyles();
  const { playlistId } = route.params;
  const { playQueue } = usePlayer();
  const { mixtapes, load, removeTrack, rename, publish, unpublish, clearTracks, reorderTracks } = useMixtapeStore();
  const { serverUrl } = useAuthStore();

  const [renaming, setRenaming]     = useState(false);
  const [newName, setNewName]       = useState('');
  const [publishing, setPublishing] = useState(false);
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const linkCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playlist = mixtapes.find((p) => p.id === playlistId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tracks = playlist?.tracks ?? [];

  const musicTracksRef = useRef<MusicTrack[]>([]);
  useEffect(() => {
    musicTracksRef.current = tracks.map(mixtapeTrackToMusicTrack);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist]);

  const totalDuration = useMemo(
    () => tracks.reduce((s, t) => s + (t.duration ?? 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playlist],
  );

  const shareUrl = playlist?.publicToken ? `${serverUrl}/mixtape/${playlist.publicToken}` : null;

  useEffect(() => {
    if (playlist?.name) nav.setOptions({ title: playlist.name });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist?.name]);

  useEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setSheetOpen(true)} hitSlop={8} style={{ marginRight: Spacing.md }}>
          <Ionicons name="ellipsis-horizontal" size={22} color={c.textPrimary} />
        </Pressable>
      ),
    });
  }, [nav, c]);

  const handlePlayAll = useCallback(() => {
    if (!musicTracksRef.current.length) return;
    playQueue(musicTracksRef.current, 0);
  }, [playQueue]);

  const handleShuffle = useCallback(() => {
    if (!musicTracksRef.current.length) return;
    playQueue([...musicTracksRef.current].sort(() => Math.random() - 0.5), 0);
  }, [playQueue]);

  const handleRenameCommit = useCallback(async () => {
    if (!newName.trim() || !playlist) { setRenaming(false); return; }
    await rename(playlist.id, newName.trim());
    setRenaming(false);
  }, [newName, playlist, rename]);

  const handlePublishToggle = useCallback(async () => {
    if (!playlist) return;
    setPublishing(true);
    try {
      if (playlist.isPublished) await unpublish(playlist.id);
      else await publish(playlist.id);
    } finally {
      setPublishing(false);
    }
  }, [playlist, publish, unpublish]);

  const handleCopyLink = useCallback(() => {
    if (!shareUrl) return;
    Clipboard.setString(shareUrl);
    setLinkCopied(true);
    if (linkCopiedTimer.current) clearTimeout(linkCopiedTimer.current);
    linkCopiedTimer.current = setTimeout(() => setLinkCopied(false), 2000);
  }, [shareUrl]);

  const handleShare = useCallback(() => {
    if (!shareUrl || !playlist) return;
    Share.share({ message: `${playlist.name}: ${shareUrl}`, url: shareUrl });
  }, [shareUrl, playlist]);

  const handlePickArtwork = useCallback(async () => {
    setSheetOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.92,
    });
    if (result.canceled || !result.assets?.[0]?.uri || !playlist) return;
    try {
      await mixtapesAPI.uploadArtwork(playlist.id, result.assets[0].uri);
      await load();
    } catch { /* ignore */ }
  }, [playlist, load]);

  const handleClearTracks = useCallback(() => {
    if (!playlist) return;
    Alert.alert('Clear all tracks', 'Remove all tracks from this mixtape?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearTracks(playlist.id) },
    ]);
  }, [playlist, clearTracks]);

  const handleMoveTrack = useCallback((trackId: string, direction: 'up' | 'down') => {
    if (!playlist) return;
    const idx = tracks.findIndex((t) => t.id === trackId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= tracks.length) return;
    const reordered = [...tracks];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);
    reorderTracks(playlist.id, reordered.map((t) => t.id));
  }, [playlist, tracks, reorderTracks]);

  const formatTotalDuration = useCallback((seconds: number): string => {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }, []);

  if (!playlist) return (
    <View style={s.center}><Text style={s.empty}>Mixtape not found</Text></View>
  );

  return (
    <View style={s.flex}>
      {/* Rename modal */}
      <Modal animationType="fade" onRequestClose={() => setRenaming(false)} transparent visible={renaming}>
        <PlaylistRenameSheet
          name={newName}
          onChange={setNewName}
          onCancel={() => setRenaming(false)}
          onConfirm={handleRenameCommit}
        />
      </Modal>

      {/* Settings sheet */}
      <Modal animationType="slide" onRequestClose={() => setSheetOpen(false)} transparent visible={sheetOpen}>
        <Pressable onPress={() => setSheetOpen(false)} style={s.overlay} />
        <View style={s.sheetContainer}>
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>{playlist.name}</Text>
            <View style={s.sheetDivider} />
            <Pressable
              onPress={() => { setSheetOpen(false); setNewName(playlist.name); setRenaming(true); }}
              style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
            >
              <Ionicons name="pencil-outline" size={20} color={c.textPrimary} />
              <Text style={s.sheetBtnText}>Rename</Text>
            </Pressable>
            <Pressable
              onPress={handlePickArtwork}
              style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
            >
              <Ionicons name="image-outline" size={20} color={c.textPrimary} />
              <Text style={s.sheetBtnText}>Upload artwork</Text>
            </Pressable>
            <Pressable
              disabled={publishing}
              onPress={async () => { await handlePublishToggle(); setSheetOpen(false); }}
              style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
            >
              <Ionicons
                name="globe-outline"
                size={20}
                color={playlist.isPublished ? c.accent : c.textPrimary}
              />
              <Text style={[s.sheetBtnText, playlist.isPublished && { color: c.accent }]}>
                {playlist.isPublished ? 'Unpublish' : 'Publish'}
              </Text>
            </Pressable>
            {playlist.isPublished && shareUrl && (
              <>
                <Pressable
                  onPress={() => { handleCopyLink(); setSheetOpen(false); }}
                  style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
                >
                  <Ionicons name="link-outline" size={20} color={c.textPrimary} />
                  <Text style={s.sheetBtnText}>{linkCopied ? 'Copied!' : 'Copy link'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setSheetOpen(false); handleShare(); }}
                  style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
                >
                  <Ionicons name="share-outline" size={20} color={c.textPrimary} />
                  <Text style={s.sheetBtnText}>Share</Text>
                </Pressable>
              </>
            )}
            {tracks.length > 0 && (
              <Pressable
                onPress={() => { setSheetOpen(false); handleClearTracks(); }}
                style={({ pressed }) => [s.sheetBtn, pressed && s.sheetBtnPressed]}
              >
                <Ionicons name="trash-outline" size={20} color={c.danger} />
                <Text style={[s.sheetBtnText, { color: c.danger }]}>Clear all tracks</Text>
              </Pressable>
            )}
            <Pressable style={s.sheetCancel} onPress={() => setSheetOpen(false)}>
              <Text style={s.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={s.mixtapeHeader}>
        <View style={s.mixtapeHeaderRow}>
          <Pressable onPress={handlePickArtwork} style={s.mixtapeArtworkWrap}>
            {playlist.hasArtwork ? (
              <Image
                source={{ uri: getMixtapeArtworkUrl(playlist.id) ?? undefined }}
                style={s.mixtapeArtworkImg}
              />
            ) : (
              <View style={[s.mixtapeArtworkImg, s.artworkPlaceholder]}>
                <Ionicons name="image-outline" size={28} color={c.textDim} />
              </View>
            )}
            <View style={s.mixtapeArtworkOverlay}>
              <Ionicons name="camera-outline" size={14} color="#fff" />
            </View>
          </Pressable>
          <View style={s.mixtapeMetaCol}>
            <Text numberOfLines={1} style={s.mixtapeNameText}>{playlist.name}</Text>
            <Text style={s.mixtapeMetaText}>
              {tracks.length} track{tracks.length !== 1 ? 's' : ''}
              {totalDuration > 0 ? `  ·  ${formatTotalDuration(totalDuration)}` : ''}
              {playlist.isPublished ? '  ·  published' : ''}
            </Text>
          </View>
        </View>
        <View style={s.mixtapeActions}>
          <Pressable
            disabled={!tracks.length}
            onPress={handlePlayAll}
            style={[s.actionBtn, s.actionBtnPrimary, !tracks.length && { opacity: 0.4 }]}
          >
            <Ionicons name="play" size={13} color="#fff" />
            <Text style={s.actionBtnText}>Play</Text>
          </Pressable>
          <Pressable
            disabled={!tracks.length}
            onPress={handleShuffle}
            style={[s.actionBtn, !tracks.length && { opacity: 0.4 }]}
          >
            <Ionicons name="shuffle" size={13} color={c.textPrimary} />
            <Text style={[s.actionBtnText, { color: c.textPrimary }]}>Shuffle</Text>
          </Pressable>
          {playlist.isPublished && shareUrl && (
            <Pressable onPress={handleShare} style={s.actionBtn}>
              <Ionicons name="share-outline" size={13} color={c.textPrimary} />
              <Text style={[s.actionBtnText, { color: c.textPrimary }]}>Share</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Track list */}
      <FlatList
        {...LIST_PERF_PROPS}
        data={tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          <Text style={s.empty}>{'No tracks yet\nUse "Add to Mixtape" when browsing your library'}</Text>
        }
        renderItem={({ item, index }) => {
          const displayTitle = item.title || item.filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || '(Unknown)';
          const isFirst = index === 0;
          const isLast  = index === tracks.length - 1;
          return (
            <Pressable
              onPress={() => { playQueue(musicTracksRef.current, index); }}
              style={({ pressed }) => [s.trackRow, pressed && s.rowPressed]}
            >
              <View style={s.reorderBtns}>
                <Pressable
                  disabled={isFirst}
                  hitSlop={4}
                  onPress={() => handleMoveTrack(item.id, 'up')}
                  style={[s.reorderBtn, isFirst && s.reorderBtnDisabled]}
                >
                  <Ionicons name="chevron-up" size={14} color={isFirst ? c.textDim : c.textMuted} />
                </Pressable>
                <Pressable
                  disabled={isLast}
                  hitSlop={4}
                  onPress={() => handleMoveTrack(item.id, 'down')}
                  style={[s.reorderBtn, isLast && s.reorderBtnDisabled]}
                >
                  <Ionicons name="chevron-down" size={14} color={isLast ? c.textDim : c.textMuted} />
                </Pressable>
              </View>
              <Text style={s.trackNum}>{index + 1}</Text>
              <ArtworkBox path={item.filePath} size={36} />
              <View style={s.rowInfo}>
                <Text style={s.rowTitle} numberOfLines={1}>{displayTitle}</Text>
                {(item.artist || item.album) && (
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {[item.artist, item.album].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
              <Text style={s.trackDur}>{formatDuration(item.duration)}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => removeTrack(playlistId, item.id)}
                style={s.moreBtn}
              >
                <Ionicons name="close" size={18} color={c.textMuted} />
              </Pressable>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function useLibStyles() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeLibStyles(c), [c]);
  return { s, c };
}

function makeLibStyles(c: ThemeColors) {
  return StyleSheet.create({
    flex:   { flex: 1, backgroundColor: c.bgPrimary },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty:  {
      textAlign: 'center',
      color: c.textMuted,
      fontSize: Typography.sm,
      paddingVertical: Spacing.xxl,
      lineHeight: 20,
    },

    // Source picker
    sourcePicker: {
      flexDirection: 'row',
      marginHorizontal: Spacing.md,
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
      backgroundColor: c.bgElevated,
      borderRadius: Radius.sm,
      padding: 2,
    },
    sourceBtn: {
      flex: 1,
      paddingVertical: 6,
      alignItems: 'center',
      borderRadius: Radius.sm - 1,
    },
    sourceBtnActive: {
      backgroundColor: c.bgSurface,
      elevation: 1,
    },
    sourceBtnText:       { fontSize: Typography.sm, color: c.textMuted, fontWeight: '500' },
    sourceBtnTextActive: { fontSize: Typography.sm, color: c.textPrimary, fontWeight: '600' },

    // Search
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.bgSurface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.md,
      marginHorizontal: Spacing.md,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      height: 40,
    },
    searchIcon:  { marginRight: Spacing.xs },
    searchInput: {
      flex: 1,
      color: c.textPrimary,
      fontSize: Typography.base,
      padding: 0,
    },

    // Sort bar
    // Sort trigger (icon on the search row) + bottom-sheet rows
    sortTrigger: {
      marginLeft: Spacing.xs,
      paddingHorizontal: 2,
      alignSelf: 'center',
    },
    searchTrailingDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      marginVertical: Spacing.sm,
      marginLeft: Spacing.xs,
      backgroundColor: c.border,
    },
    sortRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xs,
    },
    sortSheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },
    sortSheetLabel:       { fontSize: Typography.md, color: c.textPrimary },
    sortSheetLabelActive: { color: c.accent, fontWeight: '600' },
    sortSheetRight:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

    // Tab bar
    tabBarScroll: {
      flexGrow: 0,
      backgroundColor: c.bgSurface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    tabBarContent: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      gap: Spacing.xs,
    },
    tabBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs + 2,
      borderRadius: Radius.md,
    },
    tabBtnActive:  { backgroundColor: c.bgElevated },
    tabText:       { fontSize: Typography.sm, color: c.textMuted, fontWeight: '500' },
    tabTextActive: { color: c.textPrimary },

    // List rows
    listContent: { paddingBottom: Spacing.xxl },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowPressed: { backgroundColor: c.bgSurface },
    rowInfo:    { flex: 1, minWidth: 0 },
    rowTitle:   { fontSize: Typography.base, color: c.textPrimary, fontWeight: '500' },
    rowMeta:    { fontSize: Typography.sm, color: c.textMuted, marginTop: 2 },

    // Artwork
    artwork:            { backgroundColor: c.bgElevated },
    artworkPlaceholder: {
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    artistIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.bgElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },

    // Track row
    trackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    trackNum: {
      width: 28,
      textAlign: 'right',
      fontSize: Typography.sm,
      color: c.textMuted,
    },
    trackDur: {
      fontSize: Typography.sm,
      color: c.textMuted,
      minWidth: 38,
      textAlign: 'right',
    },
    trackRight:  { alignItems: 'flex-end', gap: 2 },
    trackKeyBpm: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    trackKey:    { fontSize: Typography.xs, fontWeight: '700', color: c.accent, maxWidth: 64 },
    trackBpm:    { fontSize: Typography.xs, color: c.textDim },
    moreBtn: { paddingLeft: Spacing.xs },
    clearAllBtn: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, opacity: 0.6 },

    // Album header
    albumHeader: {
      alignItems: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.lg,
    },
    albumArt:    { width: 200, height: 200, borderRadius: Radius.lg, marginBottom: Spacing.lg },
    albumTitle:  { fontSize: Typography.xl, fontWeight: '700', color: c.textPrimary, textAlign: 'center' },
    albumArtist: { fontSize: Typography.base, color: c.textMuted, marginTop: Spacing.xs, textAlign: 'center' },
    albumMeta:   { fontSize: Typography.sm, color: c.textMuted, marginTop: 2 },
    albumActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },

    // Detail header (genre/playlist)
    detailHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    playlistArt: { width: 40, height: 40, borderRadius: Radius.sm },
    detailTotal: {
      flex: 1,
      textAlign: 'right',
      fontSize: Typography.sm,
      color: c.textMuted,
    },

    // Action buttons (play / shuffle)
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgSurface,
    },
    actionBtnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
    actionBtnPressed: { opacity: 0.75 },
    actionBtnText:    { fontSize: Typography.sm, color: '#fff', fontWeight: '600' },

    // Bottom sheet
    overlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    sheetContainer: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.bgSurface,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingBottom: Spacing.xxl,
      paddingTop: Spacing.sm,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.borderStrong,
      alignSelf: 'center',
      marginBottom: Spacing.md,
    },
    sheetTitle: {
      fontSize: Typography.md,
      fontWeight: '600',
      color: c.textPrimary,
      paddingHorizontal: Spacing.lg,
      marginBottom: 2,
    },
    sheetMeta: {
      fontSize: Typography.sm,
      color: c.textMuted,
      paddingHorizontal: Spacing.lg,
      marginBottom: 2,
    },
    sheetMetaSub: {
      fontSize: Typography.xs,
      color: c.textDim,
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    sheetDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginVertical: Spacing.sm,
      marginHorizontal: Spacing.md,
    },
    sheetBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },
    sheetBtnPressed: { backgroundColor: c.bgElevated },
    sheetBtnText:    { fontSize: Typography.base, color: c.textPrimary, flex: 1 },
    sheetCancel: {
      alignItems: 'center',
      paddingVertical: Spacing.md,
      marginTop: Spacing.xs,
      marginHorizontal: Spacing.lg,
      borderRadius: Radius.md,
      backgroundColor: c.bgElevated,
    },
    sheetCancelText: { fontSize: Typography.base, color: c.textMuted, fontWeight: '500' },

    // Inline create / rename bar
    inlineBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      backgroundColor: c.bgSurface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    inlineBarInput: {
      flex: 1,
      color: c.textPrimary,
      fontSize: Typography.base,
      backgroundColor: c.bgElevated,
      borderRadius: Radius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    inlineBarBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      backgroundColor: c.accent,
      borderRadius: Radius.sm,
    },
    inlineBarBtnText: { color: '#fff', fontSize: Typography.sm, fontWeight: '600' },

    // Inline create inside playlist picker sheet
    inlineCreate: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
    },
    inlineInput: {
      flex: 1,
      color: c.textPrimary,
      fontSize: Typography.base,
      backgroundColor: c.bgElevated,
      borderRadius: Radius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    inlineConfirm: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      backgroundColor: c.accent,
      borderRadius: Radius.sm,
    },
    inlineConfirmText: { color: '#fff', fontSize: Typography.sm, fontWeight: '600' },

    // Mixtape detail header
    mixtapeHeader: {
      backgroundColor: c.bgSurface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    mixtapeHeaderRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    mixtapeArtworkWrap:  { position: 'relative' },
    mixtapeArtworkImg:   { width: 72, height: 72, borderRadius: Radius.md },
    mixtapeArtworkOverlay: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: Radius.sm,
      padding: 3,
    },
    mixtapeMetaCol:  { flex: 1, gap: Spacing.xs },
    mixtapeNameText: {
      fontSize: Typography.lg,
      fontWeight: '600',
      color: c.textPrimary,
      flexShrink: 1,
    },
    mixtapeMetaText: { fontSize: Typography.sm, color: c.textMuted },
    mixtapeActions:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },

    // Track reorder controls
    reorderBtns:        { flexDirection: 'column', alignItems: 'center', gap: 0, marginRight: 2 },
    reorderBtn:         { padding: 2 },
    reorderBtnDisabled: { opacity: 0.3 },

    // Rename modal
    renameSheet: {
      backgroundColor: c.bgSurface,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    renameTitle: {
      fontSize: Typography.md,
      fontWeight: '600',
      color: c.textPrimary,
    },
    renameInput: {
      height: 44,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.bgElevated,
      color: c.textPrimary,
      fontSize: Typography.base,
    },
    renameActions:    { flexDirection: 'row', gap: Spacing.sm },
    renameCancelBtn:  {
      flex: 1,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: Radius.sm,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
    },
    renameCancelText:  { color: c.textPrimary, fontSize: Typography.base, fontWeight: '500' },
    renameConfirmBtn:  {
      flex: 1,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: Radius.sm,
      backgroundColor: c.accent,
    },
    renameConfirmText: { color: '#fff', fontSize: Typography.base, fontWeight: '600' },
  });
}

// ── Stack Navigator ───────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={makeScreenOptions(colors)}>
      <Stack.Screen
        name="LibraryHome"
        component={LibraryHome}
        options={{ title: 'Library' }}
      />
      <Stack.Screen
        name="Artist"
        component={ArtistDetail}
        options={({ route }) => ({ title: route.params.artistName })}
      />
      <Stack.Screen
        name="Album"
        component={AlbumDetail}
        options={({ route }) => ({ title: route.params.album.album || 'Album' })}
      />
      <Stack.Screen
        name="FolderDetail"
        component={FolderDetail}
        options={({ route }) => ({ title: route.params.folderName })}
      />
      <Stack.Screen
        name="GenreDetail"
        component={GenreDetail}
        options={({ route }) => ({ title: route.params.genre })}
      />
      <Stack.Screen
        name="YearDetail"
        component={YearDetail}
        options={({ route }) => ({ title: String(route.params.year) })}
      />
      <Stack.Screen
        name="PlaylistDetail"
        component={PlaylistDetail}
        options={{ title: 'Mixtape' }}
      />
    </Stack.Navigator>
  );
}
