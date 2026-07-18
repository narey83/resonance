// <copyright file="PlayerBubble.tsx" company="John Narey">
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

// Floating "chat-head" player. A circular album-art disc that hovers over the
// app, can be dragged anywhere, snaps to the nearest screen edge, and — on tap —
// hands its on-screen rect to PlayerOverlay so the full player can morph open
// from exactly where the bubble sits. Flinging it down tucks it to a recoverable
// peek nub on the edge (music never loses its controls).

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getArtworkUrl } from '../api/musicLibrary';
import { usePlaybackPosition, usePlaybackStatus, usePlayer } from '../context/PlayerContext';
import { useCast } from '../context/CastContext';
import { useTheme } from '../context/ThemeContext';
import { usePlayerUI } from '../store/playerUIStore';
import { useBubblePos, BubbleSide } from '../store/bubbleStore';
import { getArtworkCacheKey, ARTWORK_THUMB_SIZE } from '../services/artworkCache';
import { haptics } from '../lib/haptics';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const SIZE          = 80;   // bubble diameter
const RING_STROKE   = 3.5;  // progress-ring thickness
const MARGIN        = 12;   // gap from the screen edge
const TAB_RESERVE   = 96;   // keep the bubble clear of the floating tab bar
const TAP_SLOP      = 8;    // movement (px) under which a gesture counts as a tap
const FLING_DOWN    = 1.1;  // vy above which a downward fling dismisses
const PEEK          = 0.55; // fraction of the bubble left visible when tucked
const LONG_PRESS_MS = 330;  // hold this long (without moving) to reveal controls
const CTRL_W        = 168;  // controls-pill width

// ── Progress ring ───────────────────────────────────────────────────────────
// Isolated per-tick consumer: only this SVG re-renders on each useProgress(250)
// tick, keeping the draggable bubble body (and its PanResponder) stable.
const BubbleRing = React.memo(function BubbleRing({ color }: { color: string }) {
  const { positionSec, durationSec } = usePlaybackPosition();
  const progress = durationSec > 0 ? Math.min(positionSec / durationSec, 1) : 0;
  const r = (SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg height={SIZE} style={StyleSheet.absoluteFill} width={SIZE}>
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke="rgba(0,0,0,0.35)" strokeWidth={RING_STROKE} fill="none" />
      <Circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={r}
        stroke={color}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        fill="none"
        // Start the ring at 12 o'clock and sweep clockwise.
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </Svg>
  );
});

const xForSide = (side: BubbleSide) => (side === 'left' ? MARGIN : SCREEN_W - SIZE - MARGIN);

export function PlayerBubble() {
  const { colors } = useTheme();
  const { track, queue, togglePlayPause, next, prev } = usePlayer();
  const { isPlaying } = usePlaybackStatus();
  const { isCasting } = useCast();
  const { expanded, expand } = usePlayerUI();
  const { side, y, loaded, load, save } = useBubblePos();

  const insets = useSafeAreaInsets();
  const minY = insets.top + MARGIN;
  const maxY = SCREEN_H - insets.bottom - TAB_RESERVE - SIZE;
  const clampY = (v: number) => Math.max(minY, Math.min(maxY, v));

  // Live position of the bubble's top-left corner. Seeded to a sensible default
  // (right edge, ~62% down) until the persisted spot loads.
  const defaultY = clampY(SCREEN_H * 0.62);
  const pos     = useRef(new Animated.ValueXY({ x: xForSide('right'), y: defaultY })).current;
  const posRef  = useRef({ x: xForSide('right'), y: defaultY });
  const sideRef = useRef<BubbleSide>('right');
  const tuckedRef = useRef(false);
  const opacity   = useRef(new Animated.Value(1)).current;
  const artScale  = useRef(new Animated.Value(1)).current;

  const [artworkError, setArtworkError] = useState(false);

  // Hold-for-controls popover.
  const [controls, setControls] = useState<{ left: number; top: number } | null>(null);
  const controlsScale   = useRef(new Animated.Value(0)).current;
  const controlsOpenRef = useRef(false);
  const longTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef     = useRef(false);
  const clearLong       = () => { if (longTimer.current) { clearTimeout(longTimer.current); longTimer.current = null; } };

  useEffect(() => {
    const id = pos.addListener((v) => { posRef.current = v; });
    return () => pos.removeListener(id);
  }, [pos]);

  // Load the persisted resting spot once.
  useEffect(() => { load(); }, [load]);

  // Apply the persisted spot when it arrives (y === 0 means "never placed" → keep default).
  useEffect(() => {
    if (!loaded) return;
    if (y > 0) {
      sideRef.current = side;
      pos.setValue({ x: xForSide(side), y: clampY(y) });
    } else {
      // Persist the seeded default so subsequent launches are stable.
      save('right', defaultY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Reset artwork-error latch on track change.
  const prevPath = useRef<string | null>(null);
  if (track?.path !== prevPath.current) {
    prevPath.current = track?.path ?? null;
    if (artworkError) setArtworkError(false);
  }

  // Gentle breathe with play state (mirrors the overlay artwork).
  useEffect(() => {
    Animated.spring(artScale, { toValue: isPlaying ? 1 : 0.9, useNativeDriver: true, tension: 120, friction: 9 }).start();
  }, [isPlaying, artScale]);

  // Hide while the full player is open (the overlay owns the visuals during the morph).
  // NB: JS driver (not native) — this shares the bubble node with the drag-driven
  // `pos` transform, and a node can't mix native + JS driven animations.
  useEffect(() => {
    Animated.timing(opacity, { toValue: expanded ? 0 : 1, duration: expanded ? 120 : 220, useNativeDriver: false }).start();
    if (expanded && controlsOpenRef.current) closeControls();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Dismiss the controls popover if the track disappears out from under it.
  useEffect(() => {
    if (!track && controlsOpenRef.current) closeControls();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useEffect(() => clearLong, []);

  const settle = (nextSide: BubbleSide, nextY: number, isTucked: boolean) => {
    sideRef.current = nextSide;
    tuckedRef.current = isTucked;
    const restX = isTucked
      ? (nextSide === 'left' ? -(SIZE * PEEK) : SCREEN_W - SIZE + SIZE * PEEK)
      : xForSide(nextSide);
    Animated.parallel([
      Animated.spring(pos, { toValue: { x: restX, y: nextY }, useNativeDriver: false, tension: 90, friction: 12 }),
      Animated.timing(opacity, { toValue: isTucked ? 0.5 : 1, duration: 180, useNativeDriver: false }),
    ]).start();
    if (!isTucked) save(nextSide, nextY);
  };

  const openFull = () => {
    haptics.light();
    const { x, y: cy } = posRef.current;
    expand({ x, y: cy, size: SIZE });
  };

  const openControls = () => {
    haptics.selection();
    controlsOpenRef.current = true;
    const { x, y: by } = posRef.current;
    const onRight = x + SIZE / 2 > SCREEN_W / 2;
    const left = onRight ? x - CTRL_W - 8 : x + SIZE + 8;
    const top  = Math.max(minY, Math.min(maxY, by + SIZE / 2 - 28));
    setControls({ left: Math.max(8, Math.min(SCREEN_W - CTRL_W - 8, left)), top });
    controlsScale.setValue(0);
    Animated.spring(controlsScale, { toValue: 1, useNativeDriver: true, tension: 200, friction: 15 }).start();
  };

  const closeControls = () => {
    controlsOpenRef.current = false;
    Animated.timing(controlsScale, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => setControls(null));
  };

  // Absolute top-left the drag started from — combined with the gesture delta so
  // `pos` (and thus posRef via its listener) always holds true window coordinates.
  const startRef = useRef({ x: 0, y: 0 });

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          pos.stopAnimation();
          startRef.current = { ...posRef.current };
          longFiredRef.current = false;
          // Hold (without moving, when parked normally) → reveal controls.
          if (!tuckedRef.current) {
            clearLong();
            longTimer.current = setTimeout(() => { longFiredRef.current = true; openControls(); }, LONG_PRESS_MS);
          }
        },
        onPanResponderMove: (_, g) => {
          if (Math.hypot(g.dx, g.dy) > TAP_SLOP) {
            clearLong();
            if (controlsOpenRef.current) closeControls();
          }
          pos.setValue({ x: startRef.current.x + g.dx, y: startRef.current.y + g.dy });
        },
        onPanResponderRelease: (_, g) => {
          clearLong();
          const moved = Math.hypot(g.dx, g.dy);

          // The hold already opened the controls — leave them up, do nothing else.
          if (longFiredRef.current) return;

          // Tap → open (or untuck if parked; or dismiss open controls).
          if (moved < TAP_SLOP) {
            if (tuckedRef.current) {
              haptics.selection();
              settle(sideRef.current, clampY(posRef.current.y), false);
            } else {
              if (controlsOpenRef.current) closeControls();
              openFull();
            }
            return;
          }

          const cx = posRef.current.x + SIZE / 2;
          const nextSide: BubbleSide = cx < SCREEN_W / 2 ? 'left' : 'right';
          const nextY = clampY(posRef.current.y);

          // Fast downward fling, or dropped into the bottom dismiss band → tuck away.
          const inDismissBand = posRef.current.y + SIZE / 2 > maxY - 8;
          if (g.vy > FLING_DOWN || inDismissBand) {
            haptics.skip();
            settle(nextSide, nextY, true);
          } else {
            haptics.selection();
            settle(nextSide, nextY, false);
          }
        },
        onPanResponderTerminate: () => {
          clearLong();
          if (longFiredRef.current) return;
          settle(sideRef.current, clampY(posRef.current.y), tuckedRef.current);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!track) return null;

  const isLocal      = track.path.startsWith('file://') || track.path.startsWith('content://');
  const artUrl       = track.hasArtwork ? (isLocal ? track.coverPath : getArtworkUrl(track.path, ARTWORK_THUMB_SIZE)) : null;
  const artCacheKey  = track.hasArtwork && !isLocal ? getArtworkCacheKey(track.path, ARTWORK_THUMB_SIZE) : undefined;
  const showArt      = !!artUrl && !artworkError;
  const inset        = RING_STROKE + 2;
  const artSize      = SIZE - inset * 2;
  const multiTrack   = queue.length > 1;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        {...pan.panHandlers}
        pointerEvents={expanded ? 'none' : 'auto'}
        style={[
          styles.bubble,
          { opacity, transform: [{ translateX: pos.x }, { translateY: pos.y }] },
        ]}
      >
        <BubbleRing color={colors.accent} />
        <Animated.View style={[styles.artWrap, { width: artSize, height: artSize, borderRadius: artSize / 2, transform: [{ scale: artScale }] }]}>
          {showArt ? (
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              onError={() => setArtworkError(true)}
              source={{ uri: artUrl!, cacheKey: artCacheKey }}
              style={{ width: artSize, height: artSize }}
            />
          ) : (
            <View style={[styles.artFallback, { width: artSize, height: artSize, backgroundColor: colors.accent }]}>
              <Ionicons color="#fff" name="musical-note" size={22} />
            </View>
          )}
        </Animated.View>
        {isCasting && (
          <View style={styles.castBadge}>
            <Ionicons color="#fff" name="wifi" size={10} />
          </View>
        )}
      </Animated.View>

      {/* Hold-for-controls popover: transport without opening the full player. */}
      {controls && !expanded && (
        <>
          <Pressable onPress={closeControls} style={StyleSheet.absoluteFill} />
          <Animated.View
            style={[
              styles.ctrlPill,
              { left: controls.left, top: controls.top, opacity: controlsScale, transform: [{ scale: controlsScale }] },
            ]}
          >
            <Pressable
              disabled={!multiTrack}
              hitSlop={6}
              onPress={() => { haptics.skip(); prev(); }}
              style={[styles.ctrlBtn, !multiTrack && styles.ctrlDisabled]}
            >
              <Ionicons color="#fff" name="play-skip-back" size={22} />
            </Pressable>
            <Pressable hitSlop={6} onPress={() => { haptics.light(); togglePlayPause(); }} style={styles.ctrlBtn}>
              <Ionicons color="#fff" name={isPlaying ? 'pause' : 'play'} size={28} />
            </Pressable>
            <Pressable
              disabled={!multiTrack}
              hitSlop={6}
              onPress={() => { haptics.skip(); next(); }}
              style={[styles.ctrlBtn, !multiTrack && styles.ctrlDisabled]}
            >
              <Ionicons color="#fff" name="play-skip-forward" size={22} />
            </Pressable>
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Float above the app content.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 10,
  },
  artWrap: {
    overflow: 'hidden',
  },
  artFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  castBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlPill: {
    position: 'absolute',
    width: CTRL_W,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(22,22,24,0.96)',
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 12,
  },
  ctrlBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlDisabled: {
    opacity: 0.3,
  },
});
