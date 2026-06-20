import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Image } from 'expo-image';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { getArtworkUrl, getTrackTitle } from '../api/musicLibrary';
import { useCast } from '../context/CastContext';
import { usePlaybackStatus, usePlayer } from '../context/PlayerContext';
import { usePlayerUI } from '../store/playerUIStore';
import { getArtworkCacheKey } from '../services/artworkCache';
import { Radius, Spacing, Typography } from '../theme';

export function PlayerMiniBar() {
  const { track, queue, togglePlayPause, next, prev } = usePlayer();
  const { isPlaying, positionSec, durationSec } = usePlaybackStatus();
  const { isCasting, isGoogleCasting, castIsPlaying, castTogglePlayPause } = useCast();
  const { expand } = usePlayerUI();

  const prevPath = useRef<string | null>(null);
  useEffect(() => {
    if (track && track.path !== prevPath.current) {
      prevPath.current = track.path;
      expand();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.path]);

  const swipePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy < -10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => { if (g.dy < -30 || g.vy < -0.3) expand(); },
    }),
  ).current;

  if (!track) return null;

  const activeIsPlaying  = isGoogleCasting ? castIsPlaying  : isPlaying;
  const activeTogglePlay = isGoogleCasting ? castTogglePlayPause : togglePlayPause;
  const multiTrack = queue.length > 1;
  const progress   = durationSec > 0 ? Math.min(positionSec / durationSec, 1) : 0;
  const isLocal    = track.path.startsWith('file://') || track.path.startsWith('content://');
  const artUrl     = track.hasArtwork ? (isLocal ? track.coverPath : getArtworkUrl(track.path, 96)) : null;
  const artCacheKey = track.hasArtwork && !isLocal ? getArtworkCacheKey(track.path, 96) : undefined;

  return (
    <View {...swipePan.panHandlers} style={styles.container}>
      {/* Blurred artwork background */}
      {artUrl ? (
        <Image blurRadius={18} contentFit="cover" source={{ uri: artUrl, cacheKey: artCacheKey }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
      )}
      {/* Dark scrim for legibility */}
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />

      {/* Content row */}
      <Pressable onPress={expand} style={styles.row}>
        {/* Artwork thumbnail */}
        {artUrl ? (
          <Image source={{ uri: artUrl, cacheKey: artCacheKey }} style={styles.art} />
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
          <Pressable hitSlop={10} onPress={(e) => { e.stopPropagation(); expand(); }} style={styles.btn}>
            <Ionicons color="rgba(255,255,255,0.5)" name="chevron-up" size={22} />
          </Pressable>
        </View>
      </Pressable>

      {/* Progress strip */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { overflow: 'hidden' },
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

  progressTrack: { height: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  progressFill:  { height: 2, backgroundColor: 'rgba(255,255,255,0.8)' },
});
