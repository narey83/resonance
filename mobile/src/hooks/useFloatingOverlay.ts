// <copyright file="useFloatingOverlay.ts" company="John Narey">
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-only
//   Part of Resonance, a Soulseek client based on slskd.
// </copyright>
//
// Drives the native Android floating overlay from player state and routes its
// transport taps back to TrackPlayer. When the overlay is the active controller
// (Android + bubble mode + permission granted) it replaces the in-app JS bubble,
// so exactly one controller is ever on screen — but this one works over other
// apps and the home screen too.

import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LegacyFS from 'expo-file-system/legacy';
import { usePlaybackStatus, usePlayer } from '../context/PlayerContext';
import { usePlayerUI } from '../store/playerUIStore';
import { useAppSettings } from '../store/appSettingsStore';
import { MusicTrack, getArtworkUrl, getTrackTitle } from '../api/musicLibrary';
import { ensureSigned } from '../api/streamSignatures';
import { ARTWORK_THUMB_SIZE } from '../services/artworkCache';
import { floatingOverlay, OverlayState } from '../native/floatingOverlay';

// Resolve artwork to base64 for the native overlay. Remote covers are downloaded
// straight to a temp file from the signed URL (a plain GET, exactly how the list's
// <Image> loads them) — no fetch/blob/FileReader, no expo-image cache guessing.
async function artToBase64(track: MusicTrack): Promise<string | null> {
  try {
    if (!track.hasArtwork) return null;
    const isLocal = track.path.startsWith('file://') || track.path.startsWith('content://');
    if (isLocal) {
      // Only readable file:// covers can be base64'd cheaply; skip content:// for now.
      if (!track.coverPath || !track.coverPath.startsWith('file://')) return null;
      return await LegacyFS.readAsStringAsync(track.coverPath, { encoding: LegacyFS.EncodingType.Base64 });
    }
    // The artwork URL is HMAC-signed; make sure this path's signature is cached first.
    await ensureSigned([track.path]);
    const url = getArtworkUrl(track.path, ARTWORK_THUMB_SIZE);
    if (!url) return null;
    const tmp = `${LegacyFS.cacheDirectory}overlay-art.jpg`;
    const res = await LegacyFS.downloadAsync(url, tmp);
    if (res.status !== 200) return null;
    return await LegacyFS.readAsStringAsync(tmp, { encoding: LegacyFS.EncodingType.Base64 });
  } catch {
    return null;
  }
}

export function useFloatingOverlay(): { overlayActive: boolean } {
  const { track, togglePlayPause, next, prev } = usePlayer();
  const { isPlaying } = usePlaybackStatus();
  const playerMode = useAppSettings((s) => s.playerMode);
  const expanded = usePlayerUI((s) => s.expanded);
  const [granted, setGranted] = useState(false);

  const supported = Platform.OS === 'android' && floatingOverlay.supported;
  const overlayActive = supported && playerMode === 'bubble' && granted;

  // Keep transport handlers fresh without resubscribing the native listener.
  const actionsRef = useRef({ togglePlayPause, next, prev });
  actionsRef.current = { togglePlayPause, next, prev };

  // Track the current play state for the async art callback.
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;

  // Re-check the overlay permission on mount and whenever we return to foreground
  // (the user may have just granted it in system settings).
  useEffect(() => {
    if (!supported) return;
    let mounted = true;
    const check = () => floatingOverlay.hasPermission().then((v) => { if (mounted) setGranted(v); });
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { mounted = false; sub.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route native transport taps to the player (once).
  useEffect(() => {
    if (!supported) return;
    return floatingOverlay.onAction((e) => {
      const a = actionsRef.current;
      if (e.action === 'play' || e.action === 'pause') a.togglePlayPause();
      else if (e.action === 'next') a.next();
      else if (e.action === 'prev') a.prev();
      else if (e.action === 'open') {
        // Morph the full player out of the native bubble's rect when provided.
        const from = e.x != null && e.y != null && e.size != null
          ? { x: e.x, y: e.y, size: e.size }
          : undefined;
        usePlayerUI.getState().expand(from);
      }
    });
  }, [supported]);

  // Show/refresh the overlay with the current metadata + play state. Art omitted
  // here (the native side preserves the existing bitmap); it's loaded separately.
  useEffect(() => {
    if (!overlayActive || !track) { floatingOverlay.hide(); return; }
    floatingOverlay.show({ title: getTrackTitle(track), artist: track.artist ?? '', isPlaying });
  }, [overlayActive, track, isPlaying]);

  // Load artwork only when the track changes (base64 is comparatively expensive).
  useEffect(() => {
    if (!overlayActive || !track) return;
    let cancelled = false;
    artToBase64(track).then((artBase64) => {
      if (cancelled) return;
      const state: OverlayState = {
        title: getTrackTitle(track),
        artist: track.artist ?? '',
        isPlaying: playingRef.current,
        artBase64,
      };
      floatingOverlay.update(state);
    });
    return () => { cancelled = true; };
  // Keyed on the track path — reloading art only when the track actually changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayActive, track?.path]);

  // Hide the pill (without destroying it — art/position preserved) while the
  // in-app full player is open; the full player supersedes it.
  useEffect(() => {
    if (!overlayActive || !track) return;
    floatingOverlay.setVisible(!expanded);
  }, [expanded, overlayActive, track]);

  // Tear down when the overlay stops being the active controller / on unmount.
  useEffect(() => {
    if (!overlayActive) floatingOverlay.hide();
    return () => floatingOverlay.hide();
  }, [overlayActive]);

  return { overlayActive };
}
