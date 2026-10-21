import './SetRehearsal.css';
import useSetPlanAnalysis from '../../../hooks/useSetPlanAnalysis';
import {
  rehearsalCounts,
  rehearsalStatus,
  rehearsalTransitions,
  sameRehearsalSettings,
} from '../../../lib/setRehearsal';
import {
  ArrowLeft,
  ArrowRight,
  Headphones,
  Pause,
  SkipForward,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { unstable_batchedUpdates } from 'react-dom';

const statusLabel = {
  pending: 'Not rehearsed',
  rehearsed: 'Rehearsed',
  partial: 'Partly heard',
  skipped: 'Skipped',
};

const SetRehearsal = ({ Preview, onClose, plan, startIndex = 0 }) => {
  const data = useSetPlanAnalysis(plan.items);
  const [index, setIndex] = useState(
    Math.max(0, Math.min(plan.items.length - 2, startIndex)),
  );
  const [overrides, setOverrides] = useState({});
  const [progress, setProgress] = useState({});
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [phase, setPhase] = useState('idle');
  const [request, setRequest] = useState(null);
  const [notice, setNotice] = useState('');
  const contextRef = useRef(null);
  const volumeRef = useRef(0.8);
  const serial = useRef(0);
  const owner = useRef({ index, mounted: true });
  owner.current.index = index;
  const transitions = useMemo(
    () => rehearsalTransitions(plan, data, overrides),
    [data, overrides, plan],
  );
  const current = transitions[index];
  const counts = rehearsalCounts(transitions, progress);
  useEffect(
    () => () => {
      owner.current.mounted = false;
      if (contextRef.current?.state !== 'closed')
        void contextRef.current?.close();
    },
    [],
  );

  const move = (next, playNext = false) => {
    if (next < 0 || next >= transitions.length || next === index) return;
    owner.current.index = next;
    setRequest(playNext ? ++serial.current : null);
    setIndex(next);
    setPhase(playNext ? 'waiting' : 'idle');
    setNotice('');
  };

  const mark = (status) =>
    setProgress((previous) => ({
      ...previous,
      [index]: { signature: current.signature, status },
    }));
  const suspend = (reason) => {
    if (!owner.current.mounted || owner.current.index !== index) return;
    setRequest(null);
    setPhase('idle');
    if (reason === 'error')
      setNotice(
        'Audio preparation stopped. Review this handover and try again.',
      );
  };

  const onSettingsChange = useCallback(
    (settings) => {
      if (sameRehearsalSettings(settings, current.settings)) return;
      setOverrides((previous) => ({ ...previous, [index]: settings }));
      setRequest(null);
      setPhase('idle');
      setNotice(
        'Rehearsal settings changed. Play this handover again to review them.',
      );
    },
    [current.settings, index],
  );
  useEffect(() => {
    if (request && !current.loading && !current.synced.available) {
      setRequest(null);
      setPhase('blocked');
      setNotice(
        `Rehearsal stopped at handover ${index + 1}. ${current.synced.reason} Adjust its length/range, change the set master in the planner, or skip it explicitly.`,
      );
    }
  }, [current.loading, current.synced, index, request]);

  const navigation = (
    <div className="set-rehearsal-navigation">
      <div className="set-rehearsal-summary">
        <label>
          Handover {index + 1} of {transitions.length}
          <select
            aria-label="Rehearsal handover"
            onChange={(e) => move(Number(e.target.value))}
            value={index}
          >
            {transitions.map((row) => (
              <option
                key={row.index}
                value={row.index}
              >
                {row.index + 1}. {row.titles.join(' → ')}
              </option>
            ))}
          </select>
        </label>
        <div>
          <strong>
            {counts.rehearsed} / {transitions.length}
          </strong>
          <span>
            rehearsed · {counts.partial} partial · {counts.skipped} skipped
          </span>
        </div>
        <label className="set-rehearsal-auto">
          <input
            checked={autoAdvance}
            onChange={(e) => {
              setAutoAdvance(e.target.checked);
              if (!e.target.checked && phase === 'waiting') {
                setRequest(null);
                setPhase('idle');
              }
            }}
            type="checkbox"
          />{' '}
          Advance automatically after playback
        </label>
      </div>
      <ol
        aria-label="Rehearsal progress"
        className="set-rehearsal-progress"
      >
        {transitions.map((row) => {
          const status = rehearsalStatus(row, progress);
          return (
            <li key={row.index}>
              <button
                aria-current={index === row.index ? 'step' : undefined}
                aria-label={`Handover ${row.index + 1}: ${row.titles.join(' into ')}; ${statusLabel[status]}${!row.loading && !row.synced.available ? '; sync unavailable' : ''}`}
                className={`is-${status}${!row.loading && !row.synced.available ? ' is-unavailable' : ''}`}
                onClick={() => move(row.index)}
                title={`${row.titles.join(' → ')} · ${statusLabel[status]}`}
                type="button"
              >
                {row.index + 1}
              </button>
            </li>
          );
        })}
      </ol>
      <p
        className="set-rehearsal-status"
        role="status"
      >
        {notice ||
          (phase === 'waiting'
            ? 'Loading the next handover…'
            : phase === 'complete'
              ? 'Final handover reached. Review partial, skipped or unplayed handovers above.'
              : `${current.master || '—'} BPM fixed across the whole set · ${counts.unavailable} handovers currently cannot sync. Seeking is recorded as a partial audition.`)}
      </p>
    </div>
  );
  const footer = ({ onPause, onPlay, ready }) => (
    <>
      <button
        className="jb-btn"
        onClick={onClose}
        type="button"
      >
        <ArrowLeft size={13} /> Back to planner
      </button>
      <div className="set-rehearsal-footer-copy">
        Ending → opening handovers only.
        <small>
          One fixed master throughout. Length/range changes here are temporary.
        </small>
      </div>
      <div className="set-rehearsal-transport">
        <button
          className="jb-btn"
          disabled={index === 0}
          onClick={() => move(index - 1)}
          type="button"
        >
          Previous handover
        </button>
        {['playing', 'preparing', 'waiting'].includes(phase) ? (
          <button
            className="jb-btn mix-primary"
            onClick={() => {
              suspend('paused');
              onPause();
            }}
            type="button"
          >
            <Pause size={13} /> Pause rehearsal
          </button>
        ) : (
          <button
            className="jb-btn mix-primary"
            disabled={!ready || current.loading || !current.synced.available}
            onClick={onPlay}
            type="button"
          >
            <Headphones size={13} /> Rehearse handover
          </button>
        )}
        <button
          className="jb-btn"
          disabled={index === transitions.length - 1}
          onClick={() => move(index + 1)}
          type="button"
        >
          Next handover <ArrowRight size={13} />
        </button>
        <button
          className="jb-btn"
          onClick={() => {
            onPause();
            mark('skipped');
            if (index + 1 < transitions.length) move(index + 1);
            else {
              setRequest(null);
              setPhase('complete');
              setNotice(
                'Final handover skipped. Skipped handovers are not counted as rehearsed.',
              );
            }
          }}
          type="button"
        >
          <SkipForward size={13} /> Skip handover
        </button>
      </div>
    </>
  );

  return (
    <Preview
      key={index}
      onClose={onClose}
      pair={{
        a: current.a,
        b: current.b,
        settings: {
          ...current.settings,
          masterSource: 'custom',
          masterBpm: current.master,
        },
      }}
      rehearsal={{
        title: plan.name,
        navigation,
        footer,
        contextRef,
        volumeRef,
        playRequest: request,
        current,
        onSettingsChange,
        onPreparing: () => {
          if (owner.current.index === index) {
            setRequest(null);
            setPhase('preparing');
            setNotice('');
          }
        },
        onStarted: () => {
          if (owner.current.index === index) {
            setRequest(null);
            setPhase('playing');
            if (rehearsalStatus(current, progress) !== 'rehearsed')
              mark('partial');
          }
        },
        onSuspend: suspend,
        onComplete: ({ fullyPlayed }) => {
          if (!owner.current.mounted || owner.current.index !== index) return;
          // Audio callbacks run outside React's event batching. Advance the
          // owner and its play request together so the old pair cannot restart.
          unstable_batchedUpdates(() => {
            mark(fullyPlayed ? 'rehearsed' : 'partial');
            setRequest(null);
            if (autoAdvance && index + 1 < transitions.length)
              move(index + 1, true);
            else {
              setPhase(index === transitions.length - 1 ? 'complete' : 'idle');
              setNotice(
                fullyPlayed
                  ? index === transitions.length - 1
                    ? 'Final handover rehearsed. Review any partial, skipped or unplayed handovers above.'
                    : 'Handover rehearsed. Continue when ready.'
                  : 'Partial audition completed. Replay from the beginning to rehearse the full handover.',
              );
            }
          });
        },
      }}
    />
  );
};

export default SetRehearsal;
