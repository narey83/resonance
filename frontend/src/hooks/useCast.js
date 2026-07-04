// <copyright file="useCast.js" company="John Narey">
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

/* global cast, chrome */
import { castAppId } from '../config';
import { useCallback, useEffect, useRef, useState } from 'react';

export const useCast = () => {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState(null);
  const [castCurrentTime, setCastCurrentTime] = useState(0);
  const [castDuration, setCastDuration] = useState(0);
  const [castIsPaused, setCastIsPaused] = useState(false);
  const [castVolumeLevel, setCastVolumeLevel] = useState(1);
  const [castIsMuted, setCastIsMuted] = useState(false);
  const [castPlayerState, setCastPlayerState] = useState(null);
  const [sessionType, setSessionType] = useState(null); // 'started' | 'resumed' | null

  const contextRef = useRef(null);
  const playerRef = useRef(null);
  const playerControllerRef = useRef(null);

  useEffect(() => {
    const init = () => {
      if (!window.cast?.framework || !window.chrome?.cast) return;

      const context = cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId:
          castAppId || chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      contextRef.current = context;

      // RemotePlayer mirrors the receiver's playback state — current time,
      // duration, paused — so the local UI can track cast progress.
      const player = new cast.framework.RemotePlayer();
      const playerController = new cast.framework.RemotePlayerController(
        player,
      );
      playerRef.current = player;
      playerControllerRef.current = playerController;

      const {
        CURRENT_TIME_CHANGED,
        DURATION_CHANGED,
        IS_MUTED_CHANGED,
        IS_PAUSED_CHANGED,
        PLAYER_STATE_CHANGED,
        VOLUME_LEVEL_CHANGED,
      } = cast.framework.RemotePlayerEventType;

      playerController.addEventListener(CURRENT_TIME_CHANGED, () =>
        setCastCurrentTime(player.currentTime),
      );
      playerController.addEventListener(DURATION_CHANGED, () =>
        setCastDuration(player.duration),
      );
      playerController.addEventListener(IS_PAUSED_CHANGED, () =>
        setCastIsPaused(player.isPaused),
      );
      playerController.addEventListener(VOLUME_LEVEL_CHANGED, () =>
        setCastVolumeLevel(player.volumeLevel),
      );
      playerController.addEventListener(IS_MUTED_CHANGED, () =>
        setCastIsMuted(player.isMuted),
      );
      playerController.addEventListener(PLAYER_STATE_CHANGED, () =>
        setCastPlayerState(player.playerState),
      );

      context.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        ({ sessionState }) => {
          const { SESSION_STARTED, SESSION_RESUMED, SESSION_ENDED } =
            cast.framework.SessionState;
          if (
            sessionState === SESSION_STARTED ||
            sessionState === SESSION_RESUMED
          ) {
            setConnected(true);
            setSessionType(
              sessionState === SESSION_RESUMED ? 'resumed' : 'started',
            );
            setDeviceName(
              context.getCurrentSession()?.getCastDevice()?.friendlyName ??
                'Device',
            );
          } else if (sessionState === SESSION_ENDED) {
            setConnected(false);
            setDeviceName(null);
            setSessionType(null);
            setCastCurrentTime(0);
            setCastDuration(0);
            setCastIsPaused(false);
            setCastVolumeLevel(1);
            setCastIsMuted(false);
            setCastPlayerState(null);
          }
        },
      );

      // Reconnect to an existing session (e.g. after HMR without a full page reload)
      const existingSession = context.getCurrentSession();
      if (existingSession) {
        setConnected(true);
        setSessionType('resumed');
        setDeviceName(
          existingSession.getCastDevice()?.friendlyName ?? 'Device',
        );
        setCastCurrentTime(player.currentTime);
        setCastDuration(player.duration);
        setCastIsPaused(player.isPaused);
        setCastVolumeLevel(player.volumeLevel);
        setCastIsMuted(player.isMuted);
        setCastPlayerState(player.playerState);
      }

      setAvailable(true);
    };

    if (window._castApiAvailable) {
      init();
    } else {
      document.addEventListener('castApiAvailable', init, { once: true });
    }

    return () => document.removeEventListener('castApiAvailable', init);
  }, []);

  const getOrCreateSession = useCallback(async (context) => {
    const existing = context.getCurrentSession();
    if (existing) {
      return existing;
    }

    return new Promise((resolve, reject) => {
      const { SESSION_STARTED, SESSION_RESUMED, SESSION_ENDED } =
        cast.framework.SessionState;

      const onStateChange = ({ sessionState }) => {
        if (
          sessionState === SESSION_STARTED ||
          sessionState === SESSION_RESUMED
        ) {
          context.removeEventListener(
            cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
            onStateChange,
          );
          const session = context.getCurrentSession();
          resolve(session);
        } else if (sessionState === SESSION_ENDED) {
          context.removeEventListener(
            cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
            onStateChange,
          );
          reject(new Error('Session ended before media could be loaded'));
        }
      };

      context.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        onStateChange,
      );

      void (async () => {
        try {
          await context.requestSession();
        } catch (error) {
          console.error('[Cast] requestSession error:', error);
          context.removeEventListener(
            cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
            onStateChange,
          );
          reject(error);
        }
      })();
    });
  }, []);

  const castMedia = useCallback(
    async (
      streamUrl,
      {
        title,
        artist,
        album,
        contentType = 'audio/mpeg',
        startTime = null,
      } = {},
    ) => {
      const context = contextRef.current;
      if (!context) {
        console.error('[Cast] castMedia called but context is null');
        return;
      }

      console.log('[Cast] castMedia — getting session');
      const session = await getOrCreateSession(context);

      if (!session) {
        console.error('[Cast] no session after getOrCreateSession');
        return;
      }

      console.log('[Cast] loading media:', streamUrl, contentType);
      const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, contentType);
      const meta = new chrome.cast.media.MusicTrackMediaMetadata();
      meta.title = title ?? '';
      meta.artist = artist ?? '';
      meta.albumName = album ?? '';
      mediaInfo.metadata = meta;

      const loadRequest = new chrome.cast.media.LoadRequest(mediaInfo);
      if (startTime != null && startTime > 0) {
        loadRequest.currentTime = startTime;
      }

      await session.loadMedia(loadRequest);
      if (startTime != null && startTime > 0) {
        setCastCurrentTime(startTime);
      }
    },
    [getOrCreateSession],
  );

  const castSeek = useCallback((seconds) => {
    const player = playerRef.current;
    const controller = playerControllerRef.current;
    if (!player || !controller || !player.canSeek) return;
    player.currentTime = seconds;
    controller.seek();
  }, []);

  const castTogglePlay = useCallback(() => {
    playerControllerRef.current?.playOrPause();
  }, []);

  const castSetVolume = useCallback((level) => {
    const player = playerRef.current;
    const controller = playerControllerRef.current;
    if (!player || !controller) return;
    player.volumeLevel = level;
    controller.setVolumeLevel();
  }, []);

  const castToggleMute = useCallback(() => {
    playerControllerRef.current?.muteOrUnmute();
  }, []);

  const stop = useCallback(() => {
    contextRef.current?.endCurrentSession(true);
  }, []);

  return {
    available,
    castCurrentTime,
    castDuration,
    castIsMuted,
    castIsPaused,
    castMedia,
    castPlayerState,
    castSeek,
    castSetVolume,
    castToggleMute,
    castTogglePlay,
    castVolumeLevel,
    connected,
    deviceName,
    sessionType,
    stop,
  };
};
