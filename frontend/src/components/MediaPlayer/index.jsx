import './MediaPlayer.css';
import { useLibraryActivity } from '../../context/LibraryActivityContext';
import { usePlayer } from '../../context/PlayerContext';
import { useCast } from '../../hooks/useCast';
import * as castApi from '../../lib/cast';
import { getLocalStreamUrl } from '../../lib/files';
import { getToken, isPassthroughEnabled } from '../../lib/token';
import { formatAttributes, formatSeconds, getFileName } from '../../lib/util';
import AlbumArt from '../Library/components/AlbumArt';
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
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

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
    hasQueue,
    next,
    prev,
    queuePanelOpen,
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
  const playerRef = useRef(null);
  const repeatRef = useRef(false);

  const skipAutoPlayRef = useRef(restoredFromSession);
  const triggerPlayRef = useRef(null);

  const [playing, setPlaying] = useState(false);
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
  const [showCast, setShowCast] = useState(false);
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  // Stable refs so effects can read latest values without listing them as deps
  const googleCastRef = useRef(googleCast);
  googleCastRef.current = googleCast;
  const trackRef = useRef(track);
  trackRef.current = track;

  // When the player appears, any scrollable container that is near its bottom
  // edge will have content clipped by the player. Nudge those containers down
  // so the content that was visible stays visible.
  const previousTrackNullRef = useRef(track === null);
  useEffect(() => {
    const wasNull = previousTrackNullRef.current;
    previousTrackNullRef.current = track === null;
    if (!wasNull || track === null) return;
    const playerH = playerRef.current?.offsetHeight ?? 83;
    const main = document.querySelector('.app-main');
    if (!main) return;
    for (const element of main.querySelectorAll('*')) {
      if (element.scrollHeight > element.clientHeight + 2) {
        const distributionToBottom =
          element.scrollHeight - element.clientHeight - element.scrollTop;
        if (distributionToBottom < playerH * 2) {
          element.scrollTop += playerH;
        }
      }
    }
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
      const resume = async () => {
        try {
          await audio.play();
          setPlaying(true);
        } catch {
          // ignore — user may have no track loaded
        }
      };

      void resume();
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
    const tokenParameter = token
      ? `&access_token=${encodeURIComponent(token)}`
      : '';
    const sizeParameter = track.size ? `&size=${track.size}` : '';
    const isLocal = Boolean(track.localRelativePath);
    const localUrl = isLocal
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
        void audio.play();
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
      }

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
        }

        return;
      }

      audio.src = localUrl;
      audio.load();

      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      } finally {
        setLoading(false);
      }
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
  }, [next, track]);

  const togglePlay = async () => {
    if (googleCast.connected) {
      googleCast.castTogglePlay();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
    } else if (!audio.src) {
      void triggerPlayRef.current?.();
    } else {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        // error state handled by error event
      }
    }
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
    const time = ((event.clientX - rect.left) / rect.width) * dur;
    if (googleCast.connected) {
      googleCast.castSeek(time);
      return;
    }

    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
  };

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

  return (
    <div
      className="media-player"
      ref={playerRef}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} />

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
              className="media-player-btn media-player-cast-close"
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
                      className="media-player-cast-stop"
                      onClick={handleStopCast}
                      type="button"
                    >
                      Stop
                    </button>
                  </div>
                ) : (
                  <button
                    className="media-player-cast-device media-player-cast-google-btn"
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
        {scrubHover !== null && (
          <div
            className="media-player-scrubber-tooltip"
            style={{ left: `${scrubHover * 100}%` }}
          >
            {formatSeconds(scrubHover * displayDuration)}
          </div>
        )}
      </div>

      {/* ── Main bar ─────────────────────────────────────────── */}
      <div className="media-player-bar">
        <div className="media-player-left">
          <AlbumArt
            hasArtwork={track.hasArtwork}
            name={displayAlbum || displayArtist || displayTitle}
            path={track.path}
            radius={5}
            size={64}
          />

          <div className="media-player-info">
            <div className="media-player-title-row">
              <div
                className="media-player-title"
                title={displayTitle}
              >
                {displayTitle}
              </div>
            </div>
            {artistMeta && (
              <div className="media-player-meta">{artistMeta}</div>
            )}
            {localFolder && (
              <div className="media-player-links">
                <span className="media-player-link">{localFolder.name}</span>
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
                  ? 'media-player-btn media-player-ctrl-btn media-player-ctrl-btn--active'
                  : 'media-player-btn media-player-ctrl-btn'
              }
              disabled={!hasQueue}
              onClick={toggleShuffle}
              title={shuffle ? 'Shuffle on' : 'Shuffle off'}
              type="button"
            >
              <Shuffle size={18} />
            </button>

            <button
              className="media-player-btn media-player-ctrl-btn"
              disabled={!hasQueue}
              onClick={prev}
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
              className="media-player-btn media-player-ctrl-btn"
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
                  ? 'media-player-btn media-player-ctrl-btn media-player-ctrl-btn--active'
                  : 'media-player-btn media-player-ctrl-btn'
              }
              onClick={toggleRepeat}
              title={repeat ? 'Repeat: on' : 'Repeat: off'}
              type="button"
            >
              <Repeat size={18} />
            </button>

            {track.path && (
              <button
                className={`media-player-btn media-player-ctrl-btn media-player-love-btn${activity?.lovedPaths?.has(track.path) ? ' jb-love-btn--loved' : ''}`}
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
            className={
              queuePanelOpen
                ? 'media-player-btn media-player-ctrl-btn--active'
                : 'media-player-btn'
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
                ? 'media-player-btn media-player-ctrl-btn--active'
                : 'media-player-btn'
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
            className="media-player-btn"
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

          <button
            className="media-player-btn media-player-close-btn"
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

export default MediaPlayer;
