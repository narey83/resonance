// <copyright file="BrowseFolderScreen.tsx" company="John Narey">
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { Radius, Spacing, Typography } from '../../theme';
import type { ThemeColors } from '../../theme';
import * as usersApi from '../../api/users';
import type { DirectoryFile } from '../../api/users';
import * as searchApi from '../../api/searches';
import { useAuthStore } from '../../store/auth';
import type { SearchStackParamList } from './SearchScreen';

type DownloadTarget = 'server' | 'device';

type Props = NativeStackScreenProps<SearchStackParamList, 'BrowseFolder'>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1_048_576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1_073_741_824).toFixed(2)} GB`;
}

function getFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;
}

function getSeparator(dirPath: string): string {
  return dirPath.includes('\\') ? '\\' : '/';
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

// ─── File Row ─────────────────────────────────────────────────────────────────

function FileRow({
  file, selected, colors, onToggle,
}: {
  file: DirectoryFile;
  selected: boolean;
  colors: ThemeColors;
  onToggle: () => void;
}) {
  const s = useMemo(() => makeRowStyles(colors), [colors]);

  return (
    <Pressable
      style={({ pressed }) => [s.row, selected && s.rowSelected, pressed && s.rowPressed]}
      onPress={onToggle}
    >
      <View style={[s.checkbox, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
        {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
      </View>
      <View style={s.info}>
        <Text style={s.name} numberOfLines={1} ellipsizeMode="middle">{getFileName(file.filename)}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {qualityLabel(file)}
          {file.size > 0 ? ` · ${fmtBytes(file.size)}` : ''}
          {file.length
            ? ` · ${Math.floor(file.length / 60)}:${String(file.length % 60).padStart(2, '0')}`
            : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const makeRowStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: Spacing.sm,
  },
  rowSelected: { backgroundColor: `${c.accent}14` },
  rowPressed:  { opacity: 0.7 },
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
  info: { flex: 1, gap: 2 },
  name: { fontSize: Typography.base, color: c.textPrimary, fontWeight: '500' },
  meta: { fontSize: Typography.xs, color: c.textMuted },
});

// ─── Download Modal ───────────────────────────────────────────────────────────

function DownloadModal({
  visible, label, downloadTarget, onChangeDownloadTarget,
  destination, onChangeDestination, onConfirm, onCancel, downloading, colors,
}: {
  visible: boolean;
  label: string;
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.overlay} onPress={onCancel} />
      <View style={s.container}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Download</Text>
          <Text style={s.subtitle} numberOfLines={2}>{label}</Text>

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
              <Text style={s.fieldLabel}>Destination folder</Text>
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
  title:      { fontSize: Typography.lg, fontWeight: '700', color: c.textPrimary },
  subtitle:   { fontSize: Typography.sm, color: c.textMuted, marginBottom: Spacing.xs },
  fieldLabel: { fontSize: Typography.xs, color: c.textMuted, fontWeight: '600', marginTop: Spacing.xs },
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BrowseFolderScreen({ route, navigation }: Props) {
  const { username, directory } = route.params;
  const { colors } = useTheme();

  const sep     = getSeparator(directory);
  const dirName = directory.split(/[\\/]/).filter(Boolean).pop() ?? directory;

  const [files, setFiles]     = useState<DirectoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [showModal, setShowModal]         = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget>('server');
  const [destination, setDestination]     = useState('/Music');
  const [downloading, setDownloading]     = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: dirName });
  }, [navigation, dirName]);

  useEffect(() => {
    usersApi.getDirectoryContents(username, directory)
      .then(dirs => {
        const root = dirs?.[0];
        if (!root) { setError('No files returned for this directory'); return; }
        setFiles(root.files ?? []);
      })
      .catch(() => setError('Could not fetch folder contents — the peer may be offline or slow'))
      .finally(() => setLoading(false));
  }, [username, directory]);

  const toggleFile = useCallback((filename: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename); else next.add(filename);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const allSelected = files.length > 0 && selected.size === files.length;

  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(files.map(f => f.filename)));
  }, [allSelected, files]);

  const selectedFiles = useMemo(
    () => files.filter(f => selected.has(f.filename)),
    [files, selected],
  );

  const downloadLabel = `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} from ${dirName}`;

  const confirmDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (downloadTarget === 'device') {
        const { serverUrl, accessToken } = useAuthStore.getState();
        const saveDir = new Directory(Paths.document, 'resonance');
        saveDir.create({ intermediates: true, idempotent: true });
        let saved = 0;
        for (const file of selectedFiles) {
          const fullPath = `${directory}${sep}${file.filename}`;
          const localFile = new File(saveDir, getFileName(fullPath));
          if (localFile.exists) { saved++; continue; }
          const token = accessToken ? `&access_token=${encodeURIComponent(accessToken)}` : '';
          const sizeParam = file.size ? `&size=${file.size}` : '';
          const url = `${serverUrl}/api/v0/streams/${encodeURIComponent(username)}?filename=${encodeURIComponent(fullPath)}${sizeParam}${token}`;
          await File.downloadFileAsync(url, localFile);
          saved++;
        }
        setShowModal(false);
        setSelected(new Set());
        Alert.alert('Downloaded', `Saved ${saved} file${saved !== 1 ? 's' : ''} to device.`);
      } else {
        const withPaths = selectedFiles.map(f => ({
          ...f,
          filename: `${directory}${sep}${f.filename}`,
          isLocked: false as const,
          destinationFolder: destination || undefined,
        }));
        await searchApi.downloadFiles(username, withPaths);
        setShowModal(false);
        setSelected(new Set());
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
  }, [downloading, selectedFiles, directory, sep, destination, username, downloadTarget]);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.root}>
      <View style={styles.subheader}>
        <Ionicons name="person-outline" size={13} color={colors.textDim} />
        <Text style={styles.subheaderText}>{username}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      ) : error ? (
        <View style={styles.centerContent}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textDim} />
          <Text style={styles.centerText}>{error}</Text>
        </View>
      ) : files.length === 0 ? (
        <View style={styles.centerContent}>
          <Ionicons name="folder-open-outline" size={40} color={colors.textDim} />
          <Text style={styles.centerText}>No files in this folder</Text>
        </View>
      ) : (
        <FlatList<DirectoryFile>
          data={files}
          keyExtractor={f => f.filename}
          ListHeaderComponent={
            <Pressable
              style={({ pressed }) => [styles.selectAllRow, pressed && { opacity: 0.7 }]}
              onPress={toggleSelectAll}
            >
              <View style={[styles.selectAllCheck, allSelected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                {allSelected && <Ionicons name="checkmark" size={11} color="#fff" />}
              </View>
              <Text style={[styles.selectAllLabel, { color: allSelected ? colors.accent : colors.textMuted }]}>
                Select all
              </Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <FileRow
              file={item}
              selected={selected.has(item.filename)}
              colors={colors}
              onToggle={() => toggleFile(item.filename)}
            />
          )}
          contentContainerStyle={selected.size > 0 ? { paddingBottom: 80 } : undefined}
        />
      )}

      {selected.size > 0 && (
        <View style={[styles.selectionBar, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
          <Text style={[styles.selectionCount, { color: colors.textPrimary }]}>
            {selected.size} selected
          </Text>
          <Pressable onPress={clearSelection} hitSlop={8} style={styles.selectionClear}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            onPress={() => setShowModal(true)}
            style={[styles.selectionDownload, { backgroundColor: colors.accent }]}
          >
            <Ionicons name="arrow-down" size={14} color="#fff" />
            <Text style={styles.selectionDownloadText}>Download</Text>
          </Pressable>
        </View>
      )}

      <DownloadModal
        visible={showModal}
        label={downloadLabel}
        downloadTarget={downloadTarget}
        onChangeDownloadTarget={setDownloadTarget}
        destination={destination}
        onChangeDestination={setDestination}
        onConfirm={confirmDownload}
        onCancel={() => setShowModal(false)}
        downloading={downloading}
        colors={colors}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bgPrimary },

  subheader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: c.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  subheaderText: { fontSize: Typography.xs, color: c.textDim },

  spinner: { marginTop: 48 },

  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  selectAllCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selectAllLabel: { fontSize: Typography.sm, fontWeight: '500' },

  centerContent: {
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
