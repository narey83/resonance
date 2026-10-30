import { Text } from '../../components/Typography';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { apiClient } from '../../api/client';
import { seedTrackSignatures, getTrackTitle, type MusicTrack } from '../../api/musicLibrary';
import { useTheme } from '../../context/ThemeContext';
import { LEAD_IN, MAX_QUEUE, usePlayer } from '../../context/PlayerContext';
import { useLibraryActivityStore } from '../../store/libraryActivityStore';
import { Editorial } from '../../theme';

type Crate = { id: string; name: string; description: string; collection?: string; trackCount: number };
const groups = ['All', 'Genre', 'Key', 'BPM', 'Saved'];

export default function SmartCratesTab() {
  const { colors: c } = useTheme();
  const player = usePlayer();
  const revision = useLibraryActivityStore((state) => state.libraryRevision);
  const [crates, setCrates] = useState<Crate[]>([]);
  const [group, setGroup] = useState('All');
  const [selected, setSelected] = useState<Crate | null>(null);
  const [page, setPage] = useState(0);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [collectionRevision, setCollectionRevision] = useState(0);
  const [trackError, setTrackError] = useState('');
  const [error, setError] = useState('');
  const playbackRequestRef = useRef(0);
  useEffect(() => () => { playbackRequestRef.current++; }, [selected, page]);
  const playFromCrate = async (track: MusicTrack, index: number) => {
    if (!selected) return;
    const request = ++playbackRequestRef.current;
    setTrackError('');
    try {
      const { data } = await apiClient.get<{ tracks: MusicTrack[]; total: number }>(
        `/musiclibrary/crates/${encodeURIComponent(selected.id)}/tracks`,
        { params: { limit: MAX_QUEUE, offset: Math.max(0, page * 100 + index - LEAD_IN), sort: 'title' } },
      );
      if (request !== playbackRequestRef.current) return;
      const selectedIndex = data.tracks.findIndex((item) => item.path === track.path);
      if (selectedIndex < 0) {
        setTrackError('This track is no longer in this crate. Refresh and try again.');
        return;
      }
      seedTrackSignatures(data.tracks);
      await player.playQueue(data.tracks, selectedIndex);
    } catch {
      if (request === playbackRequestRef.current)
        setTrackError('Could not load the crate playback queue. Please try again.');
    }
  };
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const { data } = await apiClient.get('/musiclibrary/crates');
        if (!cancelled) {
          setCrates(data.crates);
          setCollectionRevision((n) => n + 1);
          setError('');
        }
      } catch {
        if (!cancelled) setError('Could not refresh smart crates. Check your server connection.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(load, 30_000);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [revision, refresh]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setTracksLoading(true);
    apiClient
      .get(`/musiclibrary/crates/${encodeURIComponent(selected.id)}/tracks`, {
        params: { limit: 100, offset: page * 100, sort: 'title' },
      })
      .then(({ data }) => {
        if (cancelled) return;
        seedTrackSignatures(data.tracks);
        setTracks(data.tracks);
        setTotal(data.total);
        setTrackError('');
        const lastPage = Math.max(0, Math.ceil(data.total / 100) - 1);
        if (page > lastPage) setPage(lastPage);
      })
      .catch(() => {
        if (!cancelled) {
          setTracks([]);
          setTrackError('Could not load this crate. Refresh to try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setTracksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, page, collectionRevision]);
  const visible = useMemo(
    () =>
      crates.filter(
        (crate) => group === 'All' || (group === 'Saved' ? !crate.collection : crate.collection === group),
      ),
    [crates, group],
  );
  const action = { padding: 12, borderWidth: 1, borderColor: c.borderStrong, ...Editorial.control };
  return (
    <View style={{ flex: 1, backgroundColor: c.bgPrimary, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={() => {
            setSelected(null);
            setTracks([]);
          }}
          disabled={!selected}
          accessibilityRole="button"
        >
          <Text style={{ color: c.textPrimary, fontSize: 22, ...Editorial.heading }}>
            {selected ? `‹ ${selected.name}` : 'Smart crates'}
          </Text>
        </Pressable>
        <Pressable onPress={() => setRefresh((n) => n + 1)} accessibilityRole="button" style={action}>
          <Text style={{ color: c.accent }}>Refresh</Text>
        </Pressable>
      </View>
      <Text style={{ color: c.textMuted }}>
        Updates after saved basic or enhanced analysis. Missing results stay unknown.
      </Text>
      {!!(selected ? trackError : error) && (
        <Text accessibilityRole="alert" style={{ color: c.danger }}>
          {selected ? trackError : error}
        </Text>
      )}
      {(selected ? tracksLoading : loading) && <ActivityIndicator color={c.accent} />}
      {!selected ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {groups.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: group === item }}
                onPress={() => setGroup(item)}
                style={[action, group === item && { borderColor: c.accent }]}
              >
                <Text style={{ color: group === item ? c.accent : c.textPrimary }}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              !loading ? (
                <Text style={{ color: c.textMuted }}>
                  No matching collections yet. Analyse tracks to populate Genre, Key and BPM.
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setPage(0);
                  setTracks([]);
                  setTotal(item.trackCount);
                  setTrackError('');
                  setSelected(item);
                }}
                style={{ paddingVertical: 16, borderBottomWidth: 1, borderColor: c.border }}
              >
                <Text style={{ fontSize: 18, color: c.textPrimary, ...Editorial.heading }}>{item.name}</Text>
                <Text style={{ color: c.textMuted }}>
                  {item.collection ?? 'Saved crate'} · {item.trackCount} tracks
                </Text>
              </Pressable>
            )}
          />
        </>
      ) : (
        <>
          <Text style={{ color: c.textMuted }}>{total} matching tracks</Text>
          <FlatList
            data={tracks}
            keyExtractor={(item) => item.path}
            ListEmptyComponent={
              !tracksLoading && !trackError ? (
                <Text style={{ color: c.textMuted }}>No tracks currently match this crate.</Text>
              ) : null
            }
            renderItem={({ item, index }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Play ${getTrackTitle(item)}`}
                onPress={() => { void playFromCrate(item, index); }}
                style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: c.border }}
              >
                <Text numberOfLines={1} style={{ color: c.textPrimary }}>
                  {getTrackTitle(item)}
                </Text>
                <Text style={{ color: c.textMuted }}>
                  {item.artist} · {item.bpm ?? '—'} BPM · {item.key ?? '—'}
                </Text>
              </Pressable>
            )}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable
              disabled={page === 0 || tracksLoading}
              onPress={() => setPage((n) => n - 1)}
              style={action}
            >
              <Text style={{ color: page === 0 ? c.textDim : c.accent }}>Previous</Text>
            </Pressable>
            <Text style={{ color: c.textMuted }}>Page {page + 1}</Text>
            <Pressable
              disabled={(page + 1) * 100 >= total || tracksLoading}
              onPress={() => setPage((n) => n + 1)}
              style={action}
            >
              <Text style={{ color: (page + 1) * 100 >= total ? c.textDim : c.accent }}>Next</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
