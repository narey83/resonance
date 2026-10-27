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
import {
  applyAmbientColour,
  clearAmbientColour,
} from '../../lib/ambientColour';
import * as castApi from '../../lib/cast';
import { getLocalStreamUrl } from '../../lib/files';
import { getArtworkUrl, recordPlaybackActivity } from '../../lib/musicLibrary';
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
import usePlayerPopout from './usePlayerPopout';
import WaveformResizeHandle from './WaveformResizeHandle';
import WaveformSeekBar from './WaveformSeekBar';
import WaveformToolbar, { normalizeWaveformZoom } from './WaveformToolbar';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Cast,
  ChevronDown,
  ExternalLink,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';

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

// Inline "Up Next" drawer for the immersive view. Virtualised so only the
// visible rows (and their artwork) render — a long queue mounts a handful of
// rows instead of hundreds. Rendered only while open, so its scroll ref
// attaches cleanly on mount.
const ExpandedQueue = ({
  jumpTo,
  onClose,
  queueIndex,
  removeFromQueue,
  upNext,
}) => {
  const listRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: upNext.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 54,
    overscan: 6,
  });

  return (
    <div className="mp-expanded-queue">
      <div className="mp-expanded-queue-header">
        <span className="mp-expanded-queue-title">Up Next</span>
        <span className="mp-expanded-queue-count">{upNext.length}</span>
        <button
          className="mp-expanded-queue-close hover-fx"
          onClick={onClose}
          title="Hide queue"
          type="button"
        >
          <X size={16} />
        </button>
      </div>
      <div
        className="mp-expanded-queue-list"
        ref={listRef}
      >
        {upNext.length === 0 ? (
          <div className="mp-expanded-queue-empty">Nothing up next</div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const actualIndex = queueIndex + 1 + virtualItem.index;
              const qTrack = upNext[virtualItem.index];
              const qParsed = parseTrackInfo(qTrack.filename);
              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div
                    className="mp-expanded-queue-row"
                    onClick={() => jumpTo(actualIndex)}
                    onKeyDown={(event) =>
                      event.key === 'Enter' && jumpTo(actualIndex)
                    }
                    role="button"
                    tabIndex={0}
                  >
                    <AlbumArt
                      hasArtwork={qTrack.hasArtwork}
                      name={qTrack.album || qTrack.artist || qParsed.title}
                      path={qTrack.path}
                      radius={4}
                      size={40}
                    />
                    <div className="mp-expanded-queue-meta">
                      <div className="mp-expanded-queue-row-title">
                        {qTrack.title || qParsed.title}
                      </div>
                      <div className="mp-expanded-queue-row-artist">
                        {qTrack.artist || qParsed.artist}
                      </div>
                    </div>
                    <button
                      className="mp-expanded-queue-remove"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeFromQueue(actualIndex);
                      }}
                      title="Remove from queue"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// eslint-disable-next-line complexity
const MediaPlayer = () => {
  const googleCast = useCast();
  const {
    auditionTempo,
    hasQueue,
    jumpTo,
    next,
    pendingSeekRef,
    prev,
    queue,
    queueIndex,
    queuePanelOpen,
    registerPauseHandler,
    registerSeekHandler,
    registerTempoHandler,
    removeFromQueue,
    restoredFromSession,
    setIsPlaying,
    shuffle,
    stop,
    toggleQueuePanel,
    toggleShuffle,
    track,
  } = usePlayer();
  const activity = useLibraryActivity();
  const audioRef = useRef(null);
  const auditionTempoRef = useRef(ORIGINAL_AUDITION_TEMPO);
  const playbackPausedRef = useRef(false);
  const playerRef = useRef(null);
  const repeatRef = useRef(false);

  const skipAutoPlayRef = useRef(restoredFromSession);
  const triggerPlayRef = useRef(null);

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

  const [scrubHover, setScrubHover] = useState(null);
  // Reused pref key from when this was a single 3-way cycle (bar/waveform/
  // colored) — anything other than the old "bar" value means waveform was on.
  const playerMetadata = usePlayerMetadata(track);
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
  const [waveformAnalysing, setWaveformAnalysing] = useState(false);
  const [miniWaveformAnalysing, setMiniWaveformAnalysing] = useState(false);
  // A full-resolution waveform is several megabytes of JSON. Do not request it alongside the
  // first audio bytes: on a fresh track those responses compete and noticeably delay playback.
  // Keeping the path (rather than a boolean) also prevents the previous track's ready state from
  // mounting a waveform during the render in which the queue advances to the next track.
  const [waveformReadyPath, setWaveformReadyPath] = useState(null);
  const trackLoudness = useTrackLoudness(track?.path, {
    analyseMissing: waveformReadyPath === track?.path,
  });
  const [showCast, setShowCast] = useState(false);
  const popout = usePlayerPopout();
  const [showQueue, setShowQueue] = useState(false);
  const [processingLauncherTarget, setProcessingLauncherTarget] =
    useState(null);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  // The player-window queue closes when the window docks.
  useEffect(() => {
    if (!popout.container) setShowQueue(false);
  }, [popout.container]);

  useEffect(() => {
    if (popout.container)
      popout.container.ownerDocument.title = `${track?.title || 'Player'} · Resonance`;
  }, [popout.container, track?.title]);

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
      audio.currentTime = time;
      audio
        .play()
        .then(() => setPlaying(!playbackPausedRef.current))
        .catch(() => {});
    });
  }, [registerSeekHandler]);

  // Reads the live position directly from refs (not React state) so the
  // waveform's animation-frame redraw loop always sees the freshest value
  // instead of whatever currentTime last happened to re-render with.
  const getCurrentTime = useCallback(() => {
    return googleCastRef.current?.connected
      ? googleCastRef.current.castCurrentTime
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
    if (playbackPausedRef.current) return false;
    try {
      await audioRef.current?.play();
      return true;
    } catch {
      return false;
    }
  };

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

  // Escape docks the player window without stopping audio.
  const closePopout = popout.close;
  useEffect(() => {
    if (!popout.container) return undefined;
    const targetWindow = popout.container.ownerDocument.defaultView;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        closePopout();
      }
    };

    targetWindow.addEventListener('keydown', onKey);
    return () => targetWindow.removeEventListener('keydown', onKey);
  }, [popout.container, closePopout]);

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
      audio.pause();
      setPlaying(false);

      // When a session RESUMES after a page reload and a track was already playing
      // locally, re-cast it from the position the local audio had reached.
      if (
        googleCastRef.current.sessionType === 'resumed' &&
        currentTrack &&
        audio.src
      ) {
        void (async () => {
          const currentCast = googleCastRef.current;
          if (!currentCast?.connected) return;
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

    if (state === 'PLAYING' || state === 'BUFFERING') {
      castWasPlayingRef.current = true;
      return;
    }

    if (state !== 'IDLE' || !castWasPlayingRef.current) return;

    castWasPlayingRef.current = false;
    next();
  }, [googleCast.castPlayerState, googleCast.connected, next]);

  useEffect(() => {
    if (!track || !audioRef.current) return undefined;

    let cancelled = false;
    const audio = audioRef.current;
    const token = isPassthroughEnabled() ? null : getToken();
    playbackPausedRef.current = false;
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
    setLoading(!skipAutoPlayRef.current);

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onProgress = () => {
      if (audio.buffered.length > 0) {
        setBuffered(audio.buffered.end(audio.buffered.length - 1));
      }
    };

    const onEnded = () => {
      if (repeatRef.current) {
        audio.currentTime = 0;
        void playAudio();
        return;
      }

      setPlaying(false);
      next();
    };

    const onError = () => {
      setError('Playback failed — the file may be corrupted.');
      setPlaying(false);
      setLoading(false);
    };

    const onWaiting = () => setLoading(true);
    const onPlaying = () => {
      setLoading(false);
      setStatusMessage(null);
      setWaveformReadyPath(track.path);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('progress', onProgress);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);

    // eslint-disable-next-line complexity
    const startPlayback = async () => {
      setLoading(true);
      if (!isLocal) {
        setStatusMessage('Loading...');
      } else {
        await ensureSigned([track.localRelativePath]);
      }

      if (cancelled) return;
      const localUrl = buildLocalUrl();

      // When Google Cast is active, stream to the cast device instead of local audio
      if (googleCastRef.current?.connected) {
        try {
          const absoluteUrl = await castApi.getAbsoluteStreamUrl(localUrl);
          if (cancelled) return;

          // After the await, React state has settled. If cast resumed an existing
          // session (HMR or page reload) and the device is already playing,
          // don't interrupt — the cast continues from where it was.
          const castDeviceState = googleCastRef.current.castPlayerState;
          const castIsActive =
            castDeviceState === 'PLAYING' ||
            castDeviceState === 'BUFFERING' ||
            castDeviceState === 'PAUSED';
          if (
            googleCastRef.current.sessionType === 'resumed' &&
            !audioRef.current?.src &&
            castIsActive
          ) {
            return;
          }

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
        pendingResumeRef.current &&
        pendingResumeRef.current.path === resumeIdentity
      ) {
        audio.currentTime = pendingResumeRef.current.time;
        pendingResumeRef.current = null;
      } else if (
        pendingSeekRef.current &&
        pendingSeekRef.current.identity === resumeIdentity
      ) {
        audio.currentTime = pendingSeekRef.current.time;
        pendingSeekRef.current = null;
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
    if (skipAutoPlayRef.current) {
      skipAutoPlayRef.current = false;
    } else {
      void startPlayback();
    }

    return () => {
      cancelled = true;
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('progress', onProgress);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
    };
  }, [next, pendingSeekRef, track]);

  const togglePlay = async () => {
    if (!playing) playbackPausedRef.current = false;
    if (googleCast.connected) {
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
    if (audio) audio.currentTime = time;
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
      enabled={seekerEnabled}
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
    const absoluteUrl = await castApi.getAbsoluteStreamUrl(streamPath);
    const contentType = getContentType(track.filename);
    try {
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

  const toggleRepeat = () => setRepeat((r) => !r);

  const handleClose = () => {
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
    popout.close();
    stop();
    if (queuePanelOpen) toggleQueuePanel();
  };

  if (!track) return null;

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
  const upNext = queueIndex == null ? [] : queue.slice(queueIndex + 1);

  // Fetch hero artwork only when the expanded player is mounted. Small thumbnails
  // and the blurred backdrop share the inexpensive browser-cached rendition.
  const thumbArtUrl = track.path ? getArtworkUrl(track.path, 192) : null;
  const artUrl = track.path ? getArtworkUrl(track.path, 512) : null;
  const integratedLufs = Number.isFinite(trackLoudness?.integratedLufs)
    ? trackLoudness.integratedLufs.toFixed(1)
    : '—';

  return (
    <div
      className="media-player"
      ref={playerRef}
    >
      {/* crossOrigin is required for the Web Audio API (loudness meter) to read
          samples from this element without a tainted-canvas-style security
          error — safe here since the stream URL is same-origin. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        crossOrigin="anonymous"
        ref={audioRef}
      />

      {/* ── Separate player window ──────────────────────────── */}
      {popout.container &&
        createPortal(
          <div
            aria-label="Now playing"
            className={`mp-expanded mp-expanded--popout${showQueue ? ' mp-expanded--with-queue' : ''}`}
            role="dialog"
          >
            <div
              className={
                track.hasArtwork
                  ? 'mp-expanded-backdrop'
                  : 'mp-expanded-backdrop mp-expanded-backdrop--fallback'
              }
              style={
                track.hasArtwork
                  ? { backgroundImage: `url(${thumbArtUrl})` }
                  : undefined
              }
            />
            <button
              className="mp-expanded-collapse mp-expanded-collapse--dock hover-fx"
              onClick={() => popout.close()}
              title="Dock player"
              type="button"
            >
              <ChevronDown size={24} />
              <span>Dock player</span>
            </button>

            <div className="mp-expanded-content">
              <div className="mp-expanded-art">
                <AlbumArt
                  hasArtwork={track.hasArtwork}
                  name={displayAlbum || displayArtist || displayTitle}
                  onColour={applyAmbientColour}
                  path={track.path}
                  radius={16}
                  size={480}
                  src={artUrl}
                />
              </div>

              <div className="mp-expanded-info">
                <div className="mp-deck-caption">
                  PREPARATION DECK <span>{playing ? 'PLAYING' : 'PAUSED'}</span>
                </div>
                <div className="mp-expanded-title">{displayTitle}</div>
                <div className="mp-track-metrics">
                  <span>
                    <b>{playerMetadata.bpm || '—'}</b> BPM
                  </span>
                  <span>
                    <b>{playerMetadata.key || '—'}</b> KEY
                  </span>
                  <span title="Integrated track loudness">
                    <b>{integratedLufs}</b> LUFS
                  </span>
                  {auditionTempo?.path ===
                    (track.localRelativePath ||
                      track.path ||
                      track.filename) && (
                    <span title="Temporary audition tempo; pitch preserved">
                      <b>
                        {Math.round(
                          playerMetadata.bpm * auditionTempo.rate * 10,
                        ) / 10}
                      </b>{' '}
                      MASTER
                    </span>
                  )}
                </div>
                {displayArtist && (
                  <div className="mp-expanded-artist">{displayArtist}</div>
                )}
                {displayAlbum && (
                  <div className="mp-expanded-album">{displayAlbum}</div>
                )}
              </div>

              <div className="mp-expanded-scrub-stack">
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
                        getCurrentTime={getCurrentTime}
                        height={seekerHeight}
                        onAnalysing={setWaveformAnalysing}
                        onReady={() => {}}
                        onSeek={seekTo}
                        phraseMode={phraseMode}
                        progressPct={progressPct}
                        showGrid={showBeatGrid}
                        showVocals={showVocals}
                        track={track}
                        zoom={seekerZoom}
                      />
                    </>
                  )}
                <div className="mp-expanded-scrub-row">
                  <span className="mp-expanded-time">
                    {formatSeconds(effectiveTime)}
                  </span>
                  <div
                    aria-label="Seek"
                    aria-valuemax={displayDuration}
                    aria-valuemin={0}
                    aria-valuenow={effectiveTime}
                    className="mp-expanded-scrubber"
                    onClick={handleSeek}
                    onKeyDown={handleSeekKey}
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
                    {seekerEnabled && waveformAnalysing && (
                      <span className="mp-scrubber-analysing">
                        <span className="media-player-spinner media-player-spinner--sm" />
                        Analyzing waveform…
                      </span>
                    )}
                  </div>
                  <span className="mp-expanded-time">
                    {formatSeconds(displayDuration)}
                  </span>
                </div>
              </div>

              <div className="mp-expanded-footer">
                {waveformToolbar}

                <div className="mp-expanded-audio-tools">
                  <div
                    aria-label="Output volume"
                    className="mp-expanded-volume-section"
                    role="group"
                  >
                    <span className="mp-expanded-audio-caption">Volume</span>
                    <div className="mp-popout-volume">
                      <button
                        aria-label={muted ? 'Unmute' : 'Mute'}
                        onClick={toggleMute}
                        type="button"
                      >
                        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                      <input
                        aria-label="Player volume"
                        aria-orientation="vertical"
                        max="1"
                        min="0"
                        onChange={handleVolumeChange}
                        step="0.05"
                        type="range"
                        value={
                          googleCast.connected
                            ? googleCast.castVolumeLevel
                            : muted
                              ? 0
                              : volume
                        }
                      />
                    </div>
                  </div>
                  {!googleCast.connected && (
                    <div
                      aria-label="Loudness and processing"
                      className="mp-expanded-audio-monitor"
                      role="group"
                    >
                      <div className="mp-expanded-live-level">
                        <span className="mp-expanded-audio-caption">
                          LUFS / VU
                        </span>
                        <LoudnessMeter
                          audioRef={audioRef}
                          loudness={trackLoudness}
                          orientation="vertical"
                          showLive
                        />
                      </div>
                      <div
                        className="mp-expanded-processing-launcher"
                        ref={setProcessingLauncherTarget}
                      />
                    </div>
                  )}
                </div>
                <div className="mp-expanded-transport">
                  <div
                    aria-label="Playback modes"
                    className="mp-expanded-modes"
                    role="group"
                  >
                    <button
                      className={
                        shuffle
                          ? 'mp-expanded-ctrl mp-expanded-ctrl--active hover-fx'
                          : 'mp-expanded-ctrl hover-fx'
                      }
                      disabled={!hasQueue}
                      onClick={toggleShuffle}
                      title={shuffle ? 'Shuffle on' : 'Shuffle off'}
                      type="button"
                    >
                      <Shuffle size={20} />
                    </button>
                    <button
                      className={
                        repeat
                          ? 'mp-expanded-ctrl mp-expanded-ctrl--active hover-fx'
                          : 'mp-expanded-ctrl hover-fx'
                      }
                      onClick={toggleRepeat}
                      title={repeat ? 'Repeat: on' : 'Repeat: off'}
                      type="button"
                    >
                      <Repeat size={20} />
                    </button>
                  </div>
                  <div className="mp-expanded-controls">
                    <button
                      className="mp-expanded-ctrl hover-fx"
                      onClick={handlePrev}
                      title="Previous track"
                      type="button"
                    >
                      <SkipBack size={26} />
                    </button>
                    <button
                      className="mp-expanded-play"
                      disabled={Boolean(error)}
                      onClick={togglePlay}
                      title={effectivePlaying ? 'Pause' : 'Play'}
                      type="button"
                    >
                      {loading ? (
                        <span className="media-player-spinner" />
                      ) : effectivePlaying ? (
                        <Pause size={28} />
                      ) : (
                        <Play size={28} />
                      )}
                    </button>
                    <button
                      className="mp-expanded-ctrl hover-fx"
                      disabled={!hasQueue}
                      onClick={next}
                      title="Next track"
                      type="button"
                    >
                      <SkipForward size={26} />
                    </button>
                  </div>

                  {track.path && (
                    <div className="mp-expanded-secondary">
                      <button
                        className={`mp-expanded-ctrl hover-fx${activity?.lovedPaths?.has(track.path) ? ' mp-expanded-ctrl--active' : ''}`}
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
                          size={20}
                          strokeWidth={1.75}
                        />
                      </button>
                      <button
                        className={
                          showQueue
                            ? 'mp-expanded-ctrl mp-expanded-ctrl--active hover-fx'
                            : 'mp-expanded-ctrl hover-fx'
                        }
                        onClick={() => setShowQueue((value) => !value)}
                        title={showQueue ? 'Hide queue' : 'Show queue'}
                        type="button"
                      >
                        <ListMusic size={20} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {showQueue && (
              <ExpandedQueue
                jumpTo={jumpTo}
                onClose={() => setShowQueue(false)}
                queueIndex={queueIndex}
                removeFromQueue={removeFromQueue}
                upNext={upNext}
              />
            )}
          </div>,
          popout.container,
        )}

      {/* ── Cast panel ──────────────────────────────────────── */}
      {showCast && (
        <div className="media-player-cast">
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
                <div className="media-player-cast-section-label">
                  Google Cast
                </div>
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
          </div>
        </div>
      )}

      {/* ── Seekable scrubber ───────────────────────────────── */}
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
                getCurrentTime={getCurrentTime}
                height={seekerHeight}
                onAnalysing={setMiniWaveformAnalysing}
                onReady={() => {}}
                onSeek={seekTo}
                phraseMode={phraseMode}
                progressPct={progressPct}
                showGrid={showBeatGrid}
                showVocals={showVocals}
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
      {waveformToolbar}

      {/* ── Main bar ─────────────────────────────────────────── */}
      <div className="media-player-bar">
        <div className="media-player-left">
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
              PREVIEW DECK <span>{playing ? 'PLAYING' : 'PAUSED'}</span>
            </div>
            <div className="media-player-title-row">
              <div
                className="media-player-title"
                title={displayTitle}
              >
                {displayTitle}
              </div>
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
              <span>
                <b>{playerMetadata.key || '—'}</b> KEY
              </span>
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
            {displayDuration > 0 && (
              <div className="media-player-time-display">
                {formatSeconds(effectiveTime)}
                {' / '}
                {formatSeconds(displayDuration)}
              </div>
            )}
          </div>
        </div>
        {/* end media-player-left */}

        {/* ── Controls ── */}
        <div className="media-player-center">
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
              className="media-player-btn media-player-ctrl-btn hover-fx"
              onClick={handlePrev}
              title="Previous track"
              type="button"
            >
              <SkipBack size={20} />
            </button>

            <button
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
              className="media-player-btn media-player-ctrl-btn hover-fx"
              disabled={!hasQueue}
              onClick={next}
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

            {track.path && (
              <button
                className={`media-player-btn media-player-ctrl-btn media-player-love-btn hover-fx${activity?.lovedPaths?.has(track.path) ? ' jb-love-btn--loved' : ''}`}
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

          {error && <div className="media-player-error">{error}</div>}
          {!error && statusMessage && (
            <div className="media-player-status">{statusMessage}</div>
          )}
        </div>

        {/* ── Right controls ── */}
        <div className="media-player-right">
          <button
            aria-label={
              popout.container ? 'Focus player window' : 'Open player window'
            }
            className="media-player-btn hover-fx"
            onClick={() => {
              if (!popout.open())
                toast.info(
                  'Allow pop-ups for Resonance, then try Open player window again.',
                );
            }}
            title={
              popout.container ? 'Focus player window' : 'Open player window'
            }
            type="button"
          >
            <ExternalLink size={18} />
          </button>

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
          </button>

          <button
            className={
              showCast || googleCast.connected
                ? 'media-player-btn media-player-ctrl-btn--active hover-fx'
                : 'media-player-btn hover-fx'
            }
            onClick={handleOpenCast}
            title={
              googleCast.connected
                ? `Casting to ${googleCast.deviceName}`
                : 'Cast to device'
            }
            type="button"
          >
            <Cast size={18} />
          </button>

          <button
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
          <input
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

          {!googleCast.connected && track && (
            <AudioProcessing
              audioRef={audioRef}
              launcherTarget={processingLauncherTarget}
              modalTarget={popout.container}
              targetLufs={trackLoudness?.integratedLufs ?? null}
            />
          )}

          <button
            className="media-player-btn media-player-close-btn hover-fx"
            onClick={handleClose}
            title="Close player"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

// Rendered by App with no props and no context, but App re-renders on every
// SignalR STATE push — without this the player (and the waveform's canvas
// component with it) re-rendered several times a second for state it doesn't
// even read.
export default React.memo(MediaPlayer);
