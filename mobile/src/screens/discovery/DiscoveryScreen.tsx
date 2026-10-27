import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../../navigation/MainTabs';
import { useTheme } from '../../context/ThemeContext';
import { usePlayer, usePlaybackPosition, usePlaybackStatus } from '../../context/PlayerContext';
import { getArtworkUrl, getTracks, getRecentlyAdded, getTrackTitle, type MusicAlbum, type MusicTrack } from '../../api/musicLibrary';
import { getPlayHistory, type PlayRecord } from '../../api/libraryActivity';
import * as discovery from '../../api/discovery';
import * as searches from '../../api/searches';
import { useDiscoveryStore } from '../../store/discoveryStore';
import { useOfflineCrates, type OfflineCrate } from '../../services/offlineCrates';
import { useMixtapeStore } from '../../store/mixtapeStore';
import { useLibrarySettings } from '../../store/librarySettingsStore';
import { useLibraryActivityStore } from '../../store/libraryActivityStore';
import { useTransferStore } from '../../store/transferStore';
import { suggestMixes } from '../../lib/mixSuggestions';
import { newSearchId, refreshWantedSearches } from '../../services/wantedSearches';
import { useConnectionStore } from '../../services/connectionMonitor';
import { ARTWORK_THUMB_SIZE, PLAYER_ART_SIZE, getArtworkCacheKey } from '../../services/artworkCache';
import { haptics } from '../../lib/haptics';
import { albumTrackParams } from '../../lib/albumTracks';
import { sessionGuard } from '../../lib/sessionScope';
import { Typography, type ThemeColors } from '../../theme';

const sections = ['For you', 'Matches', 'Digging', 'Prepare', 'Offline'] as const;
type Section = typeof sections[number];
const sectionLabels: Record<Section, string> = { 'For you': 'Listen', Matches: 'Match', Digging: 'Dig', Prepare: 'Notes', Offline: 'Offline' };
export default function DiscoveryScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const nav = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, 'DiscoverTab'>>();
  const connection = useConnectionStore(state => state.status);
  const player = usePlayer();
  const { isPlaying } = usePlaybackStatus();
  const [section, setSection] = useState<Section>('For you');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [albums, setAlbums] = useState<MusicAlbum[]>([]);
  const [history, setHistory] = useState<PlayRecord[]>([]);
  const [recent, setRecent] = useState<MusicTrack[]>([]);
  const [fresh, setFresh] = useState<MusicTrack[]>([]);
  const [activeSearches, setActiveSearches] = useState<searches.Search[]>([]);
  const [source, setSource] = useState<MusicTrack | null>(null);
  const [candidates, setCandidates] = useState<MusicTrack[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<MusicTrack | null>(null);
  const [adding, setAdding] = useState<MusicTrack | null>(null);
  const [actionTrack, setActionTrack] = useState<MusicTrack | null>(null);
  const [viewingCrate, setViewingCrate] = useState<OfflineCrate | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notes = useDiscoveryStore(state => state.notes);
  const wishes = useDiscoveryStore(state => state.wishes);
  const dismissed = useDiscoveryStore(state => state.dismissed);
  const syncError = useDiscoveryStore(state => state.error);
  const pending = useDiscoveryStore(state => state.pending);
  const conflicts = useDiscoveryStore(state => state.conflicts);
  const offline = useOfflineCrates();
  const playlists = useMixtapeStore(state => state.mixtapes);
  const playStats = useLibraryActivityStore(state => state.playStats);
  const downloads = useTransferStore(state => state.downloads);
  const openServerLibrary = (playlistId?: string) => {
    // Discover contains server content even when Library last showed device music.
    void useLibrarySettings.getState().setIncludeLocalLibrary(false);
    if (playlistId) nav.navigate('LibraryTab', { screen: 'PlaylistDetail', params: { playlistId }, initial: false });
    else nav.navigate('LibraryTab', { screen: 'LibraryHome' });
  };
  const perform = async (action: () => Promise<unknown>) => {
    if (working) return;
    const current = sessionGuard(); setWorking(true); setError(null);
    try { await action(); if (current()) haptics.light(); }
    catch (reason) { if (current()) setError((reason as Error).message); }
    finally { if (current()) setWorking(false); }
  };
  const load = useCallback(async () => {
    const current = sessionGuard(); setLoading(true); setError(null); setRefreshedAt(Date.now());
    const results = await Promise.allSettled([
      getTracks({ limit: 100, sort: 'title' }), getRecentlyAdded(12), getPlayHistory(20),
      searches.getAll(), useMixtapeStore.getState().load(), useDiscoveryStore.getState().sync(),
      useTransferStore.getState().loadDownloads(),
    ]);
    if (!current()) return;
    const [library, arrivals, plays, searchRows] = results;
    if (library.status === 'fulfilled') setTracks(library.value.tracks);
    if (arrivals.status === 'fulfilled') {
      setAlbums(arrivals.value);
      const pages = await Promise.allSettled(arrivals.value.slice(0, 3).map(album => getTracks({ limit: 20, ...albumTrackParams(album) })));
      if (!current()) return;
      setFresh([...new Map(pages.flatMap(page => page.status === 'fulfilled' ? page.value.tracks : []).map(track => [track.path, track])).values()]);
    }
    if (plays.status === 'fulfilled') {
      setHistory(plays.value);
      try { const resolved = await discovery.resolveTracks([...new Set(plays.value.map(play => play.path))]); if (current()) setRecent(resolved); } catch { /* History remains visible on partial failure. */ }
    }
    if (!current()) return;
    if (searchRows.status === 'fulfilled') setActiveSearches(searchRows.value);
    if (library.status === 'rejected') setError('Could not refresh the library. Downloaded crates remain available in Offline.');
    setLoading(false);
    const savedWishes = useDiscoveryStore.getState().wishes;
    if (savedWishes.length) {
      try { const rows = await refreshWantedSearches(savedWishes); if (current()) setActiveSearches(rows); }
      catch { if (current()) setError('Saved searches could not be rechecked. Pull to refresh when connected.'); }
    }
  }, []);
  useEffect(() => {
    useDiscoveryStore.getState().hydrate(); useOfflineCrates.getState().hydrate();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void useDiscoveryStore.getState().sync(); });
    return () => sub.remove();
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { if (connection === 'connected') void useDiscoveryStore.getState().sync(); }, [connection]);
  useEffect(() => {
    if (!route.params?.track) return;
    const requested = route.params.track;
    if (route.params.section === 'Prepare') { setEditing(requested); setSection('Prepare'); }
    else { setSource(requested); setSection('Matches'); }
    nav.setParams({ track: undefined, section: undefined });
  }, [route.params, nav]);
  useEffect(() => {
    if (!source) return;
    const current = sessionGuard(); let cancelled = false;
    setCandidates([]);
    getTracks({ limit: 500, ...(source.bpm ? { bpmMin: source.bpm * .94, bpmMax: source.bpm * 1.06 } : {}) })
      .then(page => { if (current() && !cancelled) setCandidates(page.tracks); })
      .catch(() => { if (current() && !cancelled) setError('Could not load matching candidates. Pull to refresh and try again.'); });
    return () => { cancelled = true; };
  }, [source]);
  const matches = useMemo(() => source ? suggestMixes(source, candidates) : [], [source, candidates]);
  const unheard = fresh.filter(track => !playStats.has(track.path) && !dismissed.includes(track.path));
  const forgotten = tracks.filter(track => {
    const last = playStats.get(track.path)?.lastPlayedAt;
    return last != null && refreshedAt - last > 90 * 86400000;
  }).slice(0, 6);
  const featured = player.track ?? recent.find(track => track.path === history[0]?.path) ?? fresh[0] ?? tracks[0] ?? null;
  const statusMessage = error || offline.error || syncError;
  const statusLabel = error ? 'Library refresh unavailable' : offline.error ? 'Check offline downloads' : syncError?.includes('404') ? 'Notes sync needs a server update' : 'Notes waiting to sync';
  function art(track: MusicTrack, size = 48) {
    return <View style={[s.art, { width: size, height: size }]}>{track.hasArtwork ? <Image source={{ uri: getArtworkUrl(track.path, ARTWORK_THUMB_SIZE) ?? undefined, cacheKey: getArtworkCacheKey(track.path, ARTWORK_THUMB_SIZE) }} style={{ width: size, height: size, borderRadius: 1 }} /> : <Text style={s.artNote}>♫</Text>}</View>;
  }
  function button(label: string, onPress: () => void, subtle = false) {
    return <Pressable accessibilityRole="button" disabled={working} onPress={() => { haptics.selection(); onPress(); }} style={({ pressed }) => [s.button, subtle && s.subtle, pressed && { opacity: .65, transform: [{ scale: .97 }] }, working && { opacity: .5 }]}><Text style={[s.buttonText, subtle && { color: colors.textPrimary }]}>{label}</Text></Pressable>;
  }
  function row(track: MusicTrack, detail?: string) {
    return <View key={track.path} style={s.row}>
      <Pressable accessibilityLabel={`Play ${getTrackTitle(track)}`} onPress={() => { haptics.light(); player.playTrack(track); }} style={s.track}>{art(track)}<View style={s.grow}><Text numberOfLines={1} style={s.trackTitle}>{getTrackTitle(track)}</Text><Text numberOfLines={2} style={s.muted}>{detail ?? [track.artist, track.bpm && `${track.bpm} BPM`, track.key].filter(Boolean).join(' · ')}</Text></View></Pressable>
      <Pressable accessibilityLabel={`Actions for ${getTrackTitle(track)}`} hitSlop={12} onPress={() => { haptics.selection(); setActionTrack(track); }}><Text style={s.more}>•••</Text></Pressable>
    </View>;
  }
  const heading = (title: string, subtitle?: string) => <View style={s.sectionHeading}><Text style={s.h2}>{title}</Text>{subtitle && <Text style={s.muted}>{subtitle}</Text>}</View>;
  const empty = (message: string) => <Text style={s.empty}>{message}</Text>;
  const openSearch = async (text: string) => {
    const id = newSearchId();
    await searches.create(id, text);
    nav.navigate('SearchTab', { screen: 'SearchResults', params: { searchId: id, searchText: text } });
  };
  return <SafeAreaView edges={['top']} style={s.screen}>
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.accent} />} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.masthead}>
        <Text accessibilityRole="header" style={s.wordmark}>RESONANCE</Text>
        <View accessible={false} style={s.recordMark}><View style={s.recordGroove}><View style={s.recordLabel}><View style={s.recordHole} /></View></View></View>
      </View>
      <View style={s.imprint}><Text style={s.imprintText}>PERSONAL MUSIC LIBRARY</Text><View style={s.connection}><View style={[s.connectionDot, { backgroundColor: connection === 'connected' ? colors.success : colors.warning }]} /><Text style={s.imprintText}>{connection === 'connected' ? 'ONLINE' : connection.toUpperCase()}</Text></View></View>
      <View style={s.tabs}>{sections.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityLabel={sectionLabels[item]} accessibilityState={{ selected: section === item }} onPress={() => { haptics.selection(); setSection(item); }} style={[s.sectionTab, section === item && { borderBottomColor: colors.accent }]}><Text style={[s.tabText, section === item && { color: colors.accent }]}>{sectionLabels[item]}</Text></Pressable>)}</View>
      {statusMessage && <Pressable accessibilityRole="button" accessibilityLabel={`${statusLabel}. Show details`} onPress={() => Alert.alert('Connection details', syncError?.includes('404') && !error && !offline.error ? 'This server needs updating before preparation notes and saved searches can sync. Your library and playback are available.' : statusMessage, [{ text: 'Close', style: 'cancel' }, { text: 'Retry', onPress: () => void load() }])} style={s.notice}><Ionicons name="information-circle-outline" size={14} color={colors.textMuted} /><Text numberOfLines={1} style={s.noticeText}>{statusLabel}</Text><Text style={s.noticeArrow}>↗</Text></Pressable>}
      {working && <ActivityIndicator color={colors.accent} />}
      {section === 'For you' && <>
        {featured ? <View style={s.feature}>
          <View style={s.featureTop}><Text style={s.eyebrow}>{player.track ? 'ON THE DECK' : recent.some(track => track.path === featured.path) ? 'LAST PLAYED' : 'FROM THE COLLECTION'}</Text><Text style={s.catalogueCode}>{featured.filename.split('.').pop()?.toUpperCase() ?? 'AUDIO'}</Text></View>
          <View style={s.featureBody}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Play ${getTrackTitle(featured)}`} style={s.featureArt} onPress={() => { haptics.light(); player.playTrack(featured); }}>
              {featured.hasArtwork ? <Image source={{ uri: getArtworkUrl(featured.path, PLAYER_ART_SIZE) ?? undefined, cacheKey: getArtworkCacheKey(featured.path, PLAYER_ART_SIZE) }} contentFit="cover" style={StyleSheet.absoluteFill} transition={150} /> : <View style={s.featureFallback}><Ionicons name="disc-outline" size={100} color={colors.textMuted} /></View>}
            </Pressable>
            <View style={s.featureSide}>
              <View><Text style={s.dataLabel}>TEMPO</Text><Text style={s.dataValue}>{featured.bpm ?? '—'}</Text><Text style={s.dataUnit}>BPM</Text></View>
              <View><Text style={s.dataLabel}>KEY</Text><Text style={s.dataValue}>{featured.key ?? '—'}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={player.track?.path === featured.path && isPlaying ? 'Pause record' : 'Play record'} style={({ pressed }) => [s.playRecord, pressed && { opacity: .65 }]} onPress={() => { haptics.light(); if (player.track?.path === featured.path) player.togglePlayPause(); else player.playTrack(featured); }}><Ionicons name={player.track?.path === featured.path && isPlaying ? 'pause' : 'play'} size={24} color={colors.bgPrimary} /></Pressable>
            </View>
          </View>
          <Text numberOfLines={2} style={s.featureTitle}>{getTrackTitle(featured)}</Text>
          <View style={s.featureFooter}><Text numberOfLines={1} style={s.featureArtist}>{featured.artist || 'Unknown artist'}</Text><Pressable accessibilityRole="button" onPress={() => { setSource(featured); setSection('Matches'); }} hitSlop={10}><Text style={s.matchLink}>FIND A MATCH ↗</Text></Pressable></View>
        </View> : <View style={s.welcome}><Text style={s.h2}>Your collection starts here.</Text><Text style={s.muted}>Browse your library or search for a record.</Text>{button('Open library', () => openServerLibrary())}</View>}
        {heading('New arrivals')}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shelf}>{albums.map((album, index) => <Pressable key={`${album.directory}-${index}`} style={s.album} onPress={() => void perform(async () => { const page = await getTracks({ limit: 200, ...albumTrackParams(album) }); await player.playQueue(page.tracks); })}>
          <Text style={s.sleeveIndex}>{String(index + 1).padStart(2, '0')} / {album.year ?? '—'}</Text><View style={s.albumArt}>{album.hasArtwork ? <Image source={{ uri: getArtworkUrl(album.coverPath, 384) ?? undefined, cacheKey: album.coverPath ? getArtworkCacheKey(album.coverPath, 384) : undefined }} style={StyleSheet.absoluteFill} transition={180} /> : <Text style={s.albumNote}>♫</Text>}</View><Text numberOfLines={1} style={s.trackTitle}>{album.album}</Text><Text numberOfLines={1} style={s.muted}>{album.artist}</Text>
        </Pressable>)}</ScrollView>
        {!albums.length && empty('New albums will appear here as your library grows.')}
        {heading('Recently played')}
        {[...new Map(history.map(play => [play.path, play])).values()].slice(0, 4).map(play => recent.find(track => track.path === play.path)).filter((track): track is MusicTrack => !!track).map(track => row(track))}
        {!history.length && empty('Your listening history will appear here after your first play.')}
        {heading('Awaiting a first listen')}{unheard.slice(0, 5).map(track => row(track))}{!unheard.length && empty('You’re caught up with these fresh arrivals.')}
        {!!forgotten.length && <>{heading('Back in rotation', 'Played before, unheard for at least 90 days')}{forgotten.map(track => row(track))}</>}
        {heading('Your playlists')}
        {playlists.slice(0, 4).map(tape => <View key={tape.id} style={s.card}><Text style={s.h2}>{tape.name}</Text><Text style={s.muted}>{tape.tracks.length} tracks · updated {new Date(tape.updatedAt).toLocaleDateString()}</Text><View style={s.actions}>{button('Listen', () => void perform(async () => player.playQueue(await discovery.resolveTracks(tape.tracks.map(track => track.filePath)))))}{button('Open playlist', () => openServerLibrary(tape.id), true)}</View></View>)}
        {!playlists.length && empty('Create a playlist in Library, or add a discovery using its ••• menu.')}
      </>}
      {section === 'Matches' && <>
        {heading('Find a match', 'Tempo, key and analysed energy.')}
        {player.track && button('Use the playing track', () => setSource(player.track), true)}
        {source ? <View style={s.card}>{row(source, 'YOUR STARTING POINT')}{button('Choose another track', () => { setSource(null); setFilter(''); }, true)}</View> : <>
          <TextInput accessibilityLabel="Find a starting track" placeholder="Find a starting track…" placeholderTextColor={colors.textMuted} style={s.input} value={filter} onChangeText={setFilter} onSubmitEditing={() => void perform(async () => { const page = await getTracks({ search: filter, limit: 100 }); setTracks(page.tracks); })} returnKeyType="search" />
          {button('Search library', () => void perform(async () => { const page = await getTracks({ search: filter, limit: 100 }); setTracks(page.tracks); }), true)}
          {tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 15).map(track => <Pressable key={track.path} style={s.row} onPress={() => setSource(track)}>{art(track)}<View style={s.grow}><Text style={s.trackTitle}>{getTrackTitle(track)}</Text><Text style={s.muted}>{track.artist}</Text></View><Text style={s.more}>↗</Text></Pressable>)}
        </>}
        {source && <>{matches.map(match => row(match.track, match.reasons.join(' · ')))}{!matches.length && empty('No supported matches yet. Try an analysed track with BPM and key. Suggestions examine up to 500 candidates near its tempo.')}{!!matches.length && <Text style={s.muted}>Tap to audition; use ••• to queue or add to a playlist. Your ears make the final call.</Text>}</>}
      </>}
      {section === 'Digging' && <>
        {heading('Saved searches', 'Rechecked daily when you open Discover.')}
        <TextInput accessibilityLabel="Wanted release or saved search" value={query} onChangeText={setQuery} placeholder="Artist, release, or something to hunt for…" placeholderTextColor={colors.textMuted} style={s.input} maxLength={300} />
        <View style={s.actions}>{button('Save search', () => void perform(async () => { await discovery.addWish(query); setQuery(''); await useDiscoveryStore.getState().sync(); }))}{query.trim() && button('Search now', () => void perform(() => openSearch(query)), true)}</View>
        {wishes.map(wish => <View key={wish.id} style={s.card}><Text style={s.trackTitle}>{wish.query}</Text><View style={s.actions}>{button('Look for matches', () => void perform(() => openSearch(wish.query)))}{button('Remove', () => void perform(async () => { await discovery.removeWish(wish.id); await useDiscoveryStore.getState().sync(); }), true)}</View></View>)}
        {heading('Search activity')}{activeSearches.slice(0, 10).map(search => <Pressable key={search.id} style={s.card} onPress={() => nav.navigate('SearchTab', { screen: 'SearchResults', params: { searchId: search.id, searchText: search.searchText } })}><Text style={s.trackTitle}>{search.searchText}</Text><Text style={s.muted}>{search.fileCount} files · {search.isComplete ? 'Ready to explore' : 'Searching…'}</Text></Pressable>)}
        {heading('Ready to audition', 'New library tracks you have not played; ••• to keep in a playlist or dismiss.')}{unheard.slice(0, 20).map(track => row(track))}{!unheard.length && empty('No unheard arrivals in the current selection.')}
        {heading('Completed server downloads')}{downloads.filter(transfer => transfer.percentComplete >= 100 && !transfer.exception).slice(0, 10).map(transfer => <View key={transfer.id} style={s.card}><Text style={s.trackTitle}>{transfer.filename.split(/[\\/]/).pop()}</Text><Text style={s.muted}>From {transfer.username} · available after server library indexing</Text>{button('Find in library', () => { setFilter(transfer.filename.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? ''); setSection('Matches'); }, true)}</View>)}
      </>}
      {section === 'Prepare' && <>
        {heading('Preparation', 'Set roles, listening notes and bookmarks.')}
        <Text style={s.muted}>{Object.keys(pending).length ? `${Object.keys(pending).length} edits waiting to sync` : 'All saved edits synced'} · Bookmarks are listening markers, not exported deck hot cues.</Text>
        {Object.entries(conflicts).map(([path, remote]) => <View key={path} style={s.card}>
          <Text style={s.trackTitle}>Review a note conflict</Text><Text style={s.muted}>{path.split(/[\\/]/).pop()}</Text>
          <Text style={s.muted}>Phone: {pending[path]?.notes || '(no text)'} · {pending[path]?.bookmarks.length ?? 0} bookmarks</Text>
          <Text style={s.muted}>Server: {remote.notes || '(no text)'} · {remote.bookmarks.length} bookmarks</Text>
          <View style={s.actions}>{button('Keep phone version', () => void perform(() => useDiscoveryStore.getState().resolveConflict(path, true)))}{button('Use server version', () => void perform(() => useDiscoveryStore.getState().resolveConflict(path, false)), true)}</View>
        </View>)}
        {player.track && <View style={s.card}>{row(player.track)}{button('Prepare the playing track', () => setEditing(player.track))}</View>}
        {Object.values(notes).map(note => {
          const track = [...tracks, ...fresh, ...recent, ...offline.crates.flatMap(crate => crate.tracks)].find(item => item.path === note.path);
          return <Pressable key={note.path} style={s.card} onPress={() => void perform(async () => { const resolved = track ?? (await discovery.resolveTracks([note.path]))[0]; if (resolved) setEditing(resolved); else throw new Error('Track is no longer available.'); })}><Text style={s.trackTitle}>{track ? getTrackTitle(track) : note.path.split(/[\\/]/).pop()}</Text><Text style={s.eyebrow}>{note.role || 'UNASSIGNED'} · {note.bookmarks.length} bookmarks</Text><Text numberOfLines={3} style={s.muted}>{note.notes || 'Tap to add listening notes'}</Text></Pressable>;
        })}
        {!Object.keys(notes).length && empty('Play a track, then capture a note here. You can also prepare any discovery from its ••• menu.')}
        {button('Sync now', () => void perform(() => useDiscoveryStore.getState().sync()), true)}
      </>}
      {section === 'Offline' && <>
        {heading('Offline crates', 'Original audio stored on this phone.')}
        <Text style={s.muted}>{(offline.crates.reduce((total, crate) => total + crate.bytes, 0) / 1048576).toFixed(1)} MB used · {offline.crates.length} crates</Text>
        {offline.busy && <View style={s.card}><Text style={s.trackTitle}>Downloading · {Math.round(offline.progress * 100)}%</Text><View style={s.progress}><View style={{ height: 4, width: `${offline.progress * 100}%`, backgroundColor: colors.accent }} /></View>{button('Cancel download', offline.cancel, true)}</View>}
        {offline.crates.map(crate => <View key={crate.id} style={s.card}><Text style={s.h2}>{crate.name}</Text><Text style={s.muted}>{crate.tracks.length} tracks · {(crate.bytes / 1048576).toFixed(1)} MB · saved {new Date(crate.downloadedAt).toLocaleDateString()}</Text><View style={s.actions}>{button('Play offline', () => player.playQueue(crate.tracks))}{button('Remove audio', () => Alert.alert('Remove downloaded audio?', 'The server playlist and preparation notes are kept.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => offline.remove(crate.id) }]), true)}</View>{crate.tracks.slice(0, 3).map(track => row(track))}{button('Browse all downloaded tracks', () => setViewingCrate(crate), true)}</View>)}
        {heading('Available playlists', 'Downloading uses your current connection and may use mobile data.')}
        {playlists.map(tape => <View key={tape.id} style={s.card}><Text style={s.trackTitle}>{tape.name}</Text><Text style={s.muted}>{tape.tracks.length} tracks</Text>{button(offline.crates.some(crate => crate.id === tape.id) ? 'Refresh downloaded crate' : 'Download original audio', () => void perform(async () => {
          if (offline.busy) throw new Error('A crate is already downloading.');
          const resolved = await discovery.resolveTracks(tape.tracks.map(track => track.filePath));
          const byPath = new Map(resolved.map(track => [track.path, track]));
          const ordered = tape.tracks.map(track => byPath.get(track.filePath)).filter((track): track is MusicTrack => !!track);
          if (ordered.length !== tape.tracks.length) throw new Error('Some tracks are missing from the server library. Update this playlist before downloading.');
          // Download owns its busy state so cancellation stays available.
          void offline.download(tape.id, tape.name, ordered);
        }), true)}</View>)}
        {!playlists.length && empty('Create a playlist or add a discovery to a new one, then download it here.')}
      </>}
    </ScrollView>
    <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} visible={!!actionTrack} transparent animationType="slide" onRequestClose={() => setActionTrack(null)}><View style={s.backdrop}><SafeAreaView edges={['bottom']} style={s.sheet}>
      <Text style={s.h2}>{actionTrack ? getTrackTitle(actionTrack) : ''}</Text>
      {button('Find matching tracks', () => { setSource(actionTrack); setSection('Matches'); setActionTrack(null); }, true)}
      {button('Add to playlist', () => { setAdding(actionTrack); setActionTrack(null); }, true)}
      {button('Notes & bookmarks', () => { setEditing(actionTrack); setActionTrack(null); }, true)}
      {button('Add to queue', () => { if (actionTrack) player.addToQueue([actionTrack]); setActionTrack(null); }, true)}
      {button('Dismiss from digging', () => { if (actionTrack) useDiscoveryStore.getState().dismiss(actionTrack.path); setActionTrack(null); }, true)}
      {button('Cancel', () => setActionTrack(null), true)}
    </SafeAreaView></View></Modal>
    <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} visible={!!adding} transparent animationType="slide" onRequestClose={() => setAdding(null)}><View style={s.backdrop}><View style={s.sheet}><Text style={s.h2}>Add to a playlist</Text><ScrollView style={{ maxHeight: 320 }}>{playlists.map(tape => <Pressable disabled={working} key={tape.id} style={s.row} onPress={() => void perform(async () => { if (adding) await useMixtapeStore.getState().addTrack(tape.id, adding.path); setAdding(null); })}><Text style={s.trackTitle}>{tape.name}</Text></Pressable>)}</ScrollView>{button('Create a discoveries playlist', () => void perform(async () => { const tape = await useMixtapeStore.getState().create('Discoveries'); if (adding) await useMixtapeStore.getState().addTrack(tape.id, adding.path); setAdding(null); }))}{button('Cancel', () => setAdding(null), true)}</View></View></Modal>
    <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} visible={!!viewingCrate} animationType="slide" onRequestClose={() => setViewingCrate(null)}>
      <SafeAreaView style={s.screen}><View style={{ padding: 20, flex: 1 }}><Text style={s.h2}>{viewingCrate?.name}</Text>{button('Close crate', () => setViewingCrate(null), true)}
        <FlatList data={viewingCrate?.tracks ?? []} keyExtractor={(track, index) => `${track.path}-${index}`} renderItem={({ item, index }) => <Pressable style={s.row} onPress={() => { if (viewingCrate) player.playQueue(viewingCrate.tracks, index); }}><View style={s.grow}><Text style={s.trackTitle}>{getTrackTitle(item)}</Text><Text style={s.muted}>{item.artist}</Text></View><Text style={s.more}>▶</Text></Pressable>} />
      </View></SafeAreaView>
    </Modal>
    {editing && <PreparationEditor key={editing.path} track={editing} onClose={() => setEditing(null)} />}
  </SafeAreaView>;
}

function PreparationEditor({ track, onClose }: { track: MusicTrack; onClose: () => void }) {
  const { colors } = useTheme(); const s = styles(colors);
  const player = usePlayer(); const { positionSec } = usePlaybackPosition();
  const existing = useDiscoveryStore.getState().notes[track.path];
  const [note, setNote] = useState<discovery.TrackPreparation>(existing ?? { path: track.path, role: '', notes: '', bookmarks: [], revision: 0 });
  const [saving, setSaving] = useState(false);
  const [bookmarkLabel, setBookmarkLabel] = useState('');
  const current = player.track?.path === track.path;
  return <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} visible transparent animationType="slide" onRequestClose={onClose}><View style={s.backdrop}><SafeAreaView edges={['bottom']} style={s.sheet}><ScrollView keyboardShouldPersistTaps="handled"><Text style={s.eyebrow}>PREPARE A RECORD</Text><Text style={s.h2}>{getTrackTitle(track)}</Text><Text style={s.muted}>{track.artist}</Text><View style={s.actions}>{[['', 'No role'], ['opener', 'Opener'], ['peak', 'Peak time'], ['closer', 'Closer']].map(([value, label]) => <Pressable key={value} onPress={() => setNote({ ...note, role: value })} style={[s.pill, note.role === value && { borderColor: colors.textPrimary, backgroundColor: colors.textPrimary }]}><Text style={[s.pillText, note.role === value && { color: colors.bgPrimary }]}>{label}</Text></Pressable>)}</View>
    <TextInput accessibilityLabel="Listening notes" value={note.notes} onChangeText={notes => setNote({ ...note, notes })} placeholder="What makes this record work?" placeholderTextColor={colors.textMuted} multiline maxLength={10000} style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} />
    <TextInput accessibilityLabel="Bookmark label" value={bookmarkLabel} onChangeText={setBookmarkLabel} placeholder="Bookmark label (optional)" placeholderTextColor={colors.textMuted} style={s.input} maxLength={200} />
    <Pressable disabled={!current || note.bookmarks.length >= 100} style={[s.button, !current && { opacity: .4 }]} onPress={() => { haptics.light(); setNote({ ...note, bookmarks: [...note.bookmarks, { id: `${Date.now()}-${Math.random()}`, seconds: positionSec, label: bookmarkLabel.trim() || 'Listening marker' }] }); setBookmarkLabel(''); }}><Text style={s.buttonText}>{current ? `Bookmark ${Math.floor(positionSec / 60)}:${String(Math.floor(positionSec % 60)).padStart(2, '0')}` : 'Play this track to bookmark a moment'}</Text></Pressable>
    {note.bookmarks.map(cue => <View key={cue.id} style={s.row}><Pressable style={s.grow} disabled={!current} onPress={() => player.seekTo(cue.seconds)}><Text style={s.trackTitle}>{Math.floor(cue.seconds / 60)}:{String(Math.floor(cue.seconds % 60)).padStart(2, '0')} · {cue.label}</Text></Pressable><Pressable accessibilityLabel={`Remove ${cue.label}`} onPress={() => setNote({ ...note, bookmarks: note.bookmarks.filter(item => item.id !== cue.id) })}><Text style={s.more}>×</Text></Pressable></View>)}
    <View style={s.actions}><Pressable disabled={saving} style={s.button} onPress={async () => { setSaving(true); try { await useDiscoveryStore.getState().save(note); haptics.light(); onClose(); } catch (error) { Alert.alert('Could not save', (error as Error).message); } finally { setSaving(false); } }}><Text style={s.buttonText}>{saving ? 'Saving…' : 'Save preparation'}</Text></Pressable><Pressable disabled={saving} style={[s.button, s.subtle]} onPress={onClose}><Text style={s.trackTitle}>Cancel</Text></Pressable></View></ScrollView></SafeAreaView></View></Modal>;
}

function styles(c: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgPrimary },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32, gap: 0 },
  masthead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: c.textPrimary },
  wordmark: { flexShrink: 1, fontFamily: Typography.display, color: c.textPrimary, fontSize: 46, lineHeight: 52, letterSpacing: -1.6 },
  recordMark: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: c.textPrimary, alignItems: 'center', justifyContent: 'center' },
  recordGroove: { width: 29, height: 29, borderRadius: 15, borderWidth: 1, borderColor: c.textPrimary, alignItems: 'center', justifyContent: 'center' },
  recordLabel: { width: 17, height: 17, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  recordHole: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.bgPrimary },
  imprint: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 9 },
  imprintText: { fontFamily: Typography.mono, color: c.textMuted, fontSize: 9, letterSpacing: .7 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connectionDot: { width: 5, height: 5, borderRadius: 3 },
  eyebrow: { color: c.accent, fontFamily: Typography.mono, fontSize: 10, fontWeight: '600', letterSpacing: 1.2 },
  h2: { color: c.textPrimary, fontFamily: Typography.display, fontSize: 25, fontWeight: '700', letterSpacing: -.4 },
  muted: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.borderStrong, marginBottom: 14 },
  sectionTab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabText: { fontFamily: Typography.mono, color: c.textMuted, fontSize: 11, fontWeight: '500' },
  pill: { borderWidth: 1, borderColor: c.borderStrong, paddingVertical: 10, paddingHorizontal: 12 },
  pillText: { color: c.textMuted, fontFamily: Typography.mono, fontSize: 11, fontWeight: '600' },
  feature: { paddingTop: 8, paddingBottom: 20 },
  featureTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  catalogueCode: { fontFamily: Typography.mono, fontSize: 10, color: c.textMuted, letterSpacing: .8 },
  featureBody: { flexDirection: 'row', gap: 20, alignItems: 'stretch' },
  featureArt: { flex: 1, aspectRatio: 1, backgroundColor: c.bgElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  featureFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  featureSide: { width: 66, justifyContent: 'space-between', gap: 10 },
  dataLabel: { fontFamily: Typography.mono, color: c.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 2 },
  dataValue: { fontFamily: Typography.display, color: c.textPrimary, fontSize: 32, lineHeight: 36 },
  dataUnit: { fontFamily: Typography.mono, color: c.textMuted, fontSize: 9 },
  playRecord: { width: 48, height: 48, backgroundColor: c.textPrimary, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontFamily: Typography.display, fontSize: 29, lineHeight: 32, color: c.textPrimary, marginTop: 14 },
  featureFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 7 },
  featureArtist: { flex: 1, fontSize: 12, color: c.textMuted },
  matchLink: { fontFamily: Typography.mono, fontSize: 9, letterSpacing: .3, color: c.accent, paddingVertical: 5 },
  welcome: { paddingVertical: 24, gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  button: { backgroundColor: c.textPrimary, borderWidth: 1, borderColor: c.textPrimary, paddingVertical: 12, paddingHorizontal: 15, minHeight: 44, alignSelf: 'flex-start', marginVertical: 4 },
  buttonText: { color: c.bgPrimary, fontFamily: Typography.mono, fontWeight: '600', fontSize: 11 },
  subtle: { backgroundColor: 'transparent', borderColor: c.borderStrong },
  card: { paddingVertical: 16, gap: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  sectionHeading: { marginTop: 16, paddingTop: 14, paddingBottom: 6, borderTopWidth: 1, borderTopColor: c.borderStrong, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  track: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 }, trackTitle: { color: c.textPrimary, fontSize: 13, fontWeight: '600' },
  more: { color: c.textMuted, fontSize: 16, padding: 10 },
  art: { backgroundColor: c.bgElevated, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  artNote: { color: c.textMuted, fontSize: 25 },
  shelf: { gap: 14, paddingTop: 6, paddingBottom: 10 },
  sleeveIndex: { fontFamily: Typography.mono, fontSize: 9, letterSpacing: .5, color: c.textMuted },
  album: { width: 158, gap: 7 },
  albumArt: { width: 158, height: 158, overflow: 'hidden', backgroundColor: c.bgElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  albumNote: { fontSize: 54, color: c.textMuted },
  empty: { color: c.textMuted, fontSize: 12, lineHeight: 19, paddingVertical: 16 },
  input: { backgroundColor: c.bgSurface, borderBottomWidth: 1, borderBottomColor: c.textPrimary, padding: 13, color: c.textPrimary, marginVertical: 10 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 12 },
  noticeText: { flex: 1, color: c.textMuted, fontSize: 10, fontFamily: Typography.mono },
  noticeArrow: { color: c.textMuted, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgPrimary, borderTopWidth: 2, borderTopColor: c.textPrimary, padding: 24, maxHeight: '90%', gap: 8 },
  progress: { height: 3, backgroundColor: c.bgElevated, overflow: 'hidden', marginVertical: 12 },
}); }
