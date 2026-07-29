// <copyright file="CastContext.tsx" company="John Narey">
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

import { CastContext as GoogleCastContext, CastState, MediaPlayerState, RemoteMediaClient, SessionManager, useCastDevice, useCastSession, useCastState, useDevices } from 'react-native-google-cast';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { NativeModules } from 'react-native';
import { MusicTrack } from '../api/musicLibrary';
import { usePlayer } from './PlayerContext';
import { useAuthStore } from '../store/auth';
import { ensureSigned, signedQuery } from '../api/streamSignatures';

// True only when the Google Cast native module is present (not available in Expo Go)
const CAST_AVAILABLE = !!(NativeModules as any).RNGCCastContext;

// The receiver chooses its playback pipeline from the contentType in the load request, so a
// .flac announced as audio/mpeg is rejected. Same map the stream endpoint serves.
const CONTENT_TYPES: Record<string, string> = {
  mp3:  'audio/mpeg',
  flac: 'audio/flac',
  ogg:  'audio/ogg',
  opus: 'audio/ogg',
  wav:  'audio/wav',
  m4a:  'audio/mp4',
  aac:  'audio/aac',
};

const contentTypeFor = (path: string): string =>
  CONTENT_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'audio/mpeg';

interface CastContextValue {
  // Google Cast
  googleCastState: CastState | null;
  googleDevices: any[];
  googleCastTitle: string | null;
  googleCastDeviceName: string | null;
  isGoogleCasting: boolean;
  castIsPlaying: boolean;
  castPositionSec: number;
  castDurationSec: number;
  castTogglePlayPause: () => void;
  castSeek: (seconds: number) => void;
  connectAndPlayGoogle: (deviceId: string, track: MusicTrack) => Promise<void>;
  showGoogleCastPicker: () => void;
  stopGoogleCast: () => Promise<void>;
  // Combined
  isCasting: boolean;
}

const CastContext = createContext<CastContextValue | null>(null);

export const useCast = (): CastContextValue => {
  const ctx = useContext(CastContext);
  if (!ctx) throw new Error('useCast must be used inside CastProvider');
  return ctx;
};

// ── Google Cast state types ───────────────────────────────────────────────────

interface GCState {
  googleCastState: CastState | null;
  googleDevices: any[];
  googleCastTitle: string | null;
  googleCastDeviceName: string | null;
  isGoogleCasting: boolean;
  castIsPlaying: boolean;
  castPositionSec: number;
  castDurationSec: number;
}

interface GCActions {
  castTogglePlayPause: () => void;
  castSeek: (seconds: number) => void;
  connectAndPlayGoogle: (deviceId: string, track: MusicTrack) => Promise<void>;
  showGoogleCastPicker: () => void;
  stopGoogleCast: () => Promise<void>;
}

const GC_DEFAULT_STATE: GCState = {
  googleCastState:      null,
  googleDevices:        [],
  googleCastTitle:      null,
  googleCastDeviceName: null,
  isGoogleCasting:      false,
  castIsPlaying:        false,
  castPositionSec:      0,
  castDurationSec:      0,
};

// ── GoogleCastLayer — only rendered when CAST_AVAILABLE ───────────────────────
// Keeps all react-native-google-cast hooks here so they're not called when the
// native module is absent (which would crash with "getCastState of null").

interface GoogleCastLayerProps {
  onState:   (s: GCState) => void;
  actionsRef: React.MutableRefObject<GCActions>;
}

function GoogleCastLayer({ onState, actionsRef }: GoogleCastLayerProps) {
  const { track, pause, setSuppressLocalPlay, restoreTrack } = usePlayer();

  const googleCastState = useCastState();
  const castSession     = useCastSession();
  const castDevice      = useCastDevice();
  const googleDevices   = useDevices();

  const isGoogleCasting =
    googleCastState === CastState.CONNECTED ||
    googleCastState === CastState.CONNECTING ||
    castSession != null ||
    castDevice != null;

  const googleCastDeviceName = castDevice?.friendlyName ?? null;

  const nativeClient = useRef(new RemoteMediaClient());
  const [mediaStatus, setMediaStatus] = useState<any>(null);
  const [castPositionSec, setCastPositionSec] = useState(0);

  useEffect(() => {
    if (!isGoogleCasting) return;
    const client = nativeClient.current;

    client.getMediaStatus().then(setMediaStatus).catch(() => {});
    client.getStreamPosition().then(p => setCastPositionSec(p ?? 0)).catch(() => {});

    const statusSub = client.onMediaStatusUpdated(s => { setMediaStatus(s); });

    let active = true;
    const pollPosition = () => {
      if (!active) return;
      client.getStreamPosition().then(p => { if (active) setCastPositionSec(p ?? 0); }).catch(() => {});
      setTimeout(pollPosition, 500);
    };
    pollPosition();

    return () => {
      active = false;
      statusSub.remove();
    };
  }, [isGoogleCasting]);

  const googleCastTitle  = (mediaStatus?.mediaInfo?.metadata as any)?.title ?? null;
  const castIsPlaying    = mediaStatus?.playerState === MediaPlayerState.PLAYING;
  const castDurationSec  = mediaStatus?.mediaInfo?.streamDuration ?? track?.duration ?? 0;

  useEffect(() => {
    setSuppressLocalPlay(isGoogleCasting);
    if (isGoogleCasting) pause();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGoogleCasting]);

  useEffect(() => {
    if (!isGoogleCasting || track || !mediaStatus?.mediaInfo) return;
    const info = mediaStatus.mediaInfo;
    const contentUrl = info.contentUrl ?? '';
    let path = '';
    try {
      const urlPath = contentUrl.split('?')[1] ?? '';
      const params = new URLSearchParams(urlPath);
      path = params.get('path') ?? '';
    } catch {}
    if (!path) return;
    const meta = info.metadata as any;
    const restored: MusicTrack = {
      path,
      filename:    path.split('/').pop() ?? '',
      directory:   path.substring(0, path.lastIndexOf('/')),
      title:       meta?.title    ?? null,
      artist:      meta?.subtitle ?? null,
      album:       meta?.studio   ?? null,
      duration:    info.streamDuration ?? null,
      hasArtwork:  false,
      coverPath:   null,
      albumArtist: null,
      year:        null,
      trackNumber: null,
      discNumber:  null,
      genre:       null,
      bpm:         null,
      key:         null,
      fileSize:    null,
    };
    restoreTrack(restored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGoogleCasting, track, mediaStatus]);

  const pendingTrackRef    = useRef<MusicTrack | null>(null);
  const prevCastTrackPath  = useRef<string | null>(null);

  const loadTrack = useCallback(async (client: typeof nativeClient.current, trackToLoad: MusicTrack) => {
    if (!client) return;
    // The cast device streams independently and holds this URL for the whole track. The path
    // signature is valid for ~24h (well beyond any track), so a fresh signature can't expire
    // mid-playback the way the old 15-min access token could.
    await ensureSigned([trackToLoad.path]);
    const { serverUrl } = useAuthStore.getState();
    const streamUrl = `${serverUrl}/api/v0/musiclibrary/stream?path=${encodeURIComponent(trackToLoad.path)}${signedQuery(trackToLoad.path)}`;
    await client.loadMedia({
      autoplay:    true,
      mediaInfo: {
        contentUrl:  streamUrl,
        contentType: contentTypeFor(trackToLoad.path),
        metadata: {
          type:     'musicTrack',
          title:    trackToLoad.title ?? trackToLoad.filename,
          artist:     trackToLoad.artist ?? '',
          albumTitle: trackToLoad.album ?? '',
        },
      },
    });
  }, []);

  // Wait for a real session: isGoogleCasting is already true while CONNECTING, and a loadMedia
  // sent then is rejected with "No session" — the receiver app takes a few seconds to launch.
  // Remember the path only once the load succeeds, so a rejected load is retried rather than
  // leaving the device connected and silent forever.
  useEffect(() => {
    if (!castSession || !track) return;
    if (track.path === prevCastTrackPath.current) return;
    loadTrack(nativeClient.current, track)
      .then(() => { prevCastTrackPath.current = track.path; })
      .catch(() => {});
  }, [track, castSession, loadTrack]);

  // These reject when the receiver has no media loaded; nothing can be done about it here, and
  // an unhandled rejection puts a redbox over the player.
  const castTogglePlayPause = useCallback(() => {
    if (!nativeClient.current) return;
    const c = nativeClient.current;
    (castIsPlaying ? c.pause() : c.play()).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeClient.current, castIsPlaying]);

  const castSeek = useCallback((seconds: number) => {
    nativeClient.current?.seek({ position: seconds }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeClient.current]);

  const connectAndPlayGoogle = useCallback(async (deviceId: string, trackToPlay: MusicTrack) => {
    pendingTrackRef.current = trackToPlay;
    const sessionManager = new SessionManager();
    await sessionManager.startSession(deviceId);
    // Wait for the cast session to be fully ready before loading media
    await new Promise<void>((r) => setTimeout(r, 800));
    if (pendingTrackRef.current) {
      const t = pendingTrackRef.current;
      pendingTrackRef.current = null;
      prevCastTrackPath.current = t.path;
      loadTrack(nativeClient.current, t).catch(() => {});
    }
  }, [loadTrack]);

  const showGoogleCastPicker = useCallback(() => {
    GoogleCastContext.showCastDialog();
  }, []);

  const stopGoogleCast = useCallback(async () => {
    pendingTrackRef.current = null;
    prevCastTrackPath.current = null;
    await GoogleCastContext.getSessionManager().endCurrentSession(true);
  }, []);

  // Report state to parent
  useEffect(() => {
    onState({
      googleCastState: googleCastState ?? null,
      googleDevices,
      googleCastTitle,
      googleCastDeviceName,
      isGoogleCasting,
      castIsPlaying,
      castPositionSec,
      castDurationSec,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleCastState, googleDevices, googleCastTitle, googleCastDeviceName,
      isGoogleCasting, castIsPlaying, castPositionSec, castDurationSec]);

  // Keep actions ref current
  useEffect(() => {
    actionsRef.current = { castTogglePlayPause, castSeek, connectAndPlayGoogle, showGoogleCastPicker, stopGoogleCast };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castTogglePlayPause, castSeek, connectAndPlayGoogle, showGoogleCastPicker, stopGoogleCast]);

  return null;
}

// ── CastProvider ──────────────────────────────────────────────────────────────

export const CastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ── Google Cast state (managed by GoogleCastLayer when available) ────────────
  const [gcState, setGcState] = useState<GCState>(GC_DEFAULT_STATE);
  const gcActionsRef = useRef<GCActions>({
    castTogglePlayPause: () => {},
    castSeek:            () => {},
    connectAndPlayGoogle: async () => {},
    showGoogleCastPicker: () => {},
    stopGoogleCast:       async () => {},
  });

  // Stable wrappers that always delegate to the latest ref values
  const castTogglePlayPause  = useCallback(() => gcActionsRef.current.castTogglePlayPause(), []);
  const castSeek             = useCallback((s: number) => gcActionsRef.current.castSeek(s), []);
  const connectAndPlayGoogle = useCallback((id: string, t: MusicTrack) => gcActionsRef.current.connectAndPlayGoogle(id, t), []);
  const showGoogleCastPicker = useCallback(() => gcActionsRef.current.showGoogleCastPicker(), []);
  const stopGoogleCast       = useCallback(() => gcActionsRef.current.stopGoogleCast(), []);

  return (
    <CastContext.Provider value={{
      ...gcState,
      castTogglePlayPause, castSeek, connectAndPlayGoogle, showGoogleCastPicker, stopGoogleCast,
      isCasting: gcState.isGoogleCasting,
    }}>
      {CAST_AVAILABLE && (
        <GoogleCastLayer onState={setGcState} actionsRef={gcActionsRef} />
      )}
      {children}
    </CastContext.Provider>
  );
};
