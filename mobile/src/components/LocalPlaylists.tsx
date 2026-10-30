import { Text, TextInput } from './Typography';
import { Editorial } from '../theme';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { usePlayer } from '../context/PlayerContext';
import { useLocalPlaylistStore } from '../store/localPlaylistStore';
import type { MusicTrack } from '../api/musicLibrary';

export function LocalPlaylists({ playlistId, onOpen }: { playlistId?: string; onOpen?: (id: string) => void }) {
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const store = useLocalPlaylistStore();
  const load = store.load;
  const player = usePlayer();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playlist = store.playlists.find(p => p.id === playlistId);
  async function run(action: () => Promise<unknown> | void) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  useEffect(() => { setName(playlist?.name ?? ''); }, [playlist?.id, playlist?.name]);
  const button = (label: string, action: () => void) => <Pressable accessibilityRole="button" disabled={busy} onPress={action} style={s.button}><Text style={s.buttonText}>{label}</Text></Pressable>;
  const editor = <View style={s.editor}><TextInput accessibilityLabel="Device playlist name" placeholder="Playlist name…" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} style={s.input} /><View>{button(playlist ? 'Rename' : 'Create', () => void run(async () => {
    if (playlist) await store.rename(playlist.id, name);
    else { await store.create(name); setName(''); }
  }))}</View></View>;
  return <View style={s.root}>
    <Text style={s.caption}>ON THIS DEVICE · Never synced to a server</Text>
    {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {busy && <ActivityIndicator color={colors.accent} />}
    {playlistId ? playlist ? <>
      {editor}
      <View style={s.actions}>{button('Play all', () => void run(() => player.playQueue(playlist.tracks)))}{button('Delete playlist', () => Alert.alert('Delete device playlist?', 'The audio files are kept.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void run(() => store.remove(playlist.id)) }]))}</View>
      <FlatList data={playlist.tracks} keyExtractor={t => t.path} ListEmptyComponent={<Text style={s.caption}>Add local tracks from their actions menu or the player.</Text>} renderItem={({ item, index }) => <View style={s.row}>
        <Pressable accessibilityLabel={`Play ${item.title || item.filename}`} style={s.grow} onPress={() => void run(() => player.playQueue(playlist.tracks, index))}><Text style={s.title}>{item.title || item.filename}</Text><Text style={s.caption}>{item.artist || 'Unknown artist'}</Text></Pressable>
        <Pressable accessibilityLabel="Move track up" disabled={busy || index === 0} style={s.control} onPress={() => void run(() => store.moveTrack(playlist.id, item.path, -1))}><Text style={s.buttonText}>↑</Text></Pressable>
        <Pressable accessibilityLabel="Move track down" disabled={busy || index === playlist.tracks.length - 1} style={s.control} onPress={() => void run(() => store.moveTrack(playlist.id, item.path, 1))}><Text style={s.buttonText}>↓</Text></Pressable>
        <Pressable accessibilityLabel="Remove from device playlist" disabled={busy} style={s.control} onPress={() => void run(() => store.removeTrack(playlist.id, item.path))}><Text style={s.buttonText}>×</Text></Pressable>
      </View>} />
    </> : <Text style={s.caption}>{store.loaded ? 'This device playlist no longer exists.' : 'Loading device playlists…'}</Text> : <>
      {editor}
      <FlatList data={store.playlists} keyExtractor={p => p.id} ListEmptyComponent={<Text style={s.caption}>No device playlists yet.</Text>} renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onOpen?.(item.id)} style={s.row}><View style={s.grow}><Text style={s.title}>{item.name}</Text><Text style={s.caption}>{item.tracks.length} {item.tracks.length === 1 ? 'track' : 'tracks'} · On this device</Text></View><Text style={s.buttonText}>›</Text></Pressable>} />
    </>}
  </View>;
}

export function LocalPlaylistPicker({ tracks, onClose, embedded = false }: { tracks: MusicTrack[]; onClose: () => void; embedded?: boolean }) {
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const store = useLocalPlaylistStore();
  const load = store.load;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  async function add(id?: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const playlistId = id ?? (await store.create(name)).id;
      await store.addTracks(playlistId, tracks);
      onClose();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const content = <View style={s.backdrop}><SafeAreaView edges={['bottom', 'left', 'right']} style={s.sheet}><ScrollView keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Add to device playlist</Text><Text style={s.caption}>Stored on this handset. Never synced to a server.</Text>
      {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <View style={s.editor}><TextInput accessibilityLabel="New device playlist name" placeholder="New playlist name…" placeholderTextColor={colors.textMuted} style={s.input} value={name} onChangeText={setName} /><Pressable disabled={busy || !name.trim()} style={s.button} onPress={() => void add()}><Text style={s.buttonText}>Create & add</Text></Pressable></View>
      {store.playlists.map(p => <Pressable key={p.id} disabled={busy} style={s.row} onPress={() => void add(p.id)}><Text style={s.title}>{p.name}</Text><Text style={s.caption}>{p.tracks.length} {p.tracks.length === 1 ? 'track' : 'tracks'}</Text></Pressable>)}
      <Pressable disabled={busy} style={s.button} onPress={onClose}><Text style={s.buttonText}>Cancel</Text></Pressable>
    </ScrollView></SafeAreaView></View>;
  return embedded ? <View style={StyleSheet.absoluteFill}>{content}</View> : <Modal transparent animationType="slide" supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} onRequestClose={onClose}>{content}</Modal>;
}
function styles(c: ReturnType<typeof useTheme>['colors']) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bgPrimary, paddingHorizontal: 16 },
  caption: { color: c.textMuted, fontSize: 12, marginVertical: 10 },
  error: { color: c.accent, paddingVertical: 10 },
  title: { color: c.textPrimary, fontSize: 17, ...Editorial.heading },
  editor: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  input: { flex: 1, color: c.textPrimary, borderBottomWidth: 1, borderColor: c.border, minHeight: 44, ...Editorial.control },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, ...Editorial.control },
  buttonText: { color: c.accent, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.border },
  grow: { flex: 1 }, control: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%', backgroundColor: c.bgPrimary, padding: 20 },
}); }
