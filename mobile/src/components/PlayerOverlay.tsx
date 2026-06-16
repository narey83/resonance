import { Ionicons } from '@expo/vector-icons';
import { CastButton } from 'react-native-google-cast';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaybackStatus, usePlayer } from '../context/PlayerContext';
import { useCast } from '../context/CastContext';
import { useTheme } from '../context/ThemeContext';
import { MusicTrack, getArtworkUrl, getTrackTitle } from '../api/musicLibrary';
import { getArtworkCacheKey } from '../services/artworkCache';
import { useMixtapeStore } from '../store/mixtapeStore';
import { useLibraryActivityStore } from '../store/libraryActivityStore';
import { usePlayerUI } from '../store/playerUIStore';
import { Radius, Spacing, ThemeColors, Typography } from '../theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HEADER_H     = Platform.select({ ios: 44, android: 56, default: 44 });
const ARTWORK_SIZE = Math.min(SCREEN_W - 64, Math.round(SCREEN_H * 0.38));
const SNAP_VELOCITY = 0.6;
const SNAP_DISTANCE = 80;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ── Progress bar ──────────────────────────────────────────────────────────────

const ProgressBar = ({
  positionSec, durationSec, onSeek,
}: { positionSec: number; durationSec: number; onSeek: (s: number) => void }) => {
  const [barWidth, setBarWidth] = useState(0);
  const progress = durationSec > 0 ? Math.min(positionSec / durationSec, 1) : 0;

  return (
    <View style={{ marginBottom: Spacing.lg }}>
      <View
        style={{ height: 32, justifyContent: 'center' }}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(e) => {
          if (barWidth > 0 && durationSec > 0) {
            const x = Math.max(0, Math.min(e.nativeEvent.locationX, barWidth));
            onSeek((x / barWidth) * durationSec);
          }
        }}
      >
        <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2 }} />
        <View style={{ position: 'absolute', height: 3, backgroundColor: '#fff', borderRadius: 2, width: `${progress * 100}%` }} />
        <View style={{
          position: 'absolute', width: 14, height: 14, borderRadius: 7,
          backgroundColor: '#fff', top: '50%', marginTop: -7, marginLeft: -7,
          left: `${progress * 100}%` as any,
        }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ fontSize: Typography.xs, color: 'rgba(255,255,255,0.5)' }}>{fmt(positionSec)}</Text>
        <Text style={{ fontSize: Typography.xs, color: 'rgba(255,255,255,0.5)' }}>{durationSec > 0 ? fmt(durationSec) : '--:--'}</Text>
      </View>
    </View>
  );
};

// ── Queue item ────────────────────────────────────────────────────────────────

function QueueItem({ track, index, isCurrent, onPress }: {
  track: MusicTrack; index: number; isCurrent: boolean; onPress: () => void;
}) {
  const title = getTrackTitle(track);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.md,
        backgroundColor: isCurrent ? 'rgba(255,255,255,0.1)' : pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
      })}
    >
      <Text style={{ width: 26, textAlign: 'right', fontSize: Typography.sm, color: isCurrent ? '#fff' : 'rgba(255,255,255,0.35)', fontVariant: ['tabular-nums'] }}>
        {index + 1}
      </Text>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: Typography.base, color: isCurrent ? '#fff' : 'rgba(255,255,255,0.8)', fontWeight: isCurrent ? '600' : '400' }}>
          {title}
        </Text>
        {track.artist ? (
          <Text numberOfLines={1} style={{ fontSize: Typography.sm, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
            {track.artist}
          </Text>
        ) : null}
      </View>
      {isCurrent && <Ionicons color="#fff" name="musical-note" size={16} />}
    </Pressable>
  );
}

// ── Mixtape picker modal ───────────────────────────────────────────────────────

function MixtapePickerModal({ visible, onClose, onSelect }: {
  visible: boolean; onClose: () => void; onSelect: (id: string) => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeSheetStyles(colors), [colors]);
  const { mixtapes, load, create } = useMixtapeStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');

  useEffect(() => { if (visible) load(); }, [visible]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const pl = await create(name);
    setCreating(false); setNewName('');
    onSelect(pl.id);
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={s.overlay} />
      <View style={s.container}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>Add to Mixtape</Text>
          {creating ? (
            <View style={s.inlineCreate}>
              <TextInput
                autoFocus
                onChangeText={setNewName}
                onSubmitEditing={handleCreate}
                placeholder="Mixtape name…"
                placeholderTextColor={colors.textDim}
                returnKeyType="done"
                style={s.inlineInput}
                value={newName}
              />
              <Pressable onPress={handleCreate} style={s.inlineConfirm}>
                <Text style={s.inlineConfirmText}>Create</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => { setCreating(false); setNewName(''); }}>
                <Ionicons color={colors.textMuted} name="close" size={18} />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setCreating(true)} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
              <Ionicons color={colors.textPrimary} name="add-circle-outline" size={20} />
              <Text style={s.rowText}>New Mixtape</Text>
            </Pressable>
          )}
          {mixtapes.length === 0 && !creating && <Text style={s.empty}>No mixtapes yet</Text>}
          {mixtapes.map((pl) => (
            <Pressable key={pl.id} onPress={() => onSelect(pl.id)} style={({ pressed }) => [s.row, pressed && s.rowPressed]}>
              <Ionicons color={colors.textMuted} name="musical-notes" size={18} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowText}>{pl.name}</Text>
                <Text style={s.rowMeta}>{pl.tracks.length} track{pl.tracks.length !== 1 ? 's' : ''}</Text>
              </View>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={s.cancel}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export default function PlayerOverlay() {
  const { expanded, collapse } = usePlayerUI();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const { track, shuffle, queue, queueIndex, togglePlayPause, next, prev, seekTo, toggleShuffle, skipToIndex } = usePlayer();
  const { isPlaying, isBuffering, positionSec, durationSec } = usePlaybackStatus();
  const {
    isCasting, isGoogleCasting, googleCastDeviceName, googleCastTitle,
    castIsPlaying, castPositionSec, castDurationSec,
    castTogglePlayPause, castSeek, stopGoogleCast, showGoogleCastPicker,
  } = useCast();

  const activeIsPlaying   = isGoogleCasting ? castIsPlaying   : isPlaying;
  const activePositionSec = isGoogleCasting ? castPositionSec : positionSec;
  const activeDurationSec = isGoogleCasting ? castDurationSec : durationSec;

  const activeTogglePlay  = isGoogleCasting ? castTogglePlayPause : togglePlayPause;
  const activeSeek        = isGoogleCasting ? castSeek        : seekTo;

  const { mixtapes, load: loadMixtapes, addTrack } = useMixtapeStore();
  const { lovedPaths, toggleLove } = useLibraryActivityStore();
  const isLoved = track ? lovedPaths.has(track.path) : false;
  const inMixtape = track ? mixtapes.some((pl) => pl.tracks.some((t) => t.filePath === track.path)) : false;

  const [mixtapeModalVisible, setMixtapeModalVisible] = useState(false);
  const [artworkError, setArtworkError]               = useState(false);
  const [mounted, setMounted]                         = useState(false);
  const [queueShowing, setQueueShowing]               = useState(false);

  const slideY          = useRef(new Animated.Value(SCREEN_H)).current;
  const overlayOpacity  = useRef(new Animated.Value(0)).current;
  const chevronNudge    = useRef(new Animated.Value(0)).current;
  const queueX          = useRef(new Animated.Value(0)).current; // 0 = artwork, -SCREEN_W = queue
  const queueBaseX      = useRef(0);
  const queueShowingRef = useRef(false);
  const flatListRef     = useRef<FlatList<MusicTrack>>(null);

  const queuePanelX = queueX.interpolate({ inputRange: [-SCREEN_W, 0], outputRange: [0, SCREEN_W] });
  const dotArtOpacity   = queueX.interpolate({ inputRange: [-SCREEN_W, 0], outputRange: [0.3, 0.8] });
  const dotQueueOpacity = queueX.interpolate({ inputRange: [-SCREEN_W, 0], outputRange: [0.8, 0.3] });

  const artworkQueuePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5 &&
        (queueShowingRef.current ? g.dx > 0 : g.dx < 0),
      onPanResponderMove: (_, g) => {
        queueX.setValue(Math.max(-SCREEN_W, Math.min(0, queueBaseX.current + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const pos    = Math.max(-SCREEN_W, Math.min(0, queueBaseX.current + g.dx));
        const toQueue = !queueShowingRef.current && (pos < -SCREEN_W * 0.3 || g.vx < -0.5);
        const toArt   =  queueShowingRef.current && (pos > -SCREEN_W * 0.7 || g.vx >  0.5);
        const target  = (toQueue || (queueShowingRef.current && !toArt)) ? -SCREEN_W : 0;
        queueBaseX.current      = target;
        queueShowingRef.current = target === -SCREEN_W;
        setQueueShowing(target === -SCREEN_W);
        Animated.spring(queueX, { toValue: target, useNativeDriver: true, tension: 220, friction: 26 }).start();
      },
    })
  ).current;

  const prevPath = useRef<string | null>(null);
  if (track?.path !== prevPath.current) {
    prevPath.current = track?.path ?? null;
    if (artworkError) setArtworkError(false);
  }

  useEffect(() => {
    if (!mounted) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(1400),
        Animated.timing(chevronNudge, { toValue: 5, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(chevronNudge, { toValue: 0, duration: 300, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
      { iterations: 3 },
    );
    anim.start();
    return () => anim.stop();
  }, [mounted]);

  useEffect(() => {
    if (expanded) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 420, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: SCREEN_H, duration: 320, easing: Easing.bezier(0.4, 0, 1, 1), useNativeDriver: true }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 220, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [expanded]);

  useEffect(() => {
    if (queueShowing && queue.length > 0) {
      flatListRef.current?.scrollToIndex({ index: Math.max(0, queueIndex), animated: true, viewPosition: 0.3 });
    }
  }, [queueShowing, queueIndex, queue.length]);

  useEffect(() => {
    if (!expanded) {
      queueX.setValue(0);
      queueBaseX.current = 0;
      queueShowingRef.current = false;
      setQueueShowing(false);
      return;
    }
    const showQueue = !!track && !track.hasArtwork;
    const target = showQueue ? -SCREEN_W : 0;
    queueX.setValue(target);
    queueBaseX.current = target;
    queueShowingRef.current = showQueue;
    setQueueShowing(showQueue);
  }, [expanded, track?.path]);

  useEffect(() => {
    if (!track && !isGoogleCasting && expanded) {
      const timer = setTimeout(collapse, 600);
      return () => clearTimeout(timer);
    }
  }, [track, isGoogleCasting, expanded]);

  useEffect(() => {
    if (!mounted) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (expanded) { collapse(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [mounted, expanded]);

  const dragPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dy > SNAP_DISTANCE || g.vy > SNAP_VELOCITY) collapse();
      },
    }),
  ).current;

  useEffect(() => { loadMixtapes(); }, []);

  if (!mounted) return null;

  // While the overlay is visible the background is always dark, so force white status bar text
  // regardless of the app's light/dark theme.

  const artworkUrl      = track?.hasArtwork ? getArtworkUrl(track.path, 512) : null;
  const artworkCacheKey = track?.hasArtwork ? getArtworkCacheKey(track.path, 512) : undefined;
  const hasArt          = !!(artworkUrl && !artworkError);
  const title      = track ? getTrackTitle(track) : '';
  const artist     = track?.artist ?? '';
  const album      = track?.album  ?? '';
  const folder     = track ? (track.directory.split('/').filter(Boolean).pop() ?? track.directory) : '';

  return (
    <>
      <StatusBar style="light" />
      <Animated.View
        {...dragPan.panHandlers}
        style={[s.overlay, { opacity: overlayOpacity, transform: [{ translateY: slideY }] }]}
      >
        {/* Full-bleed blurred artwork background */}
        {hasArt && (
          <Image blurRadius={22} contentFit="cover" source={{ uri: artworkUrl!, cacheKey: artworkCacheKey }} style={StyleSheet.absoluteFill} />
        )}
        {/* Dark scrim — always present so text is always legible */}
        <View style={[StyleSheet.absoluteFill, s.scrim]} />

        {/* ── Casting-only state ── */}
        {!track && isGoogleCasting && (
          <View style={[s.emptyState, { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xxl }]}>
            <Ionicons color="rgba(255,255,255,0.8)" name="wifi" size={64} />
            <Text style={s.emptyTitle}>
              {googleCastDeviceName ? `Casting to ${googleCastDeviceName}` : 'Casting via Chromecast'}
            </Text>
            {googleCastTitle ? <Text style={s.emptySub}>{googleCastTitle}</Text> : null}
            <Pressable onPress={async () => { await stopGoogleCast(); }} style={s.stopCastBtn}>
              <Text style={s.stopCastText}>Stop casting</Text>
            </Pressable>
            <Pressable onPress={showGoogleCastPicker} style={{ marginTop: Spacing.md }}>
              <Text style={[s.emptySub, { color: 'rgba(255,255,255,0.6)' }]}>Change device</Text>
            </Pressable>
          </View>
        )}

        {/* ── Main player ── */}
        {track && (
          <View style={s.content}>
            {/* Dismiss handle */}
            <View style={[s.handleBar, { paddingTop: insets.top + Spacing.xs }]}>
              <Pressable hitSlop={16} onPress={collapse} style={s.handleInner}>
                <Animated.View style={{ transform: [{ translateY: chevronNudge }] }}>
                  <Ionicons color="rgba(255,255,255,0.55)" name="chevron-down" size={24} />
                </Animated.View>
              </Pressable>
            </View>

            {/* Artwork / Queue panels — swipe left to see queue, right to return */}
            <View style={s.panelContainer} {...(hasArt ? artworkQueuePan.panHandlers : {})}>
              {/* Artwork panel — only when artwork is available */}
              {hasArt && (
                <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: queueX }] }]}>
                  <View style={s.artworkWrap}>
                    <Image
                      contentFit="cover"
                      onError={() => setArtworkError(true)}
                      source={{ uri: artworkUrl!, cacheKey: artworkCacheKey }}
                      style={s.artwork}
                    />
                  </View>
                </Animated.View>
              )}

              {/* Queue panel */}
              <Animated.View style={hasArt
                ? [StyleSheet.absoluteFill, { transform: [{ translateX: queuePanelX }] }]
                : StyleSheet.absoluteFill
              }>
                <FlatList
                  ref={flatListRef}
                  contentContainerStyle={{ paddingVertical: Spacing.sm }}
                  data={queue}
                  keyExtractor={(_, idx) => String(idx)}
                  onScrollToIndexFailed={() => {}}
                  renderItem={({ item, index }) => (
                    <QueueItem
                      index={index}
                      isCurrent={index === queueIndex}
                      onPress={() => {
                        skipToIndex(index);
                        if (hasArt) {
                          queueBaseX.current = 0;
                          queueShowingRef.current = false;
                          setQueueShowing(false);
                          Animated.spring(queueX, { toValue: 0, useNativeDriver: true, tension: 220, friction: 26 }).start();
                        }
                      }}
                      track={item}
                    />
                  )}
                />
              </Animated.View>
            </View>

            {/* Page dots — only when artwork is present */}
            {hasArt && (
              <View style={s.pageDotsRow}>
                <Animated.View style={[s.pageDot, { opacity: dotArtOpacity }]} />
                <Animated.View style={[s.pageDot, { opacity: dotQueueOpacity }]} />
              </View>
            )}

            {/* Info + controls */}
            <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xxl) }]}>

              {/* Title row */}
              <View style={s.titleRow}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={s.title}>{title}</Text>
                  {(artist || album) ? (
                    <Text numberOfLines={1} style={s.artist}>{[artist, album].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                  {folder ? (
                    <View style={s.folderRow}>
                      <Ionicons color="rgba(255,255,255,0.35)" name="folder-outline" size={11} style={{ marginRight: 3 }} />
                      <Text numberOfLines={1} style={s.folder}>{folder}</Text>
                    </View>
                  ) : null}
                </View>
                <Pressable hitSlop={12} onPress={() => toggleLove(track.path)} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}>
                  <Ionicons color={isLoved ? '#e05a7a' : 'rgba(255,255,255,0.6)'} name={isLoved ? 'heart' : 'heart-outline'} size={24} />
                </Pressable>
                <Pressable hitSlop={12} onPress={() => setMixtapeModalVisible(true)} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}>
                  <Ionicons color={inMixtape ? colors.accent : 'rgba(255,255,255,0.6)'} name={inMixtape ? 'radio' : 'radio-outline'} size={24} />
                </Pressable>
              </View>

              {/* Progress */}
              <ProgressBar durationSec={activeDurationSec} onSeek={activeSeek} positionSec={activePositionSec} />

              {/* Transport controls */}
              <View style={s.controls}>
                <Pressable
                  hitSlop={12}
                  onPress={toggleShuffle}
                  style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                >
                  <Ionicons color={shuffle ? '#fff' : 'rgba(255,255,255,0.4)'} name="shuffle" size={22} />
                </Pressable>

                <Pressable
                  disabled={queue.length <= 1}
                  hitSlop={12}
                  onPress={prev}
                  style={({ pressed }) => [{ opacity: queue.length <= 1 ? 0.3 : pressed ? 0.5 : 1 }]}
                >
                  <Ionicons color="#fff" name="play-skip-back" size={34} />
                </Pressable>

                <Pressable onPress={activeTogglePlay} style={s.playBtn}>
                  {isBuffering && !isGoogleCasting
                    ? <ActivityIndicator color="#111" size="small" />
                    : <Ionicons color="#111" name={activeIsPlaying ? 'pause' : 'play'} size={32} />}
                </Pressable>

                <Pressable
                  disabled={queue.length <= 1}
                  hitSlop={12}
                  onPress={next}
                  style={({ pressed }) => [{ opacity: queue.length <= 1 ? 0.3 : pressed ? 0.5 : 1 }]}
                >
                  <Ionicons color="#fff" name="play-skip-forward" size={34} />
                </Pressable>

                <CastButton style={{ width: 22, height: 22, tintColor: isCasting ? colors.accent : 'rgba(255,255,255,0.4)' }} />
              </View>

              {/* Tags */}
              {(track.key || track.bpm != null || track.genre || track.year != null) && (
                <View style={s.tagRow}>
                  {track.key && (
                    <View style={s.tag}>
                      <Ionicons color="rgba(255,255,255,0.55)" name="musical-note" size={10} style={{ marginRight: 3 }} />
                      <Text style={s.tagText}>{track.key}</Text>
                    </View>
                  )}
                  {track.bpm != null && <View style={s.tag}><Text style={s.tagText}>{Math.round(track.bpm)} BPM</Text></View>}
                  {track.genre && <View style={s.tag}><Text style={s.tagText}>{track.genre}</Text></View>}
                  {track.year != null && <View style={s.tag}><Text style={s.tagText}>{track.year}</Text></View>}
                </View>
              )}

              {/* Casting banner */}
              {isGoogleCasting && (
                <Pressable onPress={stopGoogleCast} style={s.castBanner}>
                  <Ionicons color="rgba(255,255,255,0.7)" name="wifi" size={13} />
                  <Text style={s.castBannerText}>
                    {googleCastDeviceName ? `Casting to ${googleCastDeviceName}` : 'Casting via Chromecast'}
                    {'  ·  '}<Text style={{ color: '#f85149' }}>Stop</Text>
                  </Text>
                </Pressable>
              )}

              {queue.length > 1 && (
                <Text style={s.queueInfo}>{queueIndex + 1} of {queue.length}</Text>
              )}
            </View>
          </View>
        )}

        <MixtapePickerModal
          onClose={() => setMixtapeModalVisible(false)}
          onSelect={(id) => { addTrack(id, track!.path); setMixtapeModalVisible(false); }}
          visible={mixtapeModalVisible}
        />
      </Animated.View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: c.bgPrimary,
      overflow: 'hidden',
      zIndex: 100,
      elevation: 100,
    },
    scrim: { backgroundColor: 'rgba(0,0,0,0.58)' },

    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
    emptyTitle: { fontSize: Typography.lg, color: '#fff', fontWeight: '600', marginTop: Spacing.md, textAlign: 'center' },
    emptySub:   { fontSize: Typography.sm, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
    stopCastBtn: {
      marginTop: Spacing.xl, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
      borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(248,81,73,0.7)',
    },
    stopCastText: { fontSize: Typography.base, color: '#f85149' },

    content: { flex: 1 },

    handleBar:  { alignItems: 'center', paddingTop: Spacing.sm },
    handleInner:{ padding: Spacing.sm },

    // Two-panel container: artwork on the left, queue on the right
    panelContainer: {
      flex: 1,
      overflow: 'hidden',
    },

    // Artwork floats in the upper portion of the flex space
    artworkWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },

    pageDotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: Spacing.sm },
    pageDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
    artwork: {
      width: ARTWORK_SIZE,
      height: ARTWORK_SIZE,
      borderRadius: Radius.lg + 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.7,
      shadowRadius: 28,
      elevation: 28,
    },
    // Bottom section — info, progress, controls
    bottom: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xs },

    titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.xl, gap: Spacing.md },
    title:    { fontSize: Typography.xxl, fontWeight: '700', color: '#fff', marginBottom: Spacing.xs, letterSpacing: -0.3 },
    artist:   { fontSize: Typography.base, color: 'rgba(255,255,255,0.65)' },
    folderRow:{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs },
    folder:   { fontSize: Typography.xs, color: 'rgba(255,255,255,0.38)', flex: 1 },
    iconBtn:  { padding: 4, marginTop: 2 },

    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.xl,
    },
    playBtn: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: '#fff',
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },

    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.md },
    tag: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: Radius.full,
      paddingHorizontal: 10, paddingVertical: 4,
    },
    tagText: { fontSize: Typography.xs, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },

    castBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
    castBannerText: { fontSize: Typography.xs, color: 'rgba(255,255,255,0.6)' },
    queueInfo:  { textAlign: 'center', fontSize: Typography.xs, color: 'rgba(255,255,255,0.35)' },
  });
}

function makeSheetStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
    container: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.bgSurface, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
      paddingBottom: Spacing.xxl, paddingTop: Spacing.sm,
    },
    handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: 'center', marginBottom: Spacing.md },
    title:      { fontSize: Typography.md, fontWeight: '600', color: c.textPrimary, paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm },
    row:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
    rowPressed: { backgroundColor: c.bgElevated },
    rowText:    { fontSize: Typography.base, color: c.textPrimary },
    rowMeta:    { fontSize: Typography.sm, color: c.textMuted, marginTop: 2 },
    empty:      { textAlign: 'center', color: c.textMuted, fontSize: Typography.sm, paddingVertical: Spacing.md },
    cancel:     { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.xs, marginHorizontal: Spacing.lg, borderRadius: Radius.md, backgroundColor: c.bgElevated },
    cancelText: { fontSize: Typography.base, color: c.textMuted, fontWeight: '500' },
    inlineCreate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
    inlineInput: { flex: 1, color: c.textPrimary, fontSize: Typography.base, backgroundColor: c.bgElevated, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
    inlineConfirm:     { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, backgroundColor: c.accent, borderRadius: Radius.sm },
    inlineConfirmText: { color: '#fff', fontSize: Typography.sm, fontWeight: '600' },
  });
}
