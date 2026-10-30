// <copyright file="PlayerOverlay.tsx" company="John Narey">
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

import { Text, TextInput } from './Typography';
import { useLocalPlaylistStore } from '../store/localPlaylistStore';
import { LocalPlaylistPicker } from './LocalPlaylists';

import { Editorial, Radius, Spacing, ThemeColors, Typography } from '../theme';

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StudioRack } from '../screens/more/StudioScreen';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaybackPosition, usePlaybackStatus, usePlayer } from '../context/PlayerContext';
import { useCast } from '../context/CastContext';
import { useRemoteAccess } from '../lib/remoteAccess';
import { useTheme } from '../context/ThemeContext';
import { MusicTrack, getArtworkUrl, getTrackTitle } from '../api/musicLibrary';
import { isSigned } from '../api/streamSignatures';
import { ARTWORK_THUMB_SIZE, getArtworkCacheKey, PLAYER_ART_SIZE } from '../services/artworkCache';
import { useMixtapeStore } from '../store/mixtapeStore';
import { useLibraryActivityStore } from '../store/libraryActivityStore';
import { useLocalLibraryActivityStore } from '../store/localLibraryActivityStore';
import { isLocalPath } from '../services/localMusicLibrary';
import { usePlayerUI } from '../store/playerUIStore';
import { haptics } from '../lib/haptics';
import { useLiveTrack } from '../hooks/useLiveTrack';
import { useTrackAnalysisStatus } from '../store/analysisProgressStore';
import { useWindowFold } from '../lib/adaptiveWindow';
import { useTrackWaveform } from '../hooks/useTrackWaveform';
import { WaveformBars } from './WaveformBars';

// Fixed queue-row height so FlatList offsets are exact (via getItemLayout) and scrolling the
// current track to a consistent position never has to estimate/correct — which is what caused
// the "bounce". Rows must render at exactly this height regardless of whether they show an artist.
const QUEUE_ROW_HEIGHT = 60;
const SNAP_VELOCITY = 0.5;
const SNAP_DISTANCE = 64;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ── Progress bar ──────────────────────────────────────────────────────────────

// Height of the waveform inside the 52px touch target.
const WAVEFORM_HEIGHT = 40;

const ProgressBar = ({
  positionSec, durationSec, onSeek, peaks,
}: {
  positionSec: number;
  durationSec: number;
  onSeek: (s: number) => void;
  peaks?: Float32Array | null;
}) => {
  const [barWidth, setBarWidth] = useState(0);
  // While the user is dragging, `scrubFrac` (0..1) drives the UI so the bar follows the
  // finger and the position label updates live; null means "not scrubbing".
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  // After a seek is released, hold the bar at the seek target until the player's reported
  // position catches up. Without this the bar flips straight to the live (still-old) position
  // for a beat — looking like it jumps back to the start — then snaps forward once RNTP seeks.
  const [pendingSec, setPendingSec] = useState<number | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs so the PanResponder (created once) always reads current values without stale closures.
  const widthRef    = useRef(0);
  const durRef      = useRef(durationSec);
  const seekRef     = useRef(onSeek);
  const barLeftRef  = useRef(0);   // bar's absolute screen X, captured on touch start
  const scrubRef    = useRef<number | null>(null);
  widthRef.current = barWidth;
  durRef.current   = durationSec;
  seekRef.current  = onSeek;

  const setScrub = (f: number | null) => { scrubRef.current = f; setScrubFrac(f); };
  const fracFromAbs = (absX: number) => {
    const w = widthRef.current;
    if (w <= 0) return 0;
    return Math.max(0, Math.min(1, (absX - barLeftRef.current) / w));
  };

  const pan = useRef(
    PanResponder.create({
      // Win the gesture on touch-down and keep it through movement, so the overlay's
      // swipe-to-dismiss / queue-swipe PanResponders can't steal an in-progress seek.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        barLeftRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        setScrub(fracFromAbs(e.nativeEvent.pageX));
      },
      onPanResponderMove: (_, g) => setScrub(fracFromAbs(g.moveX)),
      onPanResponderRelease: () => {
        const f = scrubRef.current;
        if (f != null && durRef.current > 0) {
          const target = f * durRef.current;
          haptics.light();
          seekRef.current(target);
          setPendingSec(target);
          if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
          // Safety release in case the reported position never lands exactly on the target.
          pendingTimerRef.current = setTimeout(() => setPendingSec(null), 1500);
        }
        setScrub(null);
      },
      onPanResponderTerminate: () => setScrub(null),
    })
  ).current;

  // Release the hold once the player's reported position actually reaches the seeked spot.
  useEffect(() => {
    if (pendingSec == null) return;
    if (Math.abs(positionSec - pendingSec) < 0.8) {
      if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
      setPendingSec(null);
    }
  }, [pendingSec, positionSec]);

  useEffect(() => () => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
  }, []);

  // Displayed position: live finger drag > post-release hold > live playback position.
  const shownSec = scrubFrac != null ? scrubFrac * durationSec
                 : pendingSec != null ? pendingSec
                 : positionSec;
  const progress = durationSec > 0 ? Math.min(shownSec / durationSec, 1) : 0;
  const labelSec = shownSec;
  const dragging = scrubFrac != null;

  return (
    <View style={{ marginBottom: Spacing.lg }}>
      <View
        style={{ height: 52, justifyContent: 'center' }}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        {dragging && (
          <View style={{
            position: 'absolute', bottom: '100%', left: `${progress * 100}%`,
            marginBottom: 6, marginLeft: -28, width: 56,
            alignItems: 'center', paddingVertical: 4, borderRadius: 8,
            backgroundColor: 'rgba(0,0,0,0.8)',
          }}>
            <Text style={{ color: '#fff', fontSize: Typography.xs, fontVariant: ['tabular-nums'] }}>{fmt(labelSec)}</Text>
          </View>
        )}
        {peaks && barWidth > 0 ? (
          // Analysed track: the waveform is the seek bar. The dim copy is the whole track; the
          // bright copy is clipped to the played portion, so a position tick only resizes the
          // clip instead of redrawing the bars.
          <>
            <View pointerEvents="none">
              <WaveformBars color="rgba(255,255,255,0.3)" height={WAVEFORM_HEIGHT} peaks={peaks} width={barWidth} />
            </View>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', left: 0, top: (52 - WAVEFORM_HEIGHT) / 2,
                height: WAVEFORM_HEIGHT, width: `${progress * 100}%`, overflow: 'hidden',
              }}
            >
              <WaveformBars color="#fff" height={WAVEFORM_HEIGHT} peaks={peaks} width={barWidth} />
            </View>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', top: (52 - WAVEFORM_HEIGHT) / 2 - 3, height: WAVEFORM_HEIGHT + 6,
                width: dragging ? 3 : 2, marginLeft: dragging ? -1.5 : -1, borderRadius: 1.5,
                backgroundColor: '#fff', left: `${progress * 100}%` as any,
              }}
            />
          </>
        ) : (
          <>
            <View style={{ height: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3 }} />
            <View style={{ position: 'absolute', height: 5, backgroundColor: '#fff', borderRadius: 3, width: `${progress * 100}%` }} />
            <View style={{
              position: 'absolute',
              width: dragging ? 28 : 22, height: dragging ? 28 : 22, borderRadius: 14,
              backgroundColor: '#fff', top: '50%',
              marginTop: dragging ? -14 : -11, marginLeft: dragging ? -14 : -11,
              left: `${progress * 100}%` as any,
            }} />
          </>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ fontSize: Typography.xs, color: 'rgba(255,255,255,0.5)' }}>{fmt(labelSec)}</Text>
        <Text style={{ fontSize: Typography.xs, color: 'rgba(255,255,255,0.5)' }}>{durationSec > 0 ? fmt(durationSec) : '--:--'}</Text>
      </View>
    </View>
  );
};

// Isolated per-tick consumer: the playback position updates ~4×/sec, and the seek
// bar is its only consumer. Subscribing here (instead of in PlayerOverlay's body)
// keeps those ticks from re-rendering the entire ~1k-line overlay tree — which
// matters most while the morph/drag animations want the JS thread, and lets the
// overlay stay mounted-but-idle with zero per-tick cost.
const ActiveProgressBar = ({ isGoogleCasting, castPositionSec, castDurationSec, onSeek, trackPath }: {
  isGoogleCasting: boolean; castPositionSec: number; castDurationSec: number; onSeek: (s: number) => void;
  trackPath?: string | null;
}) => {
  const { positionSec, durationSec } = usePlaybackPosition();
  const peaks = useTrackWaveform(trackPath);
  return (
    <ProgressBar
      durationSec={isGoogleCasting ? castDurationSec : durationSec}
      key={`${isGoogleCasting ? 'cast' : 'local'}:${trackPath ?? ''}`}
      onSeek={onSeek}
      peaks={peaks}
      positionSec={isGoogleCasting ? castPositionSec : positionSec}
    />
  );
};

// ── Marquee title ─────────────────────────────────────────────────────────────
// Keeps a title on a single line. If it's wider than the available width it scrolls
// horizontally in a seamless loop (a duplicate copy fills the gap); otherwise it sits static.

const MARQUEE_GAP         = 48;   // space between the repeated copies
const MARQUEE_SPEED       = 45;   // px per second
const MARQUEE_START_DELAY = 1200; // pause before each scroll so the start is readable

function MarqueeText({ text, style }: { text: string; style: any }) {
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW]           = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  const overflowing = textW > 0 && containerW > 0 && textW > containerW;

  useEffect(() => {
    x.setValue(0);
    if (!overflowing) return;
    const distance = textW + MARQUEE_GAP;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(MARQUEE_START_DELAY),
        Animated.timing(x, {
          toValue: -distance,
          duration: (distance / MARQUEE_SPEED) * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [overflowing, textW, x]);

  return (
    <View onLayout={(e) => setContainerW(e.nativeEvent.layout.width)} style={{ width: '100%', overflow: 'hidden' }}>
      {/* Invisible measurer — absolutely positioned so it sizes to its full content width
          rather than being clamped (and truncated) to the container width. */}
      <Text
        numberOfLines={1}
        onLayout={(e) => setTextW(Math.ceil(e.nativeEvent.layout.width))}
        style={[style, { position: 'absolute', top: 0, left: 0, opacity: 0 }]}
      >
        {text}
      </Text>

      {overflowing ? (
        <Animated.View style={{ flexDirection: 'row', alignSelf: 'flex-start', transform: [{ translateX: x }] }}>
          <Text style={style}>{text}</Text>
          <Text style={[style, { marginLeft: MARQUEE_GAP }]}>{text}</Text>
        </Animated.View>
      ) : (
        <Text numberOfLines={1} style={style}>{text}</Text>
      )}
    </View>
  );
}

// ── Feathered artwork ─────────────────────────────────────────────────────────
// Softly fades the cover's edges so it blends into the blurred colour backdrop instead of
// showing a hard border — handy for scanned covers that carry a white margin. A single
// gradient only fades one axis, so two gradient masks are nested: their alphas multiply,
// feathering all four edges at once.

const ART_FEATHER = 0.015; // fraction of each edge that fades to transparent

function FeatheredArt({ uri, cacheKey, placeholderUri, placeholderCacheKey, style, onError }: {
  uri: string; cacheKey?: string; placeholderUri?: string | null; placeholderCacheKey?: string;
  style: any; onError: () => void;
}) {
  const mask = (horizontal: boolean) => (
    <LinearGradient
      colors={['transparent', 'black', 'black', 'transparent']}
      end={horizontal ? { x: 1, y: 0 } : undefined}
      locations={[0, ART_FEATHER, 1 - ART_FEATHER, 1]}
      start={horizontal ? { x: 0, y: 0 } : undefined}
      style={StyleSheet.absoluteFill}
    />
  );
  return (
    <MaskedView maskElement={mask(false)} style={style}>
      <MaskedView maskElement={mask(true)} style={style}>
        {/* The list's thumbnail stands in until the full-size render arrives, so the hero is
            never blank — it just sharpens. */}
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={onError}
          placeholder={placeholderUri ? { uri: placeholderUri, cacheKey: placeholderCacheKey } : undefined}
          placeholderContentFit="cover"
          // Without this the view keeps painting the PREVIOUS track's cover until the new one has
          // decoded — the half-second of stale artwork on every track change. Changing the key
          // clears the view instead, so the placeholder shows through immediately.
          recyclingKey={cacheKey ?? uri}
          source={{ uri, cacheKey }}
          style={style}
        />
      </MaskedView>
    </MaskedView>
  );
}

// ── Queue item ────────────────────────────────────────────────────────────────

function QueueItem({ track, index, isCurrent, onPress }: {
  track: MusicTrack; index: number; isCurrent: boolean; onPress: () => void;
}) {
  const title = getTrackTitle(track);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', height: QUEUE_ROW_HEIGHT,
        paddingHorizontal: Spacing.lg, gap: Spacing.md,
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
  const insets = useSafeAreaInsets();
  const fold = useWindowFold();
  const { height } = useWindowDimensions();
  const { mixtapes, load, create } = useMixtapeStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible) load(); }, [visible]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const pl = await create(name);
    setCreating(false); setNewName('');
    onSelect(pl.id);
  };

  return (
    <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={s.overlay} />
      <View style={[s.container, fold && (fold.vertical ? { width: fold.x } : { flex: 0, height: fold.y })]}>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1, maxHeight: (fold && !fold.vertical ? fold.y : height) - insets.top }} contentContainerStyle={[s.sheet, { paddingLeft: 24 + insets.left, paddingRight: 24 + (fold?.vertical ? 0 : insets.right) }]} >
          <View style={s.handle} />
          <Text style={s.title}>Add to Playlist</Text>
          {creating ? (
            <View style={s.inlineCreate}>
              <TextInput
                autoFocus
                onChangeText={setNewName}
                onSubmitEditing={handleCreate}
                placeholder="Playlist name…"
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
              <Text style={s.rowText}>New Playlist</Text>
            </Pressable>
          )}
          {mixtapes.length === 0 && !creating && <Text style={s.empty}>No playlists yet</Text>}
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
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export default function PlayerOverlay() {
  const remote = useRemoteAccess();
  const { expanded, collapse, morphFrom } = usePlayerUI();
  const { colors } = useTheme();
  const { width: SCREEN_W, height: SCREEN_H, fontScale } = useWindowDimensions();
  const height = SCREEN_H;
  const fold = useWindowFold();
  const wide = fold ? fold.vertical : SCREEN_W >= 700 || (SCREEN_W > SCREEN_H && SCREEN_W >= 560);
  const [panelWidth, setPanelWidth] = useState(SCREEN_W);
  const [detailsHeight, setDetailsHeight] = useState(380);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  const compact = height < 740 || fontScale > 1.25;
  const s = useMemo(() => makeStyles(colors, compact, wide), [colors, compact, wide]);
  const insets = useSafeAreaInsets();

  const { track, shuffle, queue, queueIndex, repeatMode, cycleRepeat, togglePlayPause, next, prev, seekTo, toggleShuffle, skipToIndex, stopPlayer } = usePlayer();
  // BPM/key/genre can change while a track plays (an analysis writes new tags); this follows them.
  const liveTrack = useLiveTrack(track);
  const analysisStatus = useTrackAnalysisStatus(track?.path);
  const { isPlaying, isBuffering } = usePlaybackStatus();
  const {
    isCasting, isGoogleCasting, googleCastDeviceName, googleCastTitle,
    castIsPlaying, castPositionSec, castDurationSec,
    castTogglePlayPause, castSeek, stopGoogleCast, showGoogleCastPicker,
  } = useCast();

  // Skip/back are normally gated on having more than one track. On a cold reopen the native queue
  // is still playing but the React queue hasn't rehydrated (empty) — keep the buttons live in that
  // window rather than greying them, since next/prev fall back to the native queue.
  const canSkip = queue.length > 1 || (queue.length === 0 && track != null);

  const activeIsPlaying   = isGoogleCasting ? castIsPlaying   : isPlaying;

  const activeTogglePlay  = isGoogleCasting ? castTogglePlayPause : togglePlayPause;
  const activeSeek        = isGoogleCasting ? castSeek        : seekTo;

  // Selectors, not whole-store reads: this component never unmounts once opened, so subscribing to
  // every field made an unrelated store write (a recorded play, a sync-state tick) re-render the
  // full sheet — blurred art, gradients, masked views and the queue list.
  const mixtapes     = useMixtapeStore((st) => st.mixtapes);
  const loadMixtapes = useMixtapeStore((st) => st.load);
  const addTrack     = useMixtapeStore((st) => st.addTrack);
  const lovedPaths      = useLibraryActivityStore((st) => st.lovedPaths);
  const toggleLove      = useLibraryActivityStore((st) => st.toggleLove);
  const localLovedPaths = useLocalLibraryActivityStore((st) => st.lovedPaths);
  const toggleLocalLove = useLocalLibraryActivityStore((st) => st.toggleLove);
  const trackIsLocal = track ? isLocalPath(track.path) : false;
  const isLoved = track ? (trackIsLocal ? localLovedPaths : lovedPaths).has(track.path) : false;
  const localPlaylists = useLocalPlaylistStore(st => st.playlists);
  const inMixtape = trackIsLocal ? localPlaylists.some(p => p.tracks.some(t => t.path === track?.path)) : track ? mixtapes.some((pl) => pl.tracks.some((t) => t.filePath === track.path)) : false;

  const [artworkSize, setArtworkSize] = useState(Math.min(SCREEN_W - 48, SCREEN_H * .5));
  const [moreVisible, setMoreVisible] = useState(false);
  const [studioVisible, setStudioVisible] = useState(false);
  useEffect(() => { if (!expanded || !track) { setStudioVisible(false); setMoreVisible(false); } }, [expanded, track]);
  const [mixtapeModalVisible, setMixtapeModalVisible] = useState(false);
  const [artworkError, setArtworkError]               = useState(false);
  const [mounted, setMounted]                         = useState(false);
  // Once opened, the overlay stays MOUNTED and is merely hidden (display:none) when
  // idle — remounting this heavy tree (nested MaskedViews, a full-bleed blurred
  // image, gradients, the queue list) on every open used to collide with the morph
  // animation on the JS thread and drop its first frames. `visible` gates paint +
  // touches; it flips false only after the close animation finishes.
  const [visible, setVisible]                         = useState(false);
  // True only while the user is dragging the sheet down. During the drag the sheet's
  // content is static (it just translates), so flattening it to one GPU texture makes
  // the swipe glide instead of re-compositing the blurred image + gradients per frame.
  // (We must NOT rasterize during the morph, whose children animate every frame.)
  const [dragging, setDragging]                       = useState(false);
  const [queueShowing, setQueueShowing]               = useState(false);

  const slideY          = useRef(new Animated.Value(SCREEN_H)).current;
  const overlayOpacity  = useRef(new Animated.Value(0)).current;
  // Morph progress: 0 = collapsed into the bubble, 1 = full player at rest. Only
  // drives the entrance when opened from the floating bubble (morphFrom set); in
  // mini-bar mode it's pinned to 1 and the classic slideY entrance is used.
  // Two values kept in lock-step: `expandP` runs on the NATIVE driver (opacity +
  // transform → no per-frame layout, so the morph is smooth) while `expandPr`
  // runs on the JS driver purely for the hero's border-radius (circle→square),
  // which the native driver can't animate. They must live on separate nodes.
  const expandP         = useRef(new Animated.Value(0)).current;
  const expandPr        = useRef(new Animated.Value(0)).current;
  const chevronNudge    = useRef(new Animated.Value(0)).current;
  const queueX          = useRef(new Animated.Value(0)).current; // 0 = artwork, -SCREEN_W = queue
  const artScale        = useRef(new Animated.Value(1)).current; // 1 = playing, shrinks when paused
  const queueBaseX      = useRef(0);
  const queueShowingRef = useRef(false);
  const flatListRef     = useRef<FlatList<MusicTrack>>(null);

  // Resting rect of the artwork in window coords — the target the bubble morphs
  // into. Measured from a non-transformed wrapper so scale-breathing doesn't skew
  // it. The PlayerOverlay instance stays mounted, so this survives open/close.
  const artWrapRef = useRef<View>(null);
  const [artRect, setArtRect] = useState<{ x: number; y: number; size: number } | null>(null);
  const measureArt = () => {
    artWrapRef.current?.measureInWindow((x, y, w) => { if (w > 0) setArtRect({ x, y, size: w }); });
  };

  const queuePanelX = queueX.interpolate({ inputRange: [-panelWidth, 0], outputRange: [0, panelWidth] });
  const goToPanel = (showQueue: boolean) => {
    const target = showQueue ? -panelWidth : 0;
    if (queueBaseX.current === target) return;
    haptics.selection();
    queueBaseX.current = target;
    queueShowingRef.current = showQueue;
    setQueueShowing(showQueue);
    Animated.spring(queueX, { toValue: target, useNativeDriver: true, tension: 220, friction: 26 }).start();
  };

  useEffect(() => {
    const target = queueShowingRef.current ? -panelWidth : 0;
    queueX.stopAnimation();
    queueX.setValue(target);
    queueBaseX.current = target;
    setArtRect(null);
    const frame = requestAnimationFrame(measureArt);
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelWidth, SCREEN_H]);

  // Artwork breathes with playback — full size while playing, shrinks slightly when paused.
  useEffect(() => {
    Animated.spring(artScale, {
      toValue: activeIsPlaying ? 1 : 0.86,
      useNativeDriver: true, tension: 120, friction: 9,
    }).start();
  }, [activeIsPlaying, artScale]);

  const artworkQueuePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5 &&
        (queueShowingRef.current ? g.dx > 0 : g.dx < 0),
      onPanResponderMove: (_, g) => {
        queueX.setValue(Math.max(-panelWidthRef.current, Math.min(0, queueBaseX.current + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const pos    = Math.max(-panelWidthRef.current, Math.min(0, queueBaseX.current + g.dx));
        const toQueue = !queueShowingRef.current && (pos < -panelWidthRef.current * 0.3 || g.vx < -0.5);
        const toArt   =  queueShowingRef.current && (pos > -panelWidthRef.current * 0.7 || g.vx >  0.5);
        const target  = (toQueue || (queueShowingRef.current && !toArt)) ? -panelWidthRef.current : 0;
        queueBaseX.current      = target;
        queueShowingRef.current = target === -panelWidthRef.current;
        setQueueShowing(target === -panelWidthRef.current);
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
    if (!visible) return;
    chevronNudge.setValue(0);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Open and close instantly — no morph, no slide, no fade.
  //
  // The morph grew a hero image out of the floating bubble, deferred behind a
  // requestAnimationFrame. But the bubble opens the player *before* bringing the activity
  // forward (see openApp), and rAF doesn't fire while the app isn't drawing: the callback
  // arrived late or never, stranding the sheet half-open — opaque background, no controls,
  // covering the app. The close path had the mirror-image fault, unmounting from an animation
  // completion callback that a track change could prevent from ever running.
  //
  // Snapping straight to the end state removes the failure mode rather than guarding it.
  useEffect(() => {
    if (expanded) {
      setMounted(true);
      setVisible(true);
      slideY.setValue(0);
      overlayOpacity.setValue(1);
      expandP.setValue(1);
      expandPr.setValue(1);
    } else if (mounted) {
      setVisible(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Keep the current track pinned at a consistent spot (30% down) in the queue. Snap instantly
  // when the queue first opens (no opening bounce), then animate smoothly as the track advances
  // so it tracks to the same position. getItemLayout makes both exact, so there's no estimate/correct.
  const queueScrolledOpen = useRef(false);
  useEffect(() => {
    if (!queueShowing || queue.length === 0) { queueScrolledOpen.current = false; return; }
    const justOpened = !queueScrolledOpen.current;
    queueScrolledOpen.current = true;
    flatListRef.current?.scrollToIndex({ index: Math.max(0, queueIndex), animated: !justOpened, viewPosition: 0.3 });
  }, [queueShowing, queueIndex, queue.length]);

  useEffect(() => {
    if (!expanded) {
      queueX.setValue(0);
      queueBaseX.current = 0;
      queueShowingRef.current = false;
      setQueueShowing(false);
      return;
    }
    // Only the *queue* is ever forced: a track with no artwork has nothing to show on the artwork
    // panel, so fall to the queue. Otherwise leave the user on whichever panel they're on — never
    // yank them back to artwork on a track change (e.g. pressing next while viewing the queue).
    const mustShowQueue = !!track && !track.hasArtwork;
    if (!mustShowQueue && queueShowingRef.current) return;
    const target = mustShowQueue ? -panelWidth : 0;
    queueX.setValue(target);
    queueBaseX.current = target;
    queueShowingRef.current = mustShowQueue;
    setQueueShowing(mustShowQueue);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, track?.path]);

  useEffect(() => {
    if (!track && !isGoogleCasting && expanded) {
      const timer = setTimeout(collapse, 600);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, isGoogleCasting, expanded]);

  useEffect(() => {
    if (!mounted) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (expanded) { collapse(); return true; }
      return false;
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, expanded]);

  const dragPan = useRef(
    PanResponder.create({
      // Claim downward-ish drags early (small threshold, lenient vertical bias) so gentle swipes
      // still register instead of falling through to a no-op.
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      // Flatten the sheet to a texture for the duration of the drag (see `dragging`).
      onPanResponderGrant: () => setDragging(true),
      // Track the finger so the sheet visibly follows the drag — this is the feedback that was
      // missing, which made short/slow swipes feel like they "didn't register".
      onPanResponderMove: (_, g) => slideY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        setDragging(false);
        if (g.dy > SNAP_DISTANCE || g.vy > SNAP_VELOCITY) {
          collapse();
        } else {
          Animated.spring(slideY, { toValue: 0, useNativeDriver: true, tension: 220, friction: 26 }).start();
        }
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        Animated.spring(slideY, { toValue: 0, useNativeDriver: true, tension: 220, friction: 26 }).start();
      },
    }),
  ).current;

  useEffect(() => { if (remote && !trackIsLocal) void loadMixtapes(); }, [remote, trackIsLocal, loadMixtapes]);

  if (!mounted) return null;
  // Nothing to show. The overlay normally unmounts from its collapse animation's completion
  // callback, but stopPlayer() clears the track immediately — the animation never finishes and
  // the sheet was left covering the app, opaque and empty. Casting has no track of its own, so
  // it stays exempt.
  if (!track && !isGoogleCasting) return null;

  // While the overlay is visible the background is always dark, so force white status bar text
  // regardless of the app's light/dark theme.

  const isLocalTrack    = track?.path.startsWith('file://') || track?.path.startsWith('content://');
  // Wait for the signature before asking for the cover. Signatures live in a module-level cache
  // that a JS reload wipes, and a rehydrated track never had one — building the URL then sends an
  // unsigned request, which 401s and latches artworkError until the *next* track, leaving the
  // panel black for the whole song. artSigned re-renders this once the signature lands.
  const artIsSigned     = !track || isLocalTrack || isSigned(track.path);
  const artworkUrl      = track?.hasArtwork && artIsSigned ? (isLocalTrack ? track.coverPath : getArtworkUrl(track.path, PLAYER_ART_SIZE)) : null;
  const artworkCacheKey = track?.hasArtwork && !isLocalTrack ? getArtworkCacheKey(track.path, PLAYER_ART_SIZE) : undefined;

  // The thumbnail the track list already cached. The player asks the server for a much larger
  // render under a different cache key, so opening the player from a list meant a cold fetch even
  // though a perfectly good cover was sitting on disk. This is that cover, reused two ways below.
  const thumbUrl      = track?.hasArtwork && artIsSigned ? (isLocalTrack ? track.coverPath : getArtworkUrl(track.path, ARTWORK_THUMB_SIZE)) : null;
  const thumbCacheKey = track?.hasArtwork && !isLocalTrack ? getArtworkCacheKey(track.path, ARTWORK_THUMB_SIZE) : undefined;
  const hasArt          = !!(artworkUrl && !artworkError);
  const title      = track ? getTrackTitle(track) : '';
  const artist     = track?.artist ?? '';
  const album      = track?.album  ?? '';
  const folder     = track ? (track.directory.split('/').filter(Boolean).pop() ?? track.directory) : '';
  const artworkStyle = [s.artwork, { width: artworkSize, height: artworkSize }];
  const tagTrack   = liveTrack ?? track;

  // ── Morph geometry ──
  // Background, chrome and hero all read off the single expandP value. In mini-bar
  // mode expandP rests at 1, so these evaluate to the fully-open state and the
  // hero (which is only rendered when morphFrom is set) never appears.
  const bgOpacity     = expandP.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] });
  const chromeOpacity = expandP.interpolate({ inputRange: [0, 0.5, 0.85, 1], outputRange: [0, 0, 1, 1] });
  const heroOpacity   = expandP.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1, 1, 0] });
  const artTarget = artRect ?? {
    x: (SCREEN_W - artworkSize) / 2,
    y: Math.max(insets.top + 60, SCREEN_H * 0.42 - artworkSize / 2),
    size: artworkSize,
  };
  // The hero is laid out statically at the artwork's resting rect, then moved +
  // scaled into the bubble at expandP=0. Transform-based (not width/height/left/
  // top) so it runs on the native driver with no per-frame layout. RN applies the
  // transform list right-to-left, so scale (about the view centre) happens first,
  // then translate in screen points — moving the centre to the bubble's centre.
  const srcCX = (morphFrom?.x ?? 0) + (morphFrom?.size ?? 0) / 2;
  const srcCY = (morphFrom?.y ?? 0) + (morphFrom?.size ?? 0) / 2;
  const tgtCX = artTarget.x + artTarget.size / 2;
  const tgtCY = artTarget.y + artTarget.size / 2;
  const heroScale = morphFrom ? expandP.interpolate({ inputRange: [0, 1], outputRange: [morphFrom.size / artTarget.size, 1] }) : 1;
  const heroTX    = morphFrom ? expandP.interpolate({ inputRange: [0, 1], outputRange: [srcCX - tgtCX, 0] }) : 0;
  const heroTY    = morphFrom ? expandP.interpolate({ inputRange: [0, 1], outputRange: [srcCY - tgtCY, 0] }) : 0;
  const heroRadius = morphFrom ? expandPr.interpolate({ inputRange: [0, 1], outputRange: [artTarget.size / 2, 0] }) : 0;

  return (
    <>
      {visible && <StatusBar style="light" />}
      <Animated.View
        {...dragPan.panHandlers}
        pointerEvents={visible ? 'auto' : 'none'}
        // Only while dragging: composite the whole sheet as one GPU texture so the
        // swipe-down translates a single static layer instead of re-compositing the
        // blurred image + masked art + gradients every frame.
        renderToHardwareTextureAndroid={dragging}
        shouldRasterizeIOS={dragging}
        style={[
          s.overlay,
          { opacity: overlayOpacity, transform: [{ translateY: slideY }] },
          !visible && { display: 'none' as const },
        ]}
      >
        {/* Background (blurred art + scrim). Fades in with the morph so the hero
            appears to grow out of the app rather than out of a dark sheet. */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: bgOpacity }]}>
          {/* Full-bleed blurred artwork background — scaled up so its colour bleeds edge-to-edge */}
          {hasArt && (
            <Image
              blurRadius={28}
              cachePolicy="memory-disk"
              contentFit="cover"
              // Deliberately the thumbnail, not the full-size render: at blur radius 28 the extra
              // resolution is destroyed anyway, and this one is already on disk, so the background
              // paints immediately instead of waiting on a fresh server render.
              // No recyclingKey here (unlike the hero): clearing the view on every track change
              // blanked the backdrop until the next cover decoded — a hard flash to the sheet
              // colour. At blur 28 the outgoing cover is unreadable mush, so holding it and
              // cross-dissolving is both invisible and safe for photosensitive viewers.
              source={{ uri: (thumbUrl ?? artworkUrl)!, cacheKey: thumbCacheKey ?? artworkCacheKey }}
              transition={{ duration: 320, effect: 'cross-dissolve' }}
              style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.3 }] }]}
            />
          )}
          {/* Gradient scrim — dark at the top/bottom for legibility, but lets the artwork's
              colour glow through the middle of the screen. Falls back to a flat dark wash
              when there's no artwork to colour the background. */}
          {hasArt ? (
            <LinearGradient
              colors={[
                'rgba(0,0,0,0.55)',
                'rgba(0,0,0,0.22)',
                'rgba(0,0,0,0.28)',
                'rgba(0,0,0,0.72)',
              ]}
              locations={[0, 0.34, 0.62, 1]}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, s.scrim]} />
          )}
        </Animated.View>

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
          <Animated.View style={[s.content, { opacity: chromeOpacity }]}>
            <View style={[s.handleBar, { paddingTop: insets.top + 4, paddingLeft: insets.left + 20, paddingRight: (fold?.vertical ? 0 : insets.right) + 20, width: fold?.vertical ? fold.x : undefined }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Minimise player" onPress={collapse} style={s.headerButton}>
                <Animated.View style={{ transform: [{ translateY: chevronNudge }] }}>
                  <Ionicons color="rgba(255,255,255,0.8)" name="chevron-down" size={24} />
                </Animated.View>
              </Pressable>
              <View style={s.headerTitle}>
                <Text style={s.headerEyebrow}>{queueShowing || !hasArt ? 'UP NEXT' : 'NOW PLAYING'}</Text>
                {queue.length > 1 && <Text style={s.queueInfo}>{queueIndex + 1} / {queue.length}</Text>}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={queueShowing ? 'Show artwork' : 'Show queue'} accessibilityState={{ selected: queueShowing }} disabled={!hasArt} onPress={() => goToPanel(!queueShowing)} style={[s.headerButton, !hasArt && { opacity: 0 }]}>
                <Ionicons color={queueShowing ? colors.accent : 'rgba(255,255,255,.8)'} name={queueShowing ? 'disc-outline' : 'list-outline'} size={23} />
              </Pressable>
            </View>

            <View style={[s.playerBody, { paddingLeft: insets.left, paddingRight: insets.right }]}>
            {/* Artwork / Queue panels — swipe left to see queue, right to return */}
            <View onLayout={({ nativeEvent: { layout } }) => { setPanelWidth(layout.width); setArtworkSize(Math.max(1, Math.min(layout.width - 40, layout.height - 24, 420))); }} style={[s.panelContainer, fold && (fold.vertical ? { flex: 0, width: Math.max(0, fold.x - insets.left), marginRight: fold.width } : { flex: 0, height: Math.max(80, fold.y - insets.top - 52), marginBottom: fold.height })]} {...(hasArt ? artworkQueuePan.panHandlers : {})}>
              {/* Artwork panel — only when artwork is available */}
              {hasArt && (
                <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: queueX }] }]}>
                  <View style={s.artworkWrap}>
                    {/* Non-transformed wrapper so measureInWindow yields the true
                        resting rect the bubble morphs into (scale-breathing is inside). */}
                    <View ref={artWrapRef} onLayout={measureArt} style={{ width: artworkSize, height: artworkSize }}>
                      <Animated.View style={{ transform: [{ scale: artScale }] }}>
                        <FeatheredArt
                          cacheKey={artworkCacheKey}
                          onError={() => {
                            console.warn(`[player-art] cover failed to load — signed=${artworkUrl?.includes('sig=')} ${track?.path}`);
                            setArtworkError(true);
                          }}
                          placeholderCacheKey={thumbCacheKey}
                          placeholderUri={thumbUrl}
                          style={artworkStyle}
                          uri={artworkUrl!}
                        />
                      </Animated.View>
                    </View>
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
                  getItemLayout={(_, index) => ({
                    length: QUEUE_ROW_HEIGHT,
                    offset: QUEUE_ROW_HEIGHT * index + Spacing.sm,
                    index,
                  })}
                  onScrollToIndexFailed={() => {}}
                  renderItem={({ item, index }) => (
                    <QueueItem
                      index={index}
                      isCurrent={index === queueIndex}
                      onPress={() => skipToIndex(index)}
                      track={item}
                    />
                  )}
                />
              </Animated.View>
            </View>

            <ScrollView onContentSizeChange={(_, h) => setDetailsHeight(h)} style={[s.detailsPane, { marginBottom: Math.max(insets.bottom, 24) }, !wide && !fold && { flexShrink: 0, height: Math.min(detailsHeight, SCREEN_H - insets.top - 188) }]} contentContainerStyle={[s.bottom, { paddingBottom: 24 }]} showsVerticalScrollIndicator={false}>
              <View style={s.titleRow}>
                <View style={s.trackIdentity}>
                  <MarqueeText style={s.title} text={title} />
                  {artist ? <Text numberOfLines={1} style={s.artist}>{artist}</Text> : null}
                  {album ? <Text numberOfLines={1} style={s.album}>{album}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={isLoved ? 'Remove from loved tracks' : 'Love track'} accessibilityState={{ selected: isLoved }} onPress={() => { haptics.light(); (trackIsLocal ? toggleLocalLove : toggleLove)(track.path); }} style={s.headerButton}>
                  <Ionicons color={isLoved ? '#e05a7a' : 'rgba(255,255,255,.7)'} name={isLoved ? 'heart' : 'heart-outline'} size={26} />
                </Pressable>
              </View>

              {tagTrack && (tagTrack.key || tagTrack.bpm != null || tagTrack.lufs != null) && (
                <View style={s.metrics}>
                  {tagTrack.key ? <View style={s.metric}><Text numberOfLines={1} style={s.metricValue}>{tagTrack.key}</Text><Text style={s.metricLabel}>KEY</Text></View> : null}
                  {tagTrack.bpm != null ? <View style={s.metric}><Text style={s.metricValue}>{Math.round(tagTrack.bpm)}</Text><Text style={s.metricLabel}>BPM</Text></View> : null}
                  {tagTrack.lufs != null ? <View style={s.metric}><Text style={s.metricValue}>{tagTrack.lufs.toFixed(1)}</Text><Text style={s.metricLabel}>LUFS</Text></View> : null}
                </View>
              )}
              {analysisStatus && <Text style={s.analysisNote}>{analysisStatus === 'analysing' ? 'Analysing track…' : 'Analysis queued'}</Text>}

              <ActiveProgressBar castDurationSec={castDurationSec} castPositionSec={castPositionSec} isGoogleCasting={isGoogleCasting} onSeek={activeSeek} trackPath={track?.path} />

              <View style={s.controls}>
                <Pressable accessibilityRole="button" accessibilityLabel={shuffle ? 'Turn shuffle off' : 'Turn shuffle on'} accessibilityState={{ selected: shuffle }} onPress={() => { haptics.selection(); toggleShuffle(); }} style={s.transportButton}>
                  <Ionicons color={shuffle ? colors.accent : 'rgba(255,255,255,.5)'} name="shuffle" size={23} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous track" accessibilityState={{ disabled: !canSkip }} disabled={!canSkip} onPress={() => { haptics.skip(); prev(); }} style={[s.transportButton, !canSkip && { opacity: .3 }]}>
                  <Ionicons color="#fff" name="play-skip-back" size={30} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={activeIsPlaying ? 'Pause playback' : 'Play'} onPress={() => { haptics.light(); activeTogglePlay(); }} style={s.playBtn}>
                  {isBuffering && !isGoogleCasting ? <ActivityIndicator color="#111" size="small" /> : <Ionicons color="#111" name={activeIsPlaying ? 'pause' : 'play'} size={32} />}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Next track" accessibilityState={{ disabled: !canSkip }} disabled={!canSkip} onPress={() => { haptics.skip(); next(); }} style={[s.transportButton, !canSkip && { opacity: .3 }]}>
                  <Ionicons color="#fff" name="play-skip-forward" size={30} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Repeat: ${repeatMode}. Change repeat mode`} accessibilityState={{ selected: repeatMode !== 'off' }} onPress={() => { haptics.selection(); cycleRepeat(); }} style={s.transportButton}>
                  <MaterialCommunityIcons color={repeatMode === 'off' ? 'rgba(255,255,255,.5)' : colors.accent} name={repeatMode === 'track' ? 'repeat-once' : 'repeat'} size={23} />
                </Pressable>
              </View>

              <View style={s.tools}>
                <Pressable accessibilityRole="button" accessibilityLabel="Open Studio sound design" onPress={() => { haptics.selection(); setStudioVisible(true); }} style={({ pressed }) => [s.studioButton, pressed && { opacity: .6 }]}>
                  <Ionicons name="options-outline" size={19} color={colors.accent} />
                  <Text style={s.studioLabel}>Sound design</Text>
                </Pressable>
                {(trackIsLocal || remote) && <Pressable accessibilityRole="button" accessibilityLabel="Add to playlist" onPress={() => { haptics.selection(); setMixtapeModalVisible(true); }} style={s.playlistButton}>
                  <Ionicons name="add-circle-outline" size={20} color={inMixtape ? colors.accent : 'rgba(255,255,255,.85)'} />
                  <Text style={s.toolLabel}>Add to playlist</Text>
                </Pressable>}
                <Pressable accessibilityRole="button" accessibilityLabel="Track details and more actions" onPress={() => setMoreVisible(true)} style={s.headerButton}>
                  <Ionicons color="rgba(255,255,255,.7)" name="ellipsis-horizontal" size={23} />
                </Pressable>
              </View>

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
            </ScrollView>
            </View>
          </Animated.View>
        )}

        {/* Hero artwork — the bubble's disc, grown into place (bubble mode only).
            Outer node: native-driven transform + opacity. Inner node: JS-driven
            border-radius (circle→square). Two nodes so the drivers don't clash. */}
        {morphFrom && track && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: artTarget.x,
              top: artTarget.y,
              width: artTarget.size,
              height: artTarget.size,
              opacity: heroOpacity,
              transform: [{ translateX: heroTX }, { translateY: heroTY }, { scale: heroScale }],
            }}
          >
            <Animated.View style={{ width: '100%', height: '100%', borderRadius: heroRadius, overflow: 'hidden' }}>
              {hasArt ? (
                <Image
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  recyclingKey={artworkCacheKey ?? artworkUrl ?? undefined}
                  source={{ uri: artworkUrl!, cacheKey: artworkCacheKey }}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : (
                <View style={{ width: '100%', height: '100%', backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons color="#fff" name="musical-note" size={28} />
                </View>
              )}
            </Animated.View>
          </Animated.View>
        )}

        {moreVisible && track && <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} transparent animationType="fade" visible onRequestClose={() => setMoreVisible(false)}>
          <View style={[s.moreOverlay, { paddingLeft: insets.left, paddingRight: insets.right }, fold && (fold.vertical ? { width: fold.x } : { flex: 0, height: fold.y })]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close track details" style={StyleSheet.absoluteFill} onPress={() => setMoreVisible(false)} />
            <View accessibilityViewIsModal style={[s.moreSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <View style={s.moreHeader}><Text style={s.moreTitle}>Track details</Text><Pressable accessibilityRole="button" accessibilityLabel="Close track details" onPress={() => setMoreVisible(false)} style={s.headerButton}><Ionicons name="close" size={23} color="#fff" /></Pressable></View>
              <ScrollView style={{ maxHeight: SCREEN_H * .4 }}>
                {[["Title", title], ["Artist", artist], ["Album", album], ["Genre", tagTrack?.genre], ["Year", tagTrack?.year], ["Folder", folder]].filter(([, value]) => value != null && value !== '').map(([label, value]) => <View key={String(label)} style={s.detailRow}><Text style={s.detailLabel}>{label}</Text><Text selectable style={s.detailValue}>{value}</Text></View>)}
              </ScrollView>
              {remote && <Pressable accessibilityRole="button" accessibilityLabel="Choose audio output" onPress={() => { setMoreVisible(false); setTimeout(showGoogleCastPicker, 250); }} style={s.moreAction}><Ionicons name="tv-outline" size={22} color={isCasting ? colors.accent : '#fff'} /><Text style={s.moreActionText}>Choose audio output</Text></Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel="Stop playback" onPress={() => { setMoreVisible(false); haptics.light(); collapse(); stopPlayer(); }} style={s.moreAction}><Ionicons name="stop-circle-outline" size={22} color="#f18a86" /><Text style={[s.moreActionText, { color: '#f18a86' }]}>Stop playback</Text></Pressable>
            </View>
          </View>
        </Modal>}

        {studioVisible && <Modal supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} animationType="slide" presentationStyle="fullScreen" visible onRequestClose={() => setStudioVisible(false)}>
          <View style={{ flex: 1, backgroundColor: colors.bgPrimary, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right, ...(fold ? (fold.vertical ? { width: fold.x } : { flex: 0, height: fold.y }) : {}) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderStrong }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Back to player" onPress={() => setStudioVisible(false)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="chevron-back" size={22} color={colors.textPrimary} /><Text style={{ color: colors.textPrimary }}>Player</Text>
              </Pressable>
              <Text numberOfLines={1} style={{ flex: 1, marginHorizontal: 16, color: colors.textMuted, fontSize: 12 }}>{title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={activeIsPlaying ? 'Pause playback' : 'Resume playback'} onPress={activeTogglePlay} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={activeIsPlaying ? 'pause' : 'play'} size={24} color={colors.accent} />
              </Pressable>
            </View>
            <StudioRack embedded />
          </View>
        </Modal>}

        {trackIsLocal ? (mixtapeModalVisible && track && <LocalPlaylistPicker tracks={[track]} onClose={() => setMixtapeModalVisible(false)} />) : <MixtapePickerModal
          onClose={() => setMixtapeModalVisible(false)}
          onSelect={(id) => { addTrack(id, track!.path); setMixtapeModalVisible(false); }}
          visible={mixtapeModalVisible}
        />}
      </Animated.View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors, compact: boolean, wide: boolean) {
  return StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      // Always dark, never c.bgPrimary: the sheet is white-text/light-status-bar in every
      // palette, so under the light palette this painted a near-white page behind the
      // translucent scrim — and any frame without artwork flashed white.
      backgroundColor: '#0d1117',
      overflow: 'hidden',
      zIndex: 100,
      elevation: 100,
    },
    scrim: { backgroundColor: 'rgba(0,0,0,0.58)' },

    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
    emptyTitle: { fontSize: Typography.lg, color: '#fff', marginTop: Spacing.md, textAlign: 'center', ...Editorial.heading },
    emptySub:   { fontSize: Typography.sm, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
    stopCastBtn: {
      marginTop: Spacing.xl, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
      borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(248,81,73,0.7)',
    },
    stopCastText: { fontSize: Typography.base, color: '#f85149' },

    content: { flex: 1 },

    handleBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 4 },
    headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
    headerEyebrow: { color: 'rgba(255,255,255,.75)', fontSize: 10, fontWeight: '600', letterSpacing: 2 },
    playerBody: { flex: 1, flexDirection: wide ? 'row' : 'column' },
    detailsPane: { flexGrow: wide ? 1 : 0, flexShrink: 1, flexBasis: wide ? 0 : 'auto', minWidth: 0 },
    panelContainer: { flex: wide ? 0 : 1, width: wide ? '50%' : undefined, minHeight: wide ? 80 : 120, overflow: 'hidden' },
    artworkWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    artwork: { borderRadius: 2 },
    bottom: { paddingHorizontal: 24, paddingTop: wide ? 16 : 8, flexGrow: wide ? 1 : 0, justifyContent: wide && !compact ? 'center' : 'flex-start' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: compact ? 10 : 16 },
    trackIdentity: { flex: 1, minWidth: 0 },
    title: { fontSize: compact ? 21 : 23, color: '#fff', marginBottom: 5, ...Editorial.heading },
    artist: { fontSize: 15, color: 'rgba(255,255,255,.82)' },
    album: { fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 4 },
    metrics: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.16)', paddingVertical: compact ? 6 : 9, marginBottom: compact ? 8 : 14 },
    metric: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 6 },
    metricValue: { color: 'rgba(255,255,255,.85)', fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] },
    metricLabel: { color: 'rgba(255,255,255,.42)', fontSize: 9, letterSpacing: 1.5 },
    analysisNote: { color: 'rgba(255,255,255,.55)', fontSize: 11, marginBottom: 8 },
    controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: compact ? 6 : 10, marginBottom: compact ? 12 : 20 },
    transportButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
    playBtn: { width: compact ? 64 : 70, height: compact ? 64 : 70, borderRadius: 35, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
    tools: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.16)', paddingTop: 10 },
    studioButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
    studioLabel: { color: 'rgba(255,255,255,.85)', fontSize: 13 },
    playlistButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44 },
    toolLabel: { color: 'rgba(255,255,255,.85)', fontSize: 12 },
    moreOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.6)' },
    moreSheet: { backgroundColor: '#1c1c21', paddingHorizontal: 24, paddingTop: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
    moreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    moreTitle: { color: '#fff', fontSize: 19, fontWeight: '600' },
    detailRow: { flexDirection: 'row', gap: 16, paddingVertical: 9 },
    detailLabel: { width: 56, color: 'rgba(255,255,255,.5)', fontSize: 12 },
    detailValue: { flex: 1, color: 'rgba(255,255,255,.85)', fontSize: 13 },
    moreAction: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.12)', marginTop: 8 },
    moreActionText: { color: '#fff', fontSize: 14 },

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
    title: { fontSize: Typography.md, color: c.textPrimary, paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm, ...Editorial.heading },
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
