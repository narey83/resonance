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

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CastButton } from 'react-native-google-cast';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
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
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaybackPosition, usePlaybackStatus, usePlayer } from '../context/PlayerContext';
import { useCast } from '../context/CastContext';
import { useTheme } from '../context/ThemeContext';
import { MusicTrack, getArtworkUrl, getTrackTitle } from '../api/musicLibrary';
import { isSigned } from '../api/streamSignatures';
import { getArtworkCacheKey, PLAYER_ART_SIZE } from '../services/artworkCache';
import { useMixtapeStore } from '../store/mixtapeStore';
import { useLibraryActivityStore } from '../store/libraryActivityStore';
import { usePlayerUI } from '../store/playerUIStore';
import { haptics } from '../lib/haptics';
import { Radius, Spacing, ThemeColors, Typography } from '../theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
// Inset from the screen edges so the cover floats rather than going full-bleed.
const ARTWORK_SIZE = Math.min(SCREEN_W - 48, Math.round(SCREEN_H * 0.5));
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

const ProgressBar = ({
  positionSec, durationSec, onSeek,
}: { positionSec: number; durationSec: number; onSeek: (s: number) => void }) => {
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
        <View style={{ height: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3 }} />
        <View style={{ position: 'absolute', height: 5, backgroundColor: '#fff', borderRadius: 3, width: `${progress * 100}%` }} />
        <View style={{
          position: 'absolute',
          width: dragging ? 28 : 22, height: dragging ? 28 : 22, borderRadius: 14,
          backgroundColor: '#fff', top: '50%',
          marginTop: dragging ? -14 : -11, marginLeft: dragging ? -14 : -11,
          left: `${progress * 100}%` as any,
        }} />
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
const ActiveProgressBar = ({ isGoogleCasting, castPositionSec, castDurationSec, onSeek }: {
  isGoogleCasting: boolean; castPositionSec: number; castDurationSec: number; onSeek: (s: number) => void;
}) => {
  const { positionSec, durationSec } = usePlaybackPosition();
  return (
    <ProgressBar
      durationSec={isGoogleCasting ? castDurationSec : durationSec}
      onSeek={onSeek}
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

function FeatheredArt({ uri, cacheKey, style, onError }: {
  uri: string; cacheKey?: string; style: any; onError: () => void;
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
        <Image cachePolicy="memory-disk" contentFit="cover" onError={onError} source={{ uri, cacheKey }} style={style} />
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
  const { expanded, collapse, morphFrom } = usePlayerUI();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const { track, shuffle, queue, queueIndex, repeatMode, cycleRepeat, togglePlayPause, next, prev, seekTo, toggleShuffle, skipToIndex, stopPlayer } = usePlayer();
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
  const lovedPaths   = useLibraryActivityStore((st) => st.lovedPaths);
  const toggleLove   = useLibraryActivityStore((st) => st.toggleLove);
  const isLoved = track ? lovedPaths.has(track.path) : false;
  const inMixtape = track ? mixtapes.some((pl) => pl.tracks.some((t) => t.filePath === track.path)) : false;

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

  const queuePanelX = queueX.interpolate({ inputRange: [-SCREEN_W, 0], outputRange: [0, SCREEN_W] });
  // Drive the Artwork/Queue toggle: the active tab is bright, the inactive one dim, and they
  // cross-fade as the panels swipe (queueX: 0 = artwork, -SCREEN_W = queue).
  const artTabOpacity   = queueX.interpolate({ inputRange: [-SCREEN_W, 0], outputRange: [0.45, 1] });
  const queueTabOpacity = queueX.interpolate({ inputRange: [-SCREEN_W, 0], outputRange: [1, 0.45] });

  // Animate to a panel from a tap on the toggle (mirrors the swipe gesture's end state).
  const goToPanel = (showQueue: boolean) => {
    const target = showQueue ? -SCREEN_W : 0;
    if (queueBaseX.current === target) return;
    haptics.selection();
    queueBaseX.current = target;
    queueShowingRef.current = showQueue;
    setQueueShowing(showQueue);
    Animated.spring(queueX, { toValue: target, useNativeDriver: true, tension: 220, friction: 26 }).start();
  };

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
    const target = mustShowQueue ? -SCREEN_W : 0;
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadMixtapes(); }, []);

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
  const hasArt          = !!(artworkUrl && !artworkError);
  const title      = track ? getTrackTitle(track) : '';
  const artist     = track?.artist ?? '';
  const album      = track?.album  ?? '';
  const folder     = track ? (track.directory.split('/').filter(Boolean).pop() ?? track.directory) : '';

  // ── Morph geometry ──
  // Background, chrome and hero all read off the single expandP value. In mini-bar
  // mode expandP rests at 1, so these evaluate to the fully-open state and the
  // hero (which is only rendered when morphFrom is set) never appears.
  const bgOpacity     = expandP.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] });
  const chromeOpacity = expandP.interpolate({ inputRange: [0, 0.5, 0.85, 1], outputRange: [0, 0, 1, 1] });
  const heroOpacity   = expandP.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1, 1, 0] });
  const artTarget = artRect ?? {
    x: (SCREEN_W - ARTWORK_SIZE) / 2,
    y: Math.max(insets.top + 60, SCREEN_H * 0.42 - ARTWORK_SIZE / 2),
    size: ARTWORK_SIZE,
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
              source={{ uri: artworkUrl!, cacheKey: artworkCacheKey }}
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
            {/* Dismiss handle */}
            <View style={[s.handleBar, { paddingTop: insets.top + Spacing.xs }]}>
              <Pressable hitSlop={16} onPress={collapse} style={s.handleInner}>
                <Animated.View style={{ transform: [{ translateY: chevronNudge }] }}>
                  <Ionicons color="rgba(255,255,255,0.55)" name="chevron-down" size={24} />
                </Animated.View>
              </Pressable>
              {queue.length > 1 && (
                <Text style={s.queueInfo}>{queueIndex + 1} of {queue.length}</Text>
              )}
            </View>

            {/* Artwork / Queue panels — swipe left to see queue, right to return */}
            <View style={s.panelContainer} {...(hasArt ? artworkQueuePan.panHandlers : {})}>
              {/* Artwork panel — only when artwork is available */}
              {hasArt && (
                <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: queueX }] }]}>
                  <View style={s.artworkWrap}>
                    {/* Non-transformed wrapper so measureInWindow yields the true
                        resting rect the bubble morphs into (scale-breathing is inside). */}
                    <View ref={artWrapRef} onLayout={measureArt} style={{ width: ARTWORK_SIZE, height: ARTWORK_SIZE }}>
                      <Animated.View style={{ transform: [{ scale: artScale }] }}>
                        <FeatheredArt
                          cacheKey={artworkCacheKey}
                          onError={() => {
                            console.warn(`[player-art] cover failed to load — signed=${artworkUrl?.includes('sig=')} ${track?.path}`);
                            setArtworkError(true);
                          }}
                          style={s.artwork}
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

            {/* Artwork / Queue toggle — tap or swipe to switch; only when artwork is present */}
            {hasArt && (
              <View style={s.segmentRow}>
                <Pressable hitSlop={8} onPress={() => goToPanel(false)}>
                  <Animated.View style={[s.segment, { opacity: artTabOpacity }]}>
                    <Ionicons color="#fff" name="disc" size={14} />
                    <Text style={s.segmentText}>Artwork</Text>
                  </Animated.View>
                </Pressable>
                <Pressable hitSlop={8} onPress={() => goToPanel(true)}>
                  <Animated.View style={[s.segment, { opacity: queueTabOpacity }]}>
                    <Ionicons color="#fff" name="list" size={16} />
                    <Text style={s.segmentText}>Queue</Text>
                  </Animated.View>
                </Pressable>
              </View>
            )}

            {/* Info + controls */}
            <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xxl) }]}>

              {/* Title row — full width, on its own */}
              <View style={s.titleRow}>
                <MarqueeText style={s.title} text={title} />
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

              {/* Tags — sit just under the title/artist */}
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

              {/* Action row — shuffle / repeat (left) · love / mixtape / cast (right) */}
              <View style={s.actionRow}>
                <View style={s.actionRowLeft}>
                  <Pressable hitSlop={12} onPress={() => { haptics.selection(); toggleShuffle(); }} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}>
                    <Ionicons color={shuffle ? '#fff' : 'rgba(255,255,255,0.4)'} name="shuffle" size={22} />
                  </Pressable>
                  <Pressable hitSlop={12} onPress={() => { haptics.selection(); cycleRepeat(); }} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}>
                    <MaterialCommunityIcons
                      color={repeatMode === 'off' ? 'rgba(255,255,255,0.4)' : colors.accent}
                      name={repeatMode === 'track' ? 'repeat-once' : repeatMode === 'queue' ? 'repeat' : 'repeat-off'}
                      size={22}
                    />
                  </Pressable>
                </View>
                <View style={s.actionRowRight}>
                  <Pressable hitSlop={12} onPress={() => { haptics.light(); toggleLove(track.path); }} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}>
                    <Ionicons color={isLoved ? '#e05a7a' : 'rgba(255,255,255,0.6)'} name={isLoved ? 'heart' : 'heart-outline'} size={24} />
                  </Pressable>
                  <Pressable hitSlop={12} onPress={() => setMixtapeModalVisible(true)} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}>
                    <Ionicons color={inMixtape ? colors.accent : 'rgba(255,255,255,0.6)'} name={inMixtape ? 'radio' : 'radio-outline'} size={24} />
                  </Pressable>
                  <CastButton style={{ width: 24, height: 24, tintColor: isCasting ? colors.accent : 'rgba(255,255,255,0.6)' }} />
                  {/* Close the player outright — stops playback, empties the queue and drops the
                      notification. The shade can't do this (see stopPlayer). */}
                  <Pressable
                    hitSlop={12}
                    onPress={() => { haptics.light(); collapse(); stopPlayer(); }}
                    style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.5 }]}
                  >
                    <Ionicons color="rgba(255,255,255,0.6)" name="power" size={24} />
                  </Pressable>
                </View>
              </View>

              {/* Progress */}
              <ActiveProgressBar castDurationSec={castDurationSec} castPositionSec={castPositionSec} isGoogleCasting={isGoogleCasting} onSeek={activeSeek} />

              {/* Transport controls */}
              <View style={s.controls}>
                {/* Spacer to keep the play button centered (shuffle moved to the action row) */}
                <View style={{ width: 22, height: 22 }} />

                <Pressable
                  disabled={!canSkip}
                  hitSlop={12}
                  onPress={() => { haptics.skip(); prev(); }}
                  style={({ pressed }) => [{ opacity: !canSkip ? 0.3 : pressed ? 0.5 : 1 }]}
                >
                  <Ionicons color="#fff" name="play-skip-back" size={34} />
                </Pressable>

                <Pressable onPress={() => { haptics.light(); activeTogglePlay(); }} style={s.playBtn}>
                  {isBuffering && !isGoogleCasting
                    ? <ActivityIndicator color="#111" size="small" />
                    : <Ionicons color="#111" name={activeIsPlaying ? 'pause' : 'play'} size={32} />}
                </Pressable>

                <Pressable
                  disabled={!canSkip}
                  hitSlop={12}
                  onPress={() => { haptics.skip(); next(); }}
                  style={({ pressed }) => [{ opacity: !canSkip ? 0.3 : pressed ? 0.5 : 1 }]}
                >
                  <Ionicons color="#fff" name="play-skip-forward" size={34} />
                </Pressable>

                {/* Spacer to keep the play button centered (repeat moved to the action row) */}
                <View style={{ width: 22, height: 22 }} />
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

    segmentRow:  { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm, paddingBottom: Spacing.sm },
    segment: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: Spacing.md, paddingVertical: 6,
      borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.12)',
    },
    segmentText: { fontSize: Typography.xs, color: '#fff', fontWeight: '600', letterSpacing: 0.3 },
    artwork: {
      width: ARTWORK_SIZE,
      height: ARTWORK_SIZE,
      borderRadius: 0,
    },
    // Bottom section — info, progress, controls
    bottom: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xs },

    titleRow: { marginBottom: Spacing.md },
    title:    { fontSize: 21, fontWeight: '700', color: '#fff', marginBottom: Spacing.xs, letterSpacing: -0.3 },
    artist:   { fontSize: Typography.base, color: 'rgba(255,255,255,0.65)' },
    folderRow:{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs },
    folder:   { fontSize: Typography.xs, color: 'rgba(255,255,255,0.38)', flex: 1 },
    actionRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
    actionRowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
    actionRowRight:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
    iconBtn:  { padding: 4 },

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
