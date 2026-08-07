// <copyright file="PlayerMiniBar.tsx" company="John Narey">
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

import { Ionicons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { Image } from 'expo-image';
import { Keyboard, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { getArtworkUrl, getTrackTitle } from '../api/musicLibrary';
import { useCast } from '../context/CastContext';
import { usePlaybackPosition, usePlaybackStatus, usePlayer } from '../context/PlayerContext';
import { useAppSettings } from '../store/appSettingsStore';
import { usePlayerUI } from '../store/playerUIStore';
import { getArtworkCacheKey, ARTWORK_THUMB_SIZE } from '../services/artworkCache';
import { Radius, Spacing, Typography } from '../theme';

// 44px artwork + Spacing.sm above and below it + the 4px progress strip.
export const MINI_BAR_HEIGHT = 64;

// How much room the mini bar takes above the keyboard once it's lifted there —
// 0 when it isn't showing. Screens with their own bottom input bar (chat, rooms)
// use this to keep that bar clear of it.
export function useMiniBarHeight() {
  const { track } = usePlayer();
  const playerMode = useAppSettings((s) => s.playerMode);
  return track && playerMode === 'bar' ? MINI_BAR_HEIGHT : 0;
}

// Isolated per-tick consumer: only this 2px strip re-renders on each useProgress(250)
// tick, keeping the always-mounted mini-bar body stable while music plays.
const MiniProgressStrip = React.memo(function MiniProgressStrip() {
  const { positionSec, durationSec } = usePlaybackPosition();
  const progress = durationSec > 0 ? Math.min(positionSec / durationSec, 1) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
    </View>
  );
});

export function PlayerMiniBar() {
  const { track, queue, togglePlayPause, next, prev } = usePlayer();
  const { isPlaying } = usePlaybackStatus();
  const { isCasting, isGoogleCasting, castIsPlaying, castTogglePlayPause } = useCast();
  const { expand } = usePlayerUI();

  // Expanding while a chat/room input is focused would otherwise leave the
  // keyboard covering the full player, since it opened over a different screen
  // than the one now on top.
  const expandPlayer = () => {
    Keyboard.dismiss();
    expand();
  };

  const swipePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy < -10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => { if (g.dy < -30 || g.vy < -0.3) expandPlayer(); },
    }),
  ).current;

  if (!track) return null;

  const activeIsPlaying  = isGoogleCasting ? castIsPlaying  : isPlaying;
  const activeTogglePlay = isGoogleCasting ? castTogglePlayPause : togglePlayPause;
  const multiTrack = queue.length > 1;
  const isLocal    = track.path.startsWith('file://') || track.path.startsWith('content://');
  const artUrl     = track.hasArtwork ? (isLocal ? track.coverPath : getArtworkUrl(track.path, ARTWORK_THUMB_SIZE)) : null;
  const artCacheKey = track.hasArtwork && !isLocal ? getArtworkCacheKey(track.path, ARTWORK_THUMB_SIZE) : undefined;

  return (
    <View {...swipePan.panHandlers} style={styles.container}>
      {/* Blurred artwork background. No recyclingKey (the thumbnail below keeps one): clearing
          it on every track change flashed the bar's base colour between covers. Blurred at 18
          the outgoing cover is unreadable anyway, so it holds and cross-dissolves instead. */}
      {artUrl ? (
        <Image blurRadius={18} cachePolicy="memory-disk" contentFit="cover" source={{ uri: artUrl, cacheKey: artCacheKey }} style={StyleSheet.absoluteFill} transition={{ duration: 320, effect: 'cross-dissolve' }} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}
      {/* Dark scrim for legibility */}
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />

      {/* Content row */}
      <Pressable onPress={expandPlayer} style={styles.row}>
        {/* Artwork thumbnail */}
        {artUrl ? (
          <Image cachePolicy="memory-disk" recyclingKey={artCacheKey ?? artUrl} source={{ uri: artUrl, cacheKey: artCacheKey }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artFallback]}>
            <Ionicons color="rgba(255,255,255,0.4)" name="musical-note" size={18} />
          </View>
        )}

        {/* Title + artist */}
        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.title}>
            {getTrackTitle(track)}
          </Text>
          {(track.artist || isCasting) ? (
            <Text numberOfLines={1} style={styles.artist}>
              {[track.artist, isCasting ? 'casting' : null].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <Pressable
            hitSlop={10}
            onPress={(e) => { e.stopPropagation(); prev(); }}
            style={[styles.btn, !multiTrack && styles.btnDisabled]}
          >
            <Ionicons color="#fff" name="play-skip-back" size={22} />
          </Pressable>
          <Pressable hitSlop={10} onPress={(e) => { e.stopPropagation(); activeTogglePlay(); }} style={styles.btn}>
            <Ionicons color="#fff" name={activeIsPlaying ? 'pause' : 'play'} size={26} />
          </Pressable>
          <Pressable
            hitSlop={10}
            onPress={(e) => { e.stopPropagation(); next(); }}
            style={[styles.btn, !multiTrack && styles.btnDisabled]}
          >
            <Ionicons color="#fff" name="play-skip-forward" size={22} />
          </Pressable>
          <Pressable hitSlop={10} onPress={(e) => { e.stopPropagation(); expandPlayer(); }} style={styles.btn}>
            <Ionicons color="rgba(255,255,255,0.5)" name="chevron-up" size={22} />
          </Pressable>
        </View>
      </Pressable>

      {/* Progress strip */}
      <MiniProgressStrip />
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque dark base: the bar is white-on-dark, and a transparent container let the
  // screen behind it (near-white in the light palette) show through any frame where
  // the blurred cover wasn't painted.
  container:   { height: MINI_BAR_HEIGHT, overflow: 'hidden', backgroundColor: '#111' },
  fallbackBg:  { backgroundColor: '#111' },
  scrim:       { backgroundColor: 'rgba(0,0,0,0.52)' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },

  art:        { width: 44, height: 44, borderRadius: Radius.sm },
  artFallback:{ justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },

  info:   { flex: 1, justifyContent: 'center' },
  title:  { fontSize: Typography.base, fontWeight: '600', color: '#fff' },
  artist: { fontSize: Typography.sm, marginTop: 1, color: 'rgba(255,255,255,0.6)' },

  controls:   { flexDirection: 'row', alignItems: 'center' },
  btn:        { padding: Spacing.sm },
  btnDisabled:{ opacity: 0.3 },

  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2 },
  progressFill:  { height: 4, backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 2 },
});
