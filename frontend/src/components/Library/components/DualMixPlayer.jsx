import { SharedMixTransport, sourcePosition } from '../../../lib/mixSync';
import { renderMixDeck } from '../../../lib/prepareMixAudio';
import { formatSeconds } from '../../../lib/util';
import { Headphones, Pause, Play, RotateCcw } from 'lucide-react';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

const DualMixPlayer = forwardRef(
  (
    {
      contextRef,
      labels = [],
      mainPlaying,
      onBeforePlay,
      onComplete,
      onPreparing,
      onStarted,
      onSuspend,
      plan,
      playRequest,
      volumeRef,
    },
    ref,
  ) => {
    const events = useRef({});
    events.current = { onComplete, onPreparing, onStarted, onSuspend };
    const wholeAudition = useRef(true);
    const requested = useRef(null);
    const session = useRef({
      transport: null,
      context: null,
      abort: null,
      disposed: false,
    });
    const [state, setState] = useState({
      phase: 'idle',
      elapsed: 0,
      playing: false,
    });
    const [crossfade, setCrossfade] = useState(0);
    const [automatic, setAutomatic] = useState(true);
    const [volume, setVolume] = useState(volumeRef?.current ?? 0.8);
    const controls = useRef({ automatic: true, crossfade: 0, volume });
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState('');
    const refresh = () => {
      const snapshot = session.current.transport?.snapshot();
      if (snapshot && !session.current.disposed)
        setState({ phase: 'ready', ...snapshot });
    };

    const pause = () => {
      session.current.abort?.abort();
      session.current.transport?.pause();
      refresh();
      events.current.onSuspend?.('paused');
    };

    const stop = () => {
      session.current.abort?.abort();
      session.current.transport?.stop();
      refresh();
      wholeAudition.current = true;
      events.current.onSuspend?.('stopped');
    };

    useEffect(() => {
      const owner = session.current;
      const timer = setInterval(refresh, 80);
      return () => {
        owner.disposed = true;
        owner.abort?.abort();
        owner.transport?.dispose();
        if (!contextRef && owner.context?.state !== 'closed')
          void owner.context?.close();
        events.current.onSuspend?.('disposed');
        clearInterval(timer);
      };
      // The parent keys this owner by the full source-grid/tempo specification.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
      if (
        mainPlaying &&
        (session.current.transport?.snapshot().playing || session.current.abort)
      )
        pause();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mainPlaying]);

    const play = async () => {
      const owner = session.current;
      if (!plan.available || owner.abort || owner.disposed) return;
      onBeforePlay();
      setMessage('');
      try {
        if (!owner.transport) {
          events.current.onPreparing?.();
          owner.abort = new AbortController();
          setState({ phase: 'loading', elapsed: 0, playing: false });
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext)
            throw new Error(
              'This browser does not support the audio engine needed for synced preview.',
            );
          owner.context =
            contextRef?.current ||
            new AudioContext({
              latencyHint: 'interactive',
              sampleRate: 44_100,
            });
          if (contextRef) contextRef.current = owner.context;
          // Resume in the original click gesture, before downloads or decoding.
          await owner.context.resume();
          if (owner.disposed) return;
          if (owner.abort.signal.aborted)
            throw new DOMException('Preview cancelled', 'AbortError');
          const buffers = [];
          for (let i = 0; i < 2; i++) {
            if (owner.disposed) return;
            if (owner.abort.signal.aborted)
              throw new DOMException('Preview cancelled', 'AbortError');
            buffers.push(
              await renderMixDeck(
                owner.context,
                plan.decks[i],
                plan.bpm,
                owner.abort.signal,
                (progress) => {
                  if (!owner.disposed)
                    setLoading(`${i === 0 ? 'A' : 'B'} · ${progress}`);
                },
              ),
            );
          }

          if (owner.disposed) return;
          owner.transport = new SharedMixTransport(
            owner.context,
            buffers,
            plan,
            () => {
              if (owner.disposed) return;
              refresh();
              events.current.onComplete?.({
                fullyPlayed: wholeAudition.current,
              });
            },
          );
          if (!controls.current.automatic)
            owner.transport.setCrossfade(controls.current.crossfade);
          owner.transport.setVolume(controls.current.volume);
          // This preparation owns the abort lock until both renders complete.
          // eslint-disable-next-line require-atomic-updates
          owner.abort = null;
        }

        if (owner.transport.snapshot().elapsed >= plan.duration)
          wholeAudition.current = true;
        await owner.transport.play();
        refresh();
        if (!owner.disposed && owner.transport?.snapshot().playing)
          events.current.onStarted?.();
      } catch (error) {
        if (owner.disposed) return;
        // The failed preparation still owns this session's abort lock.
        // eslint-disable-next-line require-atomic-updates
        owner.abort = null;
        owner.transport?.dispose();
        owner.transport = null;
        if (!contextRef && owner.context?.state !== 'closed')
          void owner.context?.close();
        owner.context = null;
        setState({ phase: 'idle', elapsed: 0, playing: false });
        if (error.name !== 'AbortError')
          setMessage(
            error.message || 'The mix could not start. Please try again.',
          );
        events.current.onSuspend?.(
          error.name === 'AbortError' ? 'cancelled' : 'error',
        );
      }
    };

    useImperativeHandle(ref, () => ({ pause, stop, play }));

    useEffect(() => {
      if (playRequest && plan.available && requested.current !== playRequest) {
        requested.current = playRequest;
        void play();
      }
      // A request belongs to this keyed plan owner and is consumed once.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playRequest, plan.available]);

    const cancel = () => {
      session.current.abort?.abort();
      events.current.onSuspend?.('cancelled');
    };

    const setFade = (value) => {
      controls.current.crossfade = value;
      setCrossfade(value);
      session.current.transport?.setCrossfade(value);
      refresh();
    };

    const toggleAutomatic = (enabled) => {
      session.current.transport?.setAutomatic(enabled);
      const value =
        session.current.transport?.snapshot().crossfade ??
        state.crossfade ??
        crossfade;
      controls.current.automatic = enabled;
      controls.current.crossfade = value;
      setCrossfade(value);
      setAutomatic(enabled);
      refresh();
    };

    const fadePosition = automatic ? state.crossfade ?? 0 : crossfade;
    const stage =
      state.elapsed < plan.handoverStart
        ? 'A ending · B cued'
        : state.elapsed < plan.handoverEnd
          ? 'Handover · A → B'
          : 'B continues · A finished';
    const aTime = plan.available
      ? sourcePosition(plan.decks[0], state.elapsed, plan)
      : 0;
    const bTime = plan.available
      ? sourcePosition(plan.decks[1], state.elapsed, plan)
      : 0;
    return (
      <section
        aria-label="Transition preview"
        className="mix-dual-player"
      >
        <header>
          <div>
            <span className="mix-eyebrow">
              <Headphones size={13} /> Hear the transition
            </span>
            <h3>Rehearse the handover</h3>
            <p>
              {plan.available
                ? `${plan.bpm} BPM master · ${plan.bars}-bar handover · pitch preserved`
                : plan.reason}
            </p>
          </div>
          <span
            className="mix-dual-state"
            role="status"
          >
            {!plan.available
              ? 'Sync unavailable'
              : state.phase === 'loading'
                ? loading || 'Preparing audio…'
                : state.playing
                  ? `${stage}${automatic ? '' : ' · manual fader'}`
                  : state.phase === 'ready'
                    ? state.elapsed >= plan.duration
                      ? 'Transition complete'
                      : `Paused · ${stage}`
                    : 'A ending → B opening'}
          </span>
        </header>
        {plan.available && (
          <ol
            aria-label="Transition sequence"
            className="mix-transition-sequence"
          >
            {plan.leadBars > 0 && (
              <li
                className={
                  state.elapsed < plan.handoverStart ? 'is-current' : ''
                }
                style={{ flexGrow: plan.leadBars }}
              >
                <strong>A ending</strong>
                <span>{plan.leadBars} bars · A alone</span>
              </li>
            )}
            <li
              className={
                state.elapsed >= plan.handoverStart &&
                state.elapsed < plan.handoverEnd
                  ? 'is-current'
                  : ''
              }
              style={{ flexGrow: plan.bars }}
            >
              <strong>Bring B in → fade A out</strong>
              <span>{plan.bars} bars · aligned at master tempo</span>
            </li>
            {plan.tailBars > 0 && (
              <li
                className={
                  state.elapsed >= plan.handoverEnd ? 'is-current' : ''
                }
                style={{ flexGrow: plan.tailBars }}
              >
                <strong>B continues</strong>
                <span>{plan.tailBars} bars · B alone</span>
              </li>
            )}
          </ol>
        )}
        <div className="mix-dual-timeline">
          <div className="mix-dual-meters">
            {['A', 'B'].map((side, i) => (
              <div key={side}>
                <span title={labels[i]}>
                  {side} {labels[i] || ''}
                </span>
                <span
                  aria-label={`Deck ${side} output level`}
                  aria-valuemax="0"
                  aria-valuemin="-60"
                  aria-valuenow={state.levels?.[i] ?? -60}
                  className="mix-deck-meter"
                  role="meter"
                >
                  <i
                    style={{
                      width: `${(((state.levels?.[i] ?? -60) + 60) / 60) * 100}%`,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          <div className="mix-dual-times">
            <span>
              {state.elapsed >= plan.handoverEnd ? 'A finished' : 'A'}{' '}
              <b>{formatSeconds(aTime)}</b>
            </span>
            <span>
              {formatSeconds(state.elapsed)} /{' '}
              {formatSeconds(plan.duration || 0)}
            </span>
            <span>
              {state.elapsed < plan.handoverStart ? 'B cued' : 'B'}{' '}
              <b>{formatSeconds(bTime)}</b>
            </span>
          </div>
          <input
            aria-label="Seek transition"
            disabled={state.phase !== 'ready'}
            max={plan.duration || 1}
            min="0"
            onChange={(e) => {
              wholeAudition.current = false;
              const requestedPosition = Number(e.target.value);
              // Native range inputs round End down to their 0.01s step when
              // duration is fractional. Snap that final step to the endpoint
              // so a seek cannot masquerade as a natural end a few ms later.
              const position =
                requestedPosition >= plan.duration - 0.01
                  ? plan.duration
                  : requestedPosition;
              void session.current.transport?.seek(position).then(() => {
                refresh();
                if (!session.current.disposed && position >= plan.duration)
                  events.current.onSuspend?.('seek-end');
              });
            }}
            step="0.01"
            type="range"
            value={state.elapsed}
          />
        </div>
        <div className="mix-dual-controls">
          <div className="mix-dual-transport">
            <button
              className="jb-btn mix-primary"
              disabled={!plan.available || state.phase === 'loading'}
              onClick={
                state.playing
                  ? pause
                  : () => {
                      void play();
                    }
              }
              type="button"
            >
              {state.playing ? (
                <>
                  <Pause size={14} /> Pause transition
                </>
              ) : (
                <>
                  <Play size={14} />{' '}
                  {state.phase === 'ready' &&
                  state.elapsed > 0 &&
                  state.elapsed < plan.duration
                    ? 'Resume transition'
                    : 'Preview transition'}
                </>
              )}
            </button>
            {state.phase === 'loading' ? (
              <button
                className="jb-btn"
                onClick={cancel}
                type="button"
              >
                Cancel preparation
              </button>
            ) : (
              <button
                className="jb-btn"
                disabled={state.phase !== 'ready'}
                onClick={stop}
                type="button"
              >
                <RotateCcw size={13} /> Back to start
              </button>
            )}
          </div>
          <div className="mix-crossfader">
            <label className="mix-auto-handover">
              <input
                checked={automatic}
                onChange={(e) => toggleAutomatic(e.target.checked)}
                type="checkbox"
              />
              Automatic handover
            </label>
            <div>
              <button
                aria-label="Crossfader A only"
                className="jb-btn"
                disabled={automatic}
                onClick={() => setFade(0)}
                type="button"
              >
                A
              </button>
              <label htmlFor="mix-crossfader">
                Crossfader{' '}
                <b>
                  {fadePosition === 0
                    ? 'A only'
                    : fadePosition === 1
                      ? 'B only'
                      : fadePosition === 0.5
                        ? 'Centre'
                        : `${Math.round((1 - fadePosition) * 100)} / ${Math.round(fadePosition * 100)}`}
                </b>
              </label>
              <button
                aria-label="Crossfader B only"
                className="jb-btn"
                disabled={automatic}
                onClick={() => setFade(1)}
                type="button"
              >
                B
              </button>
            </div>
            <input
              aria-label="Crossfader"
              disabled={automatic}
              id="mix-crossfader"
              max="1"
              min="0"
              onChange={(e) => setFade(Number(e.target.value))}
              step="0.01"
              type="range"
              value={fadePosition}
            />
            <button
              className="mix-crossfader-centre"
              disabled={automatic}
              onClick={() => setFade(0.5)}
              type="button"
            >
              Centre crossfader
            </button>
          </div>
          <label className="mix-dual-volume">
            Preview volume <b>{Math.round(volume * 100)}%</b>
            <input
              aria-label="Mix preview volume"
              max="1"
              min="0"
              onChange={(e) => {
                const value = Number(e.target.value);
                controls.current.volume = value;
                if (volumeRef) volumeRef.current = value;
                setVolume(value);
                session.current.transport?.setVolume(value);
              }}
              step="0.01"
              type="range"
              value={volume}
            />
          </label>
        </div>
        {message && (
          <p
            className="mix-dual-error"
            role="alert"
          >
            {message}
          </p>
        )}
        <p className="mix-dual-note">
          {automatic
            ? 'A plays alone, B enters from its first saved bar, and the fader moves across to B. Turn off Automatic handover to control the fade yourself.'
            : 'Move the crossfader to rehearse the fade. B still enters on its aligned bar and A finishes at the end of its saved grid.'}{' '}
          Normal playback pauses. Dry preview · equal-power fade with headroom.
        </p>
      </section>
    );
  },
);
DualMixPlayer.displayName = 'DualMixPlayer';
export default DualMixPlayer;
