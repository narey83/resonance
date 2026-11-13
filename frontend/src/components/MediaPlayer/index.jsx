// <copyright file="index.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import './MediaPlayer.css';
import { useLibraryActivity } from '../../context/LibraryActivityContext';
import { usePlayer } from '../../context/PlayerContext';
import { useCast } from '../../hooks/useCast';
import usePlayerMetadata from '../../hooks/usePlayerMetadata';
import useTrackLoudness from '../../hooks/useTrackLoudness';
import { toast } from '../../lib/activityNotices';
import {
  applyAmbientColour,
  clearAmbientColour,
} from '../../lib/ambientColour';
import { toCamelot } from '../../lib/camelot';
import * as castApi from '../../lib/cast';
import { getLocalStreamUrl } from '../../lib/files';
import { peekMediaAudioGraph } from '../../lib/mediaAudioGraph';
import { getArtworkUrl, recordPlaybackActivity } from '../../lib/musicLibrary';
import { readPlaybackSync } from '../../lib/playbackSync';
import {
  applyAuditionTempo,
  ORIGINAL_AUDITION_TEMPO,
} from '../../lib/playerTempo';
import * as prefs from '../../lib/prefs';
import { ensureSigned } from '../../lib/streamSignatures';
import { getToken, isPassthroughEnabled } from '../../lib/token';
import { formatAttributes, formatSeconds, getFileName } from '../../lib/util';
import AlbumArt from '../Library/components/AlbumArt';
import AudioProcessing from './AudioProcessing';
import LoudnessMeter from './LoudnessMeter';
import PlaybackSyncMonitor from './PlaybackSyncMonitor';
import TrackAnalysisBadge, { playerAnalysisLevel } from './TrackAnalysisBadge';
import WaveformResizeHandle from './WaveformResizeHandle';
import WaveformSeekBar from './WaveformSeekBar';
import WaveformToolbar, { normalizeWaveformZoom } from './WaveformToolbar';
import {
  Cast,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom';

const RESUME_POSITION_KEY = 'resonance-player-position';

const CAST_CONTENT_TYPES = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/ogg; codecs=opus',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
};

const getContentType = (filename) => {
  const extension = filename?.split('.').pop()?.toLowerCase();
  return CAST_CONTENT_TYPES[extension] ?? 'audio/mpeg';
};

const getFolderInfo = (localRelativePath) => {
  if (!localRelativePath) return null;
  const normalized = localRelativePath.replaceAll('\\', '/');
  const isAbsolute = normalized.startsWith('/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return null;
  const dirPath = (isAbsolute ? '/' : '') + parts.slice(0, -1).join('/');
  return { name: parts.at(-2), path: dirPath };
};

const parseTrackInfo = (filename) => {
  const bare = getFileName(filename).replace(/\.[^./]+$/u, '');
  const withoutNumber = bare.replace(/^\d{1,3}(\.\s*|\s*-\s*)/u, '');

  const parts = withoutNumber.split(' - ');

  const directoryParts = filename
    .replaceAll('\\', '/')
    .split('/')
    .slice(0, -1)
    .filter(Boolean);
  const generic = new Set([
    'music',
    'downloads',
    'audio',
    'mp3',
    'flac',
    'ogg',
    'files',
  ]);
  const cleanDirectory = (segment) =>
    !segment || /^[A-Z]:$/u.test(segment) || generic.has(segment.toLowerCase())
      ? null
      : segment;
  const pathAlbum = cleanDirectory(directoryParts.at(-1));
  const pathArtist = cleanDirectory(directoryParts.at(-2));

  if (parts.length >= 2) {
    return {
      album: pathAlbum,
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim(),
    };
  }

  return {
    album: pathAlbum,
    artist: pathArtist,
    title: withoutNumber.trim() || bare,
  };
};

// eslint-disable-next-line complexity
const MediaPlayer = () => {
  const googleCast = useCast();
  const {
    auditionTempo,
    hasQueue,
    next: nextTrack,
    pendingSeekRef,
    playbackRequest,
    prev,
    queuePanelOpen,
    registerPauseHandler,
    registerSeekHandler,
    registerTempoHandler,
    setIsPlaying,
    shuffle,
    stop,
    toggleQueuePanel,
    toggleShuffle,
    track,
  } = usePlayer();
  const activity = useLibraryActivity();
  const audioRef = useRef(null);
  const pendingInitialSeekRef = useRef(null);
  const auditionTempoRef = useRef(ORIGINAL_AUDITION_TEMPO);
  const playbackPausedRef = useRef(true);
  const playerRef = useRef(null);
  const dockContentRef = useRef(null);
  const [retainDock, setRetainDock] = useState(false);
  useEffect(() => {
    if (track) {
      setRetainDock(true);
      return undefined;
    }

    // Keep the last frame mounted while the layout gives its space back.
    const timeout = setTimeout(() => {
      dockContentRef.current = null;
      setRetainDock(false);
    }, 650);
    return () => clearTimeout(timeout);
  }, [track]);
  const repeatRef = useRef(false);

  // Consume each explicit selection once. Restoring a track, remounting this
  // owner, or refreshing effects during HMR must not authorize a new stream.
  const lastPlaybackRequestRef = useRef(playbackRequest);
  const triggerPlayRef = useRef(null);

  // Position to resume at once the user presses play after a refresh — read once,
  // consumed (and cleared) the first time it matches the track being loaded.
  const pendingResumeRef = useRef(undefined);
  if (pendingResumeRef.current === undefined) {
    try {
      const raw = sessionStorage.getItem(RESUME_POSITION_KEY);
      pendingResumeRef.current = raw ? JSON.parse(raw) : null;
    } catch {
      pendingResumeRef.current = null;
    }
  }

  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !track?.path || track.localRelativePath) return undefined;
    let inFlight = false;
    const report = () => {
      if (inFlight) return;
      inFlight = true;
      recordPlaybackActivity()
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };

    report();
    const timer = setInterval(report, 20_000);
    return () => clearInterval(timer);
  }, [playing, track?.path, track?.localRelativePath]);

  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setIsPlaying(playing);
  }, [playing, setIsPlaying]);
  const [buffered, setBuffered] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [repeat, setRepeat] = useState(false);
  const [keyNotation, setKeyNotation] = useState(() =>
    prefs.get('mediaPlayer.keyNotation', 'standard'),
  );

  const [scrubHover, setScrubHover] = useState(null);
  // Reused pref key from when this was a single 3-way cycle (bar/waveform/
  // colored) — anything other than the old "bar" value means waveform was on.
  const [seekerEnabled, setSeekerEnabled] = useState(() =>
    prefs.get(
      'mediaPlayer.seekerEnabled',
      prefs.get('mediaPlayer.seekerStyle', 'bar') !== 'bar',
    ),
  );
  const [seekerHeight, setSeekerHeight] = useState(() =>
    prefs.get('mediaPlayer.seekerHeight', 70),
  );
  const [seekerZoom, setSeekerZoom] = useState(() =>
    normalizeWaveformZoom(prefs.get('mediaPlayer.seekerZoom', 1)),
  );
  const [showBeatGrid, setShowBeatGrid] = useState(() =>
    prefs.get('mediaPlayer.beatGrid', true),
  );
  const [showVocals, setShowVocals] = useState(() =>
    prefs.get('mediaPlayer.vocals', true),
  );
  const [phraseMode, setPhraseMode] = useState(() =>
    prefs.get('mediaPlayer.phrases', 'dj'),
  );
  const [miniWaveformAnalysing, setMiniWaveformAnalysing] = useState(false);
  const [basicGridState, setBasicGridState] = useState(null);
  const analysisActive = miniWaveformAnalysing;
  const playerMetadata = usePlayerMetadata(track, analysisActive);
  const enhancedAvailable = playerAnalysisLevel(playerMetadata) === 'enhanced';
  // A full-resolution waveform is several megabytes of JSON. Do not request it alongside the
  // first audio bytes: on a fresh track those responses compete and noticeably delay playback.
  // Keeping the path (rather than a boolean) also prevents the previous track's ready state from
  // mounting a waveform during the render in which the queue advances to the next track.
  const [waveformReadyPath, setWaveformReadyPath] = useState(null);
  const trackLoudness = useTrackLoudness(track?.path, {
    analyseMissing: waveformReadyPath === track?.path,
  });
  const [showCast, setShowCast] = useState(false);
  const castButtonRef = useRef(null);
  const castPanelRef = useRef(null);
  const positionCastPanel = useCallback(() => {
    const button = castButtonRef.current;
    const panel = castPanelRef.current;
    if (!button || !panel) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(
      12,
      Math.min(rect.right - width, window.innerWidth - width - 12),
    );
    const above = rect.top - 12;
    const below = window.innerHeight - rect.bottom - 12;
    const placeAbove = above >= 160 || above >= below;
    Object.assign(panel.style, {
      left: `${left}px`,
      width: `${width}px`,
      top: placeAbove ? '' : `${rect.bottom + 28}px`,
      bottom: placeAbove ? `${window.innerHeight - rect.top + 28}px` : '',
      maxHeight: `${Math.max(80, (placeAbove ? above : below) - 8)}px`,
      visibility: 'visible',
    });
  }, []);
  useLayoutEffect(() => {
    if (!showCast || !track) return undefined;
    positionCastPanel();
    let frame;
    if (typeof requestAnimationFrame === 'function') {
      const followUntil = performance.now() + 750;
      const followDock = () => {
        positionCastPanel();
        if (performance.now() < followUntil)
          frame = requestAnimationFrame(followDock);
      };

      frame = requestAnimationFrame(followDock);
    }

    const dock = playerRef.current?.closest('.media-player-dock');
    const observer =
      dock && typeof ResizeObserver === 'function'
        ? new ResizeObserver(positionCastPanel)
        : null;
    if (observer) observer.observe(dock);

    const closeOutside = (event) => {
      if (
        !castButtonRef.current?.contains(event.target) &&
        !castPanelRef.current?.contains(event.target)
      )
        setShowCast(false);
    };

    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setShowCast(false);
      castButtonRef.current?.focus();
    };

    window.addEventListener('resize', positionCastPanel);
    window.addEventListener('scroll', positionCastPanel, true);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', positionCastPanel);
      window.removeEventListener('scroll', positionCastPanel, true);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [positionCastPanel, showCast, track]);
  useEffect(() => {
    if (!track) setShowCast(false);
  }, [track]);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  // Stable refs so effects can read latest values without listing them as deps
  const googleCastRef = useRef(googleCast);
  googleCastRef.current = googleCast;
  const trackRef = useRef(track);
  trackRef.current = track;

  useEffect(() => {
    registerTempoHandler((settings) => {
      if (settings.rate !== 1 && googleCastRef.current?.connected) return false;
      const audio = audioRef.current;
      const capability = audio || HTMLMediaElement.prototype;
      if (
        settings.rate !== 1 &&
        !('preservesPitch' in capability) &&
        !('webkitPreservesPitch' in capability)
      )
        return false;
      auditionTempoRef.current = settings;
      return audio
        ? applyAuditionTempo(
            audio,
            trackRef.current?.localRelativePath ||
              trackRef.current?.path ||
              trackRef.current?.filename,
            settings,
          )
        : true;
    });
    return () => {
      registerTempoHandler(null);
    };
  }, [registerTempoHandler]);

  // Other library tools share this audio owner, including when its view is popped out.
  useEffect(() => {
    registerPauseHandler(() => {
      playbackPausedRef.current = true;
      if (googleCastRef.current?.connected) {
        if (!googleCastRef.current.castIsPaused)
          googleCastRef.current.castTogglePlay();
        return;
      }

      audioRef.current?.pause();
      setPlaying(false);
    });
    return () => registerPauseHandler(null);
  }, [registerPauseHandler]);

  // A mini waveform click on the track already loaded here doesn't need a
  // reload — just jump the position and make sure playback is running.
  useEffect(() => {
    registerSeekHandler((time) => {
      playbackPausedRef.current = false;
      if (googleCastRef.current?.connected) {
        googleCastRef.current.castSeek(time);
        if (googleCastRef.current.castIsPaused)
          googleCastRef.current.castTogglePlay();
        return;
      }

      const audio = audioRef.current;
      if (!audio) return;
      if (!audio.src) {
        pendingResumeRef.current = null;
        pendingSeekRef.current = {
          identity: trackRef.current?.path || trackRef.current?.filename,
          time,
        };
        void triggerPlayRef.current?.();
        return;
      }

      audio.currentTime = time;
      audio
        .play()
        .then(() => setPlaying(!playbackPausedRef.current))
        .catch(() => {});
    });
    return () => registerSeekHandler(null);
  }, [pendingSeekRef, registerSeekHandler]);

  // Reads the live position directly from refs (not React state) so the
  // waveform's animation-frame redraw loop always sees the freshest value
  // instead of whatever currentTime last happened to re-render with.
  const [syncCompensated, setSyncCompensated] = useState(false);
  const syncCompensatedRef = useRef(false);
  syncCompensatedRef.current = syncCompensated;
  const getCurrentTime = useCallback(() => {
    return googleCastRef.current?.connected
      ? googleCastRef.current.castCurrentTime
      : syncCompensatedRef.current
        ? readPlaybackSync(
            audioRef.current,
            peekMediaAudioGraph(audioRef.current)?.context,
          ).audibleTime
        : audioRef.current?.currentTime ?? 0;
  }, []);

  // play() returns a promise that REJECTS if anything pauses the element, sets
  // a new src, or calls load() before playback actually starts — grabbing the
  // waveform again mid-resume, skipping tracks quickly, closing the player. The
  // browser logs an unhandled rejection for each one ("The play() request was
  // interrupted by..."), so every play in here goes through this instead of
  // being fired and forgotten. Genuine failures (missing file, decode error)
  // still surface via the element's own "error" event.
  const playAudio = async () => {
    const audio = audioRef.current;
    if (!audio?.src || playbackPausedRef.current) return false;
    try {
      await audio.play();
      return !playbackPausedRef.current;
    } catch {
      return false;
    }
  };

  // Record playback position right before the tab closes/reloads so it can be
  // restored on the next load. Written once at unload rather than continuously.
  useEffect(() => {
    const handler = () => {
      const audio = audioRef.current;
      const currentTrack = trackRef.current;
      const identity = currentTrack?.path || currentTrack?.filename;
      if (!audio || !identity || googleCastRef.current?.connected) return;
      try {
        sessionStorage.setItem(
          RESUME_POSITION_KEY,
          JSON.stringify({ path: identity, time: audio.currentTime }),
        );
      } catch {
        /* ignore — storage may be unavailable */
      }
    };

    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
    };
  }, []);

  // Ambient art-accent: when there's no track or it has no artwork, revert the
  // --art-* vars to the theme accent. When art IS present, AlbumArt's onColour
  // sets the live colour once the image loads, so the previous accent lingers
  // briefly and then crossfades rather than flashing back to the theme blue.
  useEffect(() => {
    if (!track || !track.hasArtwork) clearAmbientColour();
  }, [track]);

  // Safety: revert when the player unmounts entirely.
  useEffect(() => () => clearAmbientColour(), []);

  // Keep the playing row visible when the player first appears.
  const previousTrackNullRef = useRef(track === null);
  useEffect(() => {
    const wasNull = previousTrackNullRef.current;
    previousTrackNullRef.current = track === null;
    if (!wasNull || track === null) return;
    const main = document.querySelector('.app-main');
    if (!main) return;
    // Only the playing row needs adjustment. Walking every waveform/SVG node forces
    // repeated layout work on a large library precisely when audio is starting.
    main.querySelector('.jb-track-row--playing')?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [track]);

  const wasCastingRef = useRef(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (googleCast.connected && !wasCastingRef.current) {
      const currentTrack = trackRef.current;
      const startTime = audio.currentTime;
      const wasPlaying = !audio.paused && !playbackPausedRef.current;
      audio.pause();
      setPlaying(false);

      // When a session RESUMES after a page reload and a track was already playing
      // locally, re-cast it from the position the local audio had reached.
      if (
        googleCastRef.current.sessionType === 'resumed' &&
        wasPlaying &&
        currentTrack &&
        audio.src
      ) {
        void (async () => {
          const currentCast = googleCastRef.current;
          if (!currentCast?.connected || playbackPausedRef.current) return;
          try {
            const isLocalResume = Boolean(currentTrack.localRelativePath);
            const token = isPassthroughEnabled() ? null : getToken();
            const tokenParameter = token
              ? `&access_token=${encodeURIComponent(token)}`
              : '';
            const sizeParameter = currentTrack.size
              ? `&size=${currentTrack.size}`
              : '';
            const streamPath = isLocalResume
              ? getLocalStreamUrl(currentTrack.localRelativePath)
              : `/api/v0/streams/${encodeURIComponent(currentTrack.username)}/preview?filename=${encodeURIComponent(currentTrack.filename)}${sizeParameter}${tokenParameter}`;
            const absoluteUrl = await castApi.getAbsoluteStreamUrl(streamPath);
            if (!currentCast.connected || playbackPausedRef.current) return;
            const castInfo = parseTrackInfo(currentTrack.filename);
            await currentCast.castMedia(absoluteUrl, {
              title: currentTrack.title || castInfo.title,
              artist: currentTrack.artist || castInfo.artist,
              album: currentTrack.album || castInfo.album,
              contentType: getContentType(currentTrack.filename),
              startTime,
            });
          } catch {
            // ignore — session may have ended or track unavailable
          }
        })();
      }
    } else if (!googleCast.connected && wasCastingRef.current) {
      // may fail if no track is loaded — playAudio swallows it
      void playAudio().then((started) => started && setPlaying(true));
    }

    wasCastingRef.current = googleCast.connected;
  }, [googleCast.connected]);

  // Detect when the cast device finishes playing → advance queue
  const castWasPlayingRef = useRef(false);
  useEffect(() => {
    if (!googleCast.connected) {
      castWasPlayingRef.current = false;
      return;
    }

    const state = googleCast.castPlayerState;
    if (playbackPausedRef.current) return;

    if (state === 'PLAYING' || state === 'BUFFERING') {
      castWasPlayingRef.current = true;
      return;
    }

    if (state !== 'IDLE' || !castWasPlayingRef.current) return;

    castWasPlayingRef.current = false;
    nextTrack();
  }, [googleCast.castPlayerState, googleCast.connected, nextTrack]);

  useEffect(() => {
    setPlaying(false);
    if (!track || !audioRef.current) return undefined;

    let cancelled = false;
    const audio = audioRef.current;
    pendingInitialSeekRef.current = null;
    const token = isPassthroughEnabled() ? null : getToken();
    const requested = playbackRequest !== lastPlaybackRequestRef.current;
    lastPlaybackRequestRef.current = playbackRequest;
    playbackPausedRef.current = !requested;
    const tokenParameter = token
      ? `&access_token=${encodeURIComponent(token)}`
      : '';
    const sizeParameter = track.size ? `&size=${track.size}` : '';
    const isLocal = Boolean(track.localRelativePath);
    // Signatures may have expired or never been warmed for this exact path (e.g.
    // stepping past what a library-list fetch or session-restore signed) — build
    // the URL only after making sure it's signed, not before.
    const buildLocalUrl = () =>
      isLocal
        ? getLocalStreamUrl(track.localRelativePath)
        : `/api/v0/streams/${encodeURIComponent(track.username)}/preview?filename=${encodeURIComponent(track.filename)}${sizeParameter}${tokenParameter}`;

    setError(null);
    setStatusMessage(null);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setLoading(requested);

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      const pending = pendingInitialSeekRef.current;
      if (!pending || pending.identity !== (track.path || track.filename))
        return;

      audio.currentTime = pending.time;
      pendingInitialSeekRef.current = null;
    };

    const onDurationChange = () => setDuration(audio.duration || 0);
    const onProgress = () => {
      if (audio.buffered.length > 0) {
        setBuffered(audio.buffered.end(audio.buffered.length - 1));
      }
    };

    const onEnded = () => {
      if (playbackPausedRef.current) return;
      if (repeatRef.current) {
        audio.currentTime = 0;
        void playAudio();
        return;
      }

      setPlaying(false);
      nextTrack();
    };

    const onError = () => {
      setError('Playback failed — the file may be corrupted.');
      setPlaying(false);
      setLoading(false);
    };

    const onWaiting = () => setLoading(true);
    const onPlaying = () => {
      if (playbackPausedRef.current) {
        audio.pause();
        return;
      }

      setLoading(false);
      setStatusMessage(null);
      setWaveformReadyPath(track.path);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('progress', onProgress);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);

    // eslint-disable-next-line complexity
    const startPlayback = async () => {
      if (cancelled || playbackPausedRef.current) return;
      setLoading(true);
      if (!isLocal) {
        setStatusMessage('Loading...');
      } else {
        await ensureSigned([track.localRelativePath]);
      }

      if (cancelled || playbackPausedRef.current) return;
      const localUrl = buildLocalUrl();

      // When Google Cast is active, stream to the cast device instead of local audio
      if (googleCastRef.current?.connected) {
        try {
          const absoluteUrl = await castApi.getAbsoluteStreamUrl(localUrl);
          if (cancelled || playbackPausedRef.current) return;

          const castInfo = parseTrackInfo(track.filename);
          await googleCastRef.current.castMedia(absoluteUrl, {
            title: track.title || castInfo.title,
            artist: track.artist || castInfo.artist,
            album: track.album || castInfo.album,
            contentType: getContentType(track.filename),
          });
        } catch {
          // cast failed — do nothing, leave local audio paused
        } finally {
          setLoading(false);
          setWaveformReadyPath(track.path);
        }

        return;
      }

      audio.src = localUrl;
      audio.load();
      applyAuditionTempo(
        audio,
        track.localRelativePath || track.path || track.filename,
        auditionTempoRef.current,
      );

      const resumeIdentity = track.path || track.filename;
      if (
        pendingSeekRef.current &&
        pendingSeekRef.current.identity === resumeIdentity
      ) {
        pendingInitialSeekRef.current = pendingSeekRef.current;
        audio.currentTime = pendingInitialSeekRef.current.time;
        pendingSeekRef.current = null;
        pendingResumeRef.current = null;
      } else if (
        pendingResumeRef.current &&
        pendingResumeRef.current.path === resumeIdentity
      ) {
        pendingInitialSeekRef.current = {
          identity: resumeIdentity,
          time: pendingResumeRef.current.time,
        };
        audio.currentTime = pendingInitialSeekRef.current.time;
        pendingResumeRef.current = null;
      }

      const started = await playAudio();
      // A newer track switched in while play() was pending: its own effect owns
      // the playing/loading state now. Reporting this one's outcome would show
      // the player as paused (and clear the new track's loading state) while
      // the new track is in fact playing.
      if (cancelled) return;
      setPlaying(started && !playbackPausedRef.current);
      setLoading(false);
    };

    triggerPlayRef.current = startPlayback;
    if (requested) void startPlayback();

    return () => {
      cancelled = true;
      playbackPausedRef.current = true;
      triggerPlayRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('progress', onProgress);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
    };
  }, [nextTrack, pendingSeekRef, playbackRequest, track]);

  const togglePlay = async () => {
    if (!playing) playbackPausedRef.current = false;
    if (googleCast.connected) {
      playbackPausedRef.current = !googleCast.castIsPaused;
      googleCast.castTogglePlay();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      playbackPausedRef.current = true;
      audio.pause();
      setPlaying(false);
    } else if (!audio.src) {
      void triggerPlayRef.current?.();
    } else if (await playAudio()) {
      setPlaying(true);
    }
  };

  const handlePrev = () => {
    const t = googleCast.connected
      ? googleCast.castCurrentTime
      : audioRef.current?.currentTime ?? 0;
    // ponytail: standard back semantics — restart if >3s in, else previous track
    if (t > 3 || !hasQueue) {
      if (googleCast.connected) googleCast.castSeek(0);
      else if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }

    prev();
  };

  const seekTo = (time) => {
    if (googleCast.connected) {
      googleCast.castSeek(time);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const identity = track.path || track.filename;
    if (!audio.getAttribute('src')) {
      pendingSeekRef.current = { identity, time };
    } else if (audio.readyState < 1) {
      pendingInitialSeekRef.current = { identity, time };
    }

    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleSeek = (event) => {
    const dur =
      googleCast.connected && googleCast.castDuration > 0
        ? googleCast.castDuration
        : Number.isFinite(duration) && duration > 0
          ? duration
          : track?.length || 0;
    if (!dur) return;
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo(((event.clientX - rect.left) / rect.width) * dur);
  };

  const toggleSeekerEnabled = () => {
    const enabled = !seekerEnabled;
    setSeekerEnabled(enabled);
    if (enabled) setWaveformReadyPath(track.path);
    prefs.set('mediaPlayer.seekerEnabled', enabled);
  };

  const waveformToolbar = (
    <WaveformToolbar
      basicGridState={
        basicGridState?.path === track?.path ? basicGridState : null
      }
      enabled={seekerEnabled}
      enhancedAvailable={enhancedAvailable}
      grid={showBeatGrid}
      height={seekerHeight}
      onGrid={(value) => {
        setShowBeatGrid(value);
        prefs.set('mediaPlayer.beatGrid', value);
      }}
      onHeight={(value) => {
        setSeekerHeight(value);
        prefs.set('mediaPlayer.seekerHeight', value);
      }}
      onPhrases={(value) => {
        setPhraseMode(value);
        prefs.set('mediaPlayer.phrases', value);
      }}
      onToggle={toggleSeekerEnabled}
      onVocals={(value) => {
        setShowVocals(value);
        prefs.set('mediaPlayer.vocals', value);
      }}
      onZoom={(value) => {
        setSeekerZoom(value);
        prefs.set('mediaPlayer.seekerZoom', value);
      }}
      phrases={phraseMode}
      vocals={showVocals}
      zoom={seekerZoom}
    />
  );

  const handleSeekKey = (event) => {
    const dur =
      googleCast.connected && googleCast.castDuration > 0
        ? googleCast.castDuration
        : Number.isFinite(duration) && duration > 0
          ? duration
          : track?.length || 0;
    if (googleCast.connected) {
      const t = googleCast.castCurrentTime;
      if (event.key === 'ArrowRight') googleCast.castSeek(Math.min(t + 5, dur));
      if (event.key === 'ArrowLeft') googleCast.castSeek(Math.max(t - 5, 0));
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (event.key === 'ArrowRight')
      audio.currentTime = Math.min(audio.currentTime + 5, dur);
    if (event.key === 'ArrowLeft')
      audio.currentTime = Math.max(audio.currentTime - 5, 0);
  };

  const handleScrubMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setScrubHover(
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    );
  };

  const handleScrubLeave = () => setScrubHover(null);

  const getStreamPath = () => {
    if (!track) return null;
    const isLocal = Boolean(track.localRelativePath);
    if (isLocal) return getLocalStreamUrl(track.localRelativePath);
    const token = isPassthroughEnabled() ? null : getToken();
    const tokenParameter = token
      ? `&access_token=${encodeURIComponent(token)}`
      : '';
    const sizeParameter = track.size ? `&size=${track.size}` : '';
    return `/api/v0/streams/${encodeURIComponent(track.username)}/preview?filename=${encodeURIComponent(track.filename)}${sizeParameter}${tokenParameter}`;
  };

  const getTrackMeta = () => {
    if (!track) return {};
    const info = parseTrackInfo(track.filename);
    return {
      title: track.title || info.title,
      artist: track.artist || info.artist,
      album: track.album || info.album,
    };
  };

  const handleOpenCast = () => setShowCast((s) => !s);

  // Google Cast — opens Chrome's native device picker, then loads media
  const handleGoogleCast = async () => {
    const streamPath = getStreamPath();
    if (!streamPath || !track) return;
    const startTime = audioRef.current?.currentTime ?? 0;
    try {
      const absoluteUrl = await castApi.getAbsoluteStreamUrl(streamPath);
      const contentType = getContentType(track.filename);
      playbackPausedRef.current = false;
      await googleCast.castMedia(absoluteUrl, {
        ...getTrackMeta(),
        contentType,
        startTime,
      });
      setShowCast(false);
    } catch (castError) {
      toast.error(
        `Google Cast failed: ${castError?.code ?? castError ?? 'unknown error'}`,
      );
    }
  };

  const handleStopCast = () => {
    if (googleCast.connected) {
      googleCast.stop();
    }
  };

  const handleVolumeChange = (event) => {
    const newVolume = Number.parseFloat(event.target.value);
    if (googleCast.connected) {
      if (newVolume > 0 && googleCast.castIsMuted) googleCast.castToggleMute();
      googleCast.castSetVolume(newVolume);
      return;
    }

    setVolume(newVolume);
    if (audioRef.current) audioRef.current.volume = newVolume;
    if (newVolume > 0 && muted) {
      setMuted(false);
      if (audioRef.current) audioRef.current.muted = false;
    }
  };

  const toggleMute = () => {
    if (googleCast.connected) {
      googleCast.castToggleMute();
      return;
    }

    const newMuted = !muted;
    setMuted(newMuted);
    if (audioRef.current) audioRef.current.muted = newMuted;
  };

  // Keep shortcuts with the audio owner so they work across library views.
  // Browser/form controls retain their own keyboard behaviour.
  useEffect(() => {
    if (!track) return undefined;
    const onPlayerKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        [
          ...document.querySelectorAll('[aria-modal="true"], dialog[open]'),
        ].some((modal) => getComputedStyle(modal).display !== 'none')
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable], [role="textbox"]',
        )
      )
        return;

      const key = event.key.toLowerCase();
      // Sliders handle their own arrows; Space remains the global transport key.
      if (
        target instanceof Element &&
        target.closest('[role="slider"]') &&
        (key === 'arrowleft' || key === 'arrowright')
      )
        return;
      const isToggle = key === ' ' || key === 'spacebar' || key === 'm';
      if (event.repeat && (isToggle || key === 'n' || key === 'p')) return;
      if (key === ' ' || key === 'spacebar') {
        if (error) return;
        event.preventDefault();
        void togglePlay();
      } else if (key === 'arrowleft' || key === 'arrowright') {
        const maxTime =
          googleCast.connected && googleCast.castDuration > 0
            ? googleCast.castDuration
            : duration > 0
              ? duration
              : track.length || 0;
        if (!maxTime) return;
        const direction = key === 'arrowright' ? 1 : -1;
        const step = event.shiftKey ? 30 : 5;
        event.preventDefault();
        seekTo(
          Math.max(0, Math.min(maxTime, getCurrentTime() + direction * step)),
        );
      } else if (key === 'm') {
        event.preventDefault();
        toggleMute();
      } else if (key === 'n' && hasQueue) {
        event.preventDefault();
        nextTrack();
      } else if (key === 'p') {
        event.preventDefault();
        handlePrev();
      }
    };

    document.addEventListener('keydown', onPlayerKeyDown);
    return () => document.removeEventListener('keydown', onPlayerKeyDown);
  });

  const toggleRepeat = () => setRepeat((r) => !r);

  const toggleKeyNotation = () => {
    const nextNotation = keyNotation === 'standard' ? 'camelot' : 'standard';
    setKeyNotation(nextNotation);
    prefs.set('mediaPlayer.keyNotation', nextNotation);
  };

  const handleClose = () => {
    setShowCast(false);
    playbackPausedRef.current = true;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }

    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setStatusMessage(null);
    stop();
    if (queuePanelOpen) toggleQueuePanel();
  };

  const renderDock = (content) => (
    <div
      aria-hidden={!track}
      className={`media-player-dock${track ? ' media-player-dock--open' : ''}`}
      inert={track ? undefined : ''}
    >
      {/* The audio owner unmounts immediately; only the visual frame exits. */}
      {track && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          crossOrigin="anonymous"
          ref={audioRef}
        />
      )}
      <div className="media-player-dock-clip">{content}</div>
    </div>
  );

  if (!track) return renderDock(retainDock ? dockContentRef.current : null);

  const effectiveTime = googleCast.connected
    ? googleCast.castCurrentTime
    : currentTime;
  const effectivePlaying = googleCast.connected
    ? !googleCast.castIsPaused
    : playing;
  const displayDuration =
    googleCast.connected && googleCast.castDuration > 0
      ? googleCast.castDuration
      : Number.isFinite(duration) && duration > 0
        ? duration
        : track.length || 0;
  const progressPct = displayDuration
    ? (effectiveTime / displayDuration) * 100
    : 0;
  const bufferedPct = displayDuration ? (buffered / displayDuration) * 100 : 0;
  const parsed = parseTrackInfo(track.filename);
  const displayTitle = track.title || parsed.title;
  const displayArtist = track.artist || parsed.artist;
  const displayAlbum = track.album || parsed.album;
  const attributes = formatAttributes(track);
  const localFolder = getFolderInfo(track.localRelativePath);
  const artistMeta = [displayArtist, attributes].filter(Boolean).join(' · ');
  // The dock uses a small, browser-cached artwork rendition.
  const thumbArtUrl = track.path ? getArtworkUrl(track.path, 192) : null;
  const integratedLufs = Number.isFinite(trackLoudness?.integratedLufs)
    ? trackLoudness.integratedLufs.toFixed(1)
    : '—';
  const displayKey =
    keyNotation === 'camelot'
      ? toCamelot(playerMetadata.key) ?? playerMetadata.key
      : playerMetadata.key;

  const castPanel = (
    <div
      aria-label="Audio output"
      className="media-player-cast"
      id="player-cast-panel"
      ref={castPanelRef}
      role="dialog"
      style={{ visibility: 'hidden' }}
    >
      <div className="media-player-cast-header">
        <Cast
          size={13}
          strokeWidth={1.75}
        />
        <span>Cast to Device</span>
        <button
          className="media-player-btn media-player-cast-close hover-fx"
          onClick={() => setShowCast(false)}
          title="Close"
          type="button"
        >
          <X size={13} />
        </button>
      </div>

      <div className="media-player-cast-body">
        {/* Google Cast section */}
        {googleCast.available && (
          <div className="media-player-cast-section">
            <div className="media-player-cast-section-label">Google Cast</div>
            {googleCast.connected ? (
              <div className="media-player-cast-google-active">
                <Cast size={13} />
                <span>{googleCast.deviceName}</span>
                <button
                  className="media-player-cast-stop hover-fx"
                  onClick={handleStopCast}
                  type="button"
                >
                  Stop
                </button>
              </div>
            ) : (
              <button
                className="media-player-cast-device media-player-cast-google-btn hover-fx"
                onClick={handleGoogleCast}
                type="button"
              >
                <Cast
                  size={14}
                  strokeWidth={1.5}
                />
                <span className="media-player-cast-device-name">
                  Open device picker…
                </span>
              </button>
            )}
          </div>
        )}
        {!googleCast.available && (
          <p className="media-player-cast-unavailable">
            Google Cast is unavailable in this browser. Open Resonance in a
            Cast-enabled Chrome or Brave window to choose a device.
          </p>
        )}
        {googleCast.connected && (
          <div
            aria-label="Cast playback controls"
            className="media-player-cast-controls"
          >
            <button
              onClick={handlePrev}
              title="Previous track"
              type="button"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={togglePlay}
              title={effectivePlaying ? 'Pause cast' : 'Play cast'}
              type="button"
            >
              {effectivePlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              disabled={!hasQueue}
              onClick={nextTrack}
              title="Next track"
              type="button"
            >
              <SkipForward size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const dockContent = (
    <div
      className="media-player"
      ref={playerRef}
    >
      {/* ── Seekable scrubber ───────────────────────────────── */}
      {waveformToolbar}
      <div className="media-player-scrub-wrap">
        {seekerEnabled &&
          (playerMetadata.hasWaveform === true ||
            waveformReadyPath === track.path) && (
            <>
              <WaveformResizeHandle
                height={seekerHeight}
                onHeight={(value) => {
                  setSeekerHeight(value);
                  prefs.set('mediaPlayer.seekerHeight', value);
                }}
              />
              <WaveformSeekBar
                duration={displayDuration}
                enhancedAvailable={enhancedAvailable}
                getCurrentTime={getCurrentTime}
                height={seekerHeight}
                onAnalysing={setMiniWaveformAnalysing}
                onBasicGridState={setBasicGridState}
                onReady={() => {}}
                onSeek={seekTo}
                phraseMode={enhancedAvailable ? phraseMode : 'off'}
                progressPct={progressPct}
                showGrid={showBeatGrid}
                showVocals={enhancedAvailable && showVocals}
                track={track}
                zoom={seekerZoom}
              />
            </>
          )}
        <div
          aria-label="Seek"
          aria-valuemax={displayDuration}
          aria-valuemin={0}
          aria-valuenow={effectiveTime}
          className="media-player-scrubber"
          onClick={handleSeek}
          onKeyDown={handleSeekKey}
          onMouseLeave={handleScrubLeave}
          onMouseMove={handleScrubMove}
          role="slider"
          tabIndex={0}
        >
          <div
            className="media-player-scrubber-buffered"
            style={{ width: `${bufferedPct}%` }}
          />
          <div
            className="media-player-scrubber-fill"
            style={{ width: `${progressPct}%` }}
          />
          {seekerEnabled && miniWaveformAnalysing && (
            <span className="mp-scrubber-analysing mp-scrubber-analysing--mini">
              <span className="media-player-spinner media-player-spinner--sm" />
              Analyzing waveform…
            </span>
          )}
          {scrubHover !== null && (
            <div
              className="media-player-scrubber-tooltip"
              style={{ left: `${scrubHover * 100}%` }}
            >
              {formatSeconds(scrubHover * displayDuration)}
            </div>
          )}
        </div>
      </div>
      {/* ── Main bar ─────────────────────────────────────────── */}
      <div className="media-player-bar">
        <section
          aria-label="Now playing"
          className="media-player-left mp-player-section mp-track-section"
        >
          <div className="media-player-art">
            <AlbumArt
              hasArtwork={track.hasArtwork}
              name={displayAlbum || displayArtist || displayTitle}
              onColour={applyAmbientColour}
              path={track.path}
              radius={5}
              size={64}
              src={thumbArtUrl}
            />
          </div>

          <div className="media-player-info">
            <div className="mp-deck-caption">
              NOW PLAYING{' '}
              <span>
                {googleCast.connected
                  ? `CASTING · ${googleCast.deviceName}`
                  : effectivePlaying
                    ? 'PLAYING'
                    : 'PAUSED'}
              </span>
              <TrackAnalysisBadge
                active={analysisActive && waveformReadyPath === track.path}
                metadata={playerMetadata}
                track={track}
              />
            </div>
            <div className="media-player-title-row">
              <div
                className="media-player-title"
                title={displayTitle}
              >
                {displayTitle}
              </div>
              {track.path && (
                <button
                  aria-label={
                    activity?.lovedPaths?.has(track.path)
                      ? 'Remove from loved'
                      : 'Love this track'
                  }
                  className={`media-player-btn media-player-love-btn hover-fx${activity?.lovedPaths?.has(track.path) ? ' jb-love-btn--loved' : ''}`}
                  onClick={() => activity?.toggleLove(track.path)}
                  title={
                    activity?.lovedPaths?.has(track.path)
                      ? 'Remove from loved'
                      : 'Love this track'
                  }
                  type="button"
                >
                  <Heart
                    fill={
                      activity?.lovedPaths?.has(track.path)
                        ? 'currentColor'
                        : 'none'
                    }
                    size={18}
                    strokeWidth={1.75}
                  />
                </button>
              )}
            </div>
            {artistMeta && (
              <div
                className="media-player-meta"
                title={artistMeta}
              >
                {artistMeta}
              </div>
            )}
            <div className="mp-track-metrics">
              <span>
                <b>{playerMetadata.bpm || '—'}</b> BPM
              </span>
              <button
                aria-label={`${displayKey || 'Unknown'} key in ${keyNotation === 'standard' ? 'musical' : 'Camelot'} notation. Show ${keyNotation === 'standard' ? 'Camelot' : 'musical'} notation`}
                aria-pressed={keyNotation === 'camelot'}
                className="mp-track-key"
                disabled={!playerMetadata.key}
                onClick={toggleKeyNotation}
                title={`Click to show ${keyNotation === 'standard' ? 'Camelot' : 'musical'} key notation`}
                type="button"
              >
                <b>{displayKey || '—'}</b>{' '}
                {keyNotation === 'standard' ? 'MUSICAL' : 'CAMELOT'}
              </button>
              <span title="Integrated track loudness">
                <b>{integratedLufs}</b> LUFS
              </span>
              {auditionTempo?.path ===
                (track.localRelativePath || track.path || track.filename) && (
                <span title="Temporary audition tempo; pitch preserved">
                  <b>
                    {Math.round(playerMetadata.bpm * auditionTempo.rate * 10) /
                      10}
                  </b>{' '}
                  MASTER
                </span>
              )}
            </div>
            {localFolder && (
              <div className="media-player-links">
                <span
                  className="media-player-link"
                  title={localFolder.name}
                >
                  {localFolder.name}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ── Controls ── */}
        <section
          aria-label="Playback controls"
          className="media-player-center mp-player-section mp-transport-section"
        >
          <div className="mp-section-heading">
            <span>PLAYBACK</span>
            {displayDuration > 0 && (
              <span className="media-player-time-display">
                {formatSeconds(effectiveTime)}
                <span> / {formatSeconds(displayDuration)}</span>
              </span>
            )}
          </div>
          <div className="media-player-buttons">
            <button
              className={
                shuffle
                  ? 'media-player-btn media-player-ctrl-btn media-player-ctrl-btn--active hover-fx'
                  : 'media-player-btn media-player-ctrl-btn hover-fx'
              }
              disabled={!hasQueue}
              onClick={toggleShuffle}
              title={shuffle ? 'Shuffle on' : 'Shuffle off'}
              type="button"
            >
              <Shuffle size={18} />
            </button>

            <button
              aria-keyshortcuts="P"
              className="media-player-btn media-player-ctrl-btn hover-fx"
              onClick={handlePrev}
              title="Previous track"
              type="button"
            >
              <SkipBack size={20} />
            </button>

            <button
              aria-keyshortcuts="Space"
              className="media-player-btn media-player-play-btn"
              disabled={Boolean(error)}
              onClick={togglePlay}
              title={effectivePlaying ? 'Pause' : 'Play'}
              type="button"
            >
              {loading ? (
                <span className="media-player-spinner" />
              ) : effectivePlaying ? (
                <Pause size={22} />
              ) : (
                <Play size={22} />
              )}
            </button>

            <button
              aria-keyshortcuts="N"
              className="media-player-btn media-player-ctrl-btn hover-fx"
              disabled={!hasQueue}
              onClick={nextTrack}
              title="Next track"
              type="button"
            >
              <SkipForward size={20} />
            </button>

            <button
              className={
                repeat
                  ? 'media-player-btn media-player-ctrl-btn media-player-ctrl-btn--active hover-fx'
                  : 'media-player-btn media-player-ctrl-btn hover-fx'
              }
              onClick={toggleRepeat}
              title={repeat ? 'Repeat: on' : 'Repeat: off'}
              type="button"
            >
              <Repeat size={18} />
            </button>
          </div>

          {error && <div className="media-player-error">{error}</div>}
          {!error && statusMessage && (
            <div className="media-player-status">{statusMessage}</div>
          )}
        </section>

        {/* ── Right controls ── */}
        <section
          aria-label="Output and sound"
          className="media-player-right mp-player-section mp-listening-section"
        >
          <div className="mp-section-heading">
            <span>OUTPUT &amp; SOUND</span>
            <button
              aria-label="Close player"
              className="media-player-btn media-player-close-btn hover-fx"
              onClick={handleClose}
              title="Close player"
              type="button"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mp-listening-controls">
            <div className="mp-route-controls">
              <button
                className={
                  queuePanelOpen
                    ? 'media-player-btn media-player-ctrl-btn--active hover-fx'
                    : 'media-player-btn hover-fx'
                }
                onClick={toggleQueuePanel}
                title={queuePanelOpen ? 'Hide queue' : 'Show queue'}
                type="button"
              >
                <ListMusic size={18} />
                <span>Queue</span>
              </button>

              <button
                aria-controls="player-cast-panel"
                aria-expanded={showCast}
                aria-haspopup="dialog"
                aria-label={
                  googleCast.connected
                    ? `Output: ${googleCast.deviceName}`
                    : 'Choose audio output'
                }
                className={
                  showCast || googleCast.connected
                    ? 'media-player-btn media-player-output media-player-ctrl-btn--active hover-fx'
                    : 'media-player-btn media-player-output hover-fx'
                }
                onClick={handleOpenCast}
                ref={castButtonRef}
                title={
                  googleCast.connected
                    ? `Casting to ${googleCast.deviceName}`
                    : 'Cast to device'
                }
                type="button"
              >
                <Cast size={18} />
                <span>
                  {googleCast.connected ? googleCast.deviceName : 'Output'}
                </span>
              </button>
            </div>

            <div className="mp-sound-controls">
              <button
                aria-keyshortcuts="M"
                className="media-player-btn hover-fx"
                onClick={toggleMute}
                title={
                  googleCast.connected
                    ? googleCast.castIsMuted
                      ? 'Unmute cast'
                      : 'Mute cast'
                    : muted
                      ? 'Unmute'
                      : 'Mute'
                }
                type="button"
              >
                {(googleCast.connected ? googleCast.castIsMuted : muted) ? (
                  <VolumeX size={18} />
                ) : (
                  <Volume2 size={18} />
                )}
              </button>
              <div className="mp-volume-stack">
                <input
                  aria-label={googleCast.connected ? 'Cast volume' : 'Volume'}
                  className="media-player-volume"
                  max="1"
                  min="0"
                  onChange={handleVolumeChange}
                  step="0.05"
                  title={googleCast.connected ? 'Cast volume' : 'Volume'}
                  type="range"
                  value={
                    googleCast.connected
                      ? googleCast.castIsMuted
                        ? 0
                        : googleCast.castVolumeLevel
                      : muted
                        ? 0
                        : volume
                  }
                />

                {!googleCast.connected && track && (
                  <LoudnessMeter
                    audioRef={audioRef}
                    loudness={trackLoudness}
                  />
                )}
              </div>

              {!googleCast.connected && track && (
                <AudioProcessing audioRef={audioRef}>
                  <PlaybackSyncMonitor
                    audioRef={audioRef}
                    compensated={syncCompensated}
                    onCompensated={setSyncCompensated}
                    remote={googleCast.connected}
                  />
                </AudioProcessing>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
  dockContentRef.current = dockContent;
  return (
    <>
      {renderDock(dockContent)}
      {showCast && ReactDOM.createPortal(castPanel, document.body)}
    </>
  );
};

// Rendered by App with no props and no context, but App re-renders on every
// SignalR STATE push — without this the player (and the waveform's canvas
// component with it) re-rendered several times a second for state it doesn't
// even read.
export default React.memo(MediaPlayer);
