import './MixCompatibilityPreview.css';
import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { MAX_QUEUE, usePlayer } from '../../../context/PlayerContext';
import useDebounce from '../../../hooks/useDebounce';
import { getWaveform } from '../../../lib/analysis';
import { timeToPixel } from '../../../lib/analysisTimeline';
import api from '../../../lib/api';
import { phraseColour } from '../../../lib/enhancedWaveform';
import {
  GENRE_GUIDE,
  GENRE_GUIDE_REVISION,
  GENRE_GUIDE_SOURCE,
  genreWarning,
} from '../../../lib/genreCompatibility';
import { resolveLibraryTracks } from '../../../lib/libraryWorkbench';
import {
  auditionQueue,
  mixCompatibility,
  mixDuration,
  mixPath,
  mixPlayerTrack,
  mixSections,
} from '../../../lib/mixCompatibility';
import { syncPlan } from '../../../lib/mixSync';
import { getTrackPage } from '../../../lib/musicLibrary';
import { masterTempoPlan } from '../../../lib/playerTempo';
import { seedSignatures } from '../../../lib/streamSignatures';
import { usePagedList } from '../../../lib/usePagedList';
import { formatSeconds } from '../../../lib/util';
import DualMixPlayer from './DualMixPlayer';
import GenreWarning from './GenreWarning';
import PlaylistTools from './PlaylistTools';
import SetRehearsal from './SetRehearsal';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  AudioLines,
  Check,
  Headphones,
  Info,
  ListPlus,
  Pause,
  Play,
  Search,
  X,
} from 'lucide-react';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

const MixPreviewContext = createContext(null);
export const useMixPreview = () => useContext(MixPreviewContext);

export const MixPreviewScope = ({ children, disabled }) => {
  const preview = useMixPreview();
  return (
    <MixPreviewContext.Provider value={disabled ? null : preview}>
      {children}
    </MixPreviewContext.Provider>
  );
};

const titleOf = (track) =>
  track?.title || track?.filename?.split('/').pop() || 'Choose a track';
const percent = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
const range = (window) =>
  `${formatSeconds(window.start)}–${formatSeconds(window.end)}`;

export const useMixTrack = (input, revision = 0) => {
  const path = mixPath(input);
  const inputRef = useRef(input);
  inputRef.current = input;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ path: null, loading: false });
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setState({ path: null, loading: false });
      return undefined;
    }

    setState({ path, track: inputRef.current, loading: true });
    Promise.allSettled([
      resolveLibraryTracks([path]),
      api.get('/analysis/candidates/enhanced', { params: { path } }),
      getWaveform(path, { bars: 512, cachedOnly: true }),
    ]).then(([record, enhanced, waveform]) => {
      if (cancelled) return;
      const track =
        record.status === 'fulfilled'
          ? record.value.find((row) => mixPath(row) === path)
          : inputRef.current;
      if (record.status === 'fulfilled' && !track) {
        setState({
          path,
          loading: false,
          missing: true,
          errors: [
            'This track is no longer in the library. Choose another track.',
          ],
        });
        return;
      }

      if (track) seedSignatures([track]);
      setState({
        path,
        track,
        loading: false,
        enhanced: enhanced.status === 'fulfilled' ? enhanced.value.data : null,
        waveform: waveform.status === 'fulfilled' ? waveform.value : null,
        errors: [
          record.status !== 'fulfilled' && 'Track details could not refresh.',
          enhanced.status !== 'fulfilled' &&
            'Section and vocal analysis could not load.',
          waveform.status !== 'fulfilled' && 'Cached waveform could not load.',
        ].filter(Boolean),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [path, retry, revision]);
  const data =
    state.path === path
      ? state
      : { path, track: input, loading: Boolean(path) };
  return { ...data, retry: () => setRetry((value) => value + 1) };
};

const SourceWaveform = ({ data, side, window }) => {
  const duration = mixDuration(data);
  const peaks = data?.waveform?.overallPeaks;
  const validPeaks = Array.isArray(peaks) && peaks.length > 1 && duration > 0;
  const max = validPeaks
    ? Math.max(0.001, ...peaks.filter(Number.isFinite))
    : 1;
  const polygon = validPeaks
    ? [
        ...peaks.map(
          (peak, i) =>
            `${(i / (peaks.length - 1)) * 1_000},${48 - Math.min(1, Math.max(0, Number.isFinite(peak) ? peak / max : 0)) * 37}`,
        ),
        ...peaks
          .map(
            (peak, i) =>
              `${(i / (peaks.length - 1)) * 1_000},${48 + Math.min(1, Math.max(0, Number.isFinite(peak) ? peak / max : 0)) * 37}`,
          )
          .reverse(),
      ].join(' ')
    : '';
  if (!validPeaks)
    return (
      <div className="mix-waveform-empty">Cached waveform unavailable</div>
    );
  const start = window ? timeToPixel(window.start, duration, 1_000) : 0;
  const end = window ? timeToPixel(window.end, duration, 1_000) : 0;
  return (
    <div className="mix-source-waveform">
      <svg
        aria-label={`${side} full track waveform${window ? `, suggested region ${range(window)}` : ''}`}
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 1000 96"
      >
        {mixSections(data).map((section) => (
          <rect
            fill={phraseColour(section.label)}
            height="5"
            key={`${section.start}-${section.end}-${section.label}`}
            width={timeToPixel(section.end - section.start, duration, 1_000)}
            x={timeToPixel(section.start, duration, 1_000)}
            y="0"
          >
            <title>
              {section.label} · {formatSeconds(section.start)}
            </title>
          </rect>
        ))}
        <polygon
          className="mix-waveform-shape"
          points={polygon}
        />
        {window && (
          <>
            <rect
              className="mix-window-tint"
              height="88"
              width={end - start}
              x={start}
              y="8"
            />
            <path
              className="mix-window-edge"
              d={`M${start},8V96 M${end},8V96`}
            />
          </>
        )}
      </svg>
      <div className="mix-waveform-time">
        <span>00:00</span>
        <span>{formatSeconds(duration)}</span>
      </div>
    </div>
  );
};

const MixDeck = ({
  data,
  direction,
  input,
  master,
  matched,
  onChoose,
  onListen,
  side,
  target,
  window,
}) => {
  const track = data.track || input;
  return (
    <section
      aria-label={`${side} ${direction}`}
      className="mix-deck"
    >
      <header>
        <span className="mix-deck-letter">{side}</span>
        <span>{direction}</span>
        {onChoose && (
          <button
            className="jb-btn"
            onClick={onChoose}
            type="button"
          >
            {track ? 'Change track' : 'Choose track'}
          </button>
        )}
      </header>
      <h3 title={titleOf(track)}>{titleOf(track)}</h3>
      <p>
        {track?.artist || (track ? 'Unknown artist' : 'Pick from your library')}
      </p>
      <div className="mix-deck-facts">
        <span>
          <b>{track?.bpm || '—'}</b> BPM
        </span>
        <span>
          <b>{track?.key || '—'}</b> key
        </span>
        <span>
          {track?.lufs == null
            ? 'Loudness unavailable'
            : `${track.lufs.toFixed(1)} LUFS`}
        </span>
        {master?.known && (
          <span>
            → <b>{target}</b> master BPM · {percent(master.adjustment)}
          </span>
        )}
      </div>
      {data.loading ? (
        <div
          className="mix-waveform-empty"
          role="status"
        >
          Loading saved analysis…
        </div>
      ) : (
        <SourceWaveform
          data={data}
          side={side}
          window={window}
        />
      )}
      {window && (
        <div className="mix-window-caption">
          <div>
            <strong>{range(window)}</strong>
            <span>
              {window.label} ·{' '}
              {window.aligned
                ? `${window.bars} detected bars`
                : 'time-based suggestion'}
            </span>
          </div>
          {onListen && (
            <button
              aria-label={`Audition ${side} ${direction.toLowerCase()}`}
              className="jb-btn"
              disabled={
                data.loading || data.missing || (matched && !master?.allowed)
              }
              onClick={onListen}
              title={
                matched && !master?.allowed
                  ? 'Outside the selected tempo audition range'
                  : undefined
              }
              type="button"
            >
              <Play size={13} /> Audition {side}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

const Signal = ({ attention, children, known, title, value }) => (
  <article className={`mix-signal${attention ? ' is-attention' : ''}`}>
    <span>
      {title}
      {known && (
        <Check
          aria-label="Available"
          size={12}
        />
      )}
    </span>
    <h4>{value}</h4>
    <p>{children}</p>
  </article>
);

const OverlapLane = ({ data, regions, side, window }) => {
  const downbeats = window.aligned
    ? (data.enhanced?.downbeats || []).filter(
        (t) => t >= window.start && t <= window.end,
      )
    : [];
  return (
    <div className="mix-overlap-lane">
      <b>{side}</b>
      <svg
        aria-label={`${side} predicted voice in suggested window`}
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 1000 32"
      >
        {downbeats.map((t) => (
          <line
            className="mix-bar-line"
            key={t}
            x1={timeToPixel(t - window.start, window.end - window.start, 1_000)}
            x2={timeToPixel(t - window.start, window.end - window.start, 1_000)}
            y1="0"
            y2="32"
          />
        ))}
        {regions.map((r) => (
          <rect
            className="mix-voice-region"
            height="18"
            key={`${r.start}-${r.end}`}
            rx="2"
            width={(r.end - r.start) * 1_000}
            x={r.start * 1_000}
            y="7"
          />
        ))}
      </svg>
    </div>
  );
};

const TrackPicker = ({ onCancel, onChoose, otherPath, revision, side }) => {
  const [search, setSearch] = useState('');
  const query = useDebounce(search, 250);
  const page = usePagedList(
    getTrackPage,
    { search: query, sort: 'title' },
    { pageSize: 50, refreshToken: revision },
  );
  return (
    <section
      aria-label={`Choose ${side} track`}
      className="mix-track-picker"
    >
      <header>
        <h3>Choose {side === 'A' ? 'outgoing' : 'incoming'} track</h3>
        <button
          className="jb-btn"
          onClick={onCancel}
          type="button"
        >
          <ArrowLeft size={13} /> Back to comparison
        </button>
      </header>
      <label className="mix-picker-search">
        <Search size={15} />
        <input
          aria-label="Search mix preview library"
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your whole library…"
          value={search}
        />
      </label>
      {page.error && (
        <p role="alert">
          Could not load tracks. Try another search or reopen this picker.
        </p>
      )}
      <p className="mix-picker-count">
        {page.loading ? 'Searching…' : `${page.total} matching tracks`}
      </p>
      <div className="mix-picker-list">
        {page.items.map((track) => (
          <button
            aria-label={`Choose ${titleOf(track)} for ${side}`}
            disabled={mixPath(track) === otherPath}
            key={mixPath(track)}
            onClick={() => onChoose(track)}
            title={
              mixPath(track) === otherPath
                ? 'Already chosen on the other side'
                : undefined
            }
            type="button"
          >
            <span>
              <strong>{titleOf(track)}</strong>
              <small>{track.artist || 'Unknown artist'}</small>
            </span>
            <span>
              {track.bpm || '—'} BPM · {track.key || '—'}
            </span>
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
      {!page.loading && !page.items.length && !page.error && (
        <p>No matching tracks. Try a title or artist.</p>
      )}
      {page.items.length < page.total && (
        <button
          className="jb-btn"
          disabled={page.loadingMore}
          onClick={() => page.loadMore()}
          type="button"
        >
          {page.loadingMore ? 'Loading…' : 'Load more tracks'}
        </button>
      )}
    </section>
  );
};

export const MixCompatibilityPreview = ({
  onClose,
  onPair,
  pair,
  rehearsal,
}) => {
  const player = usePlayer();
  const revision = useDebounce(useLibraryActivity()?.libraryRevision || 0, 600);
  const outgoing = useMixTrack(pair.a, revision);
  const incoming = useMixTrack(pair.b, revision);
  const [bars, setBars] = useState(pair.settings?.bars || 16);
  const [masterMode, setMasterMode] = useState(
    pair.settings?.masterSource ||
      (pair.settings?.masterBpm ? 'custom' : 'first'),
  );
  const [masterText, setMasterText] = useState(
    pair.settings?.masterBpm ? String(pair.settings.masterBpm) : '',
  );
  const [matched, setMatched] = useState(false);
  const [extendedTempo, setExtendedTempo] = useState(
    Boolean(pair.settings?.extendedTempo),
  );
  const target = rehearsal
    ? rehearsal.current.master
    : masterMode === 'first'
      ? outgoing.track?.bpm
      : Number(masterText);
  const masterValid = rehearsal
    ? Number.isFinite(target) && target >= 20 && target <= 400
    : masterMode === 'first' ||
      (masterText.trim() &&
        Number.isFinite(target) &&
        target >= 20 &&
        target <= 400);
  const master = masterTempoPlan(
    outgoing.track?.bpm,
    incoming.track?.bpm,
    target,
    extendedTempo,
  );
  const [picking, setPicking] = useState(
    !mixPath(pair.a) ? 'A' : !mixPath(pair.b) ? 'B' : null,
  );
  const [notice, setNotice] = useState('');
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const same = mixPath(pair.a) && mixPath(pair.a) === mixPath(pair.b);
  const ready =
    outgoing.track &&
    incoming.track &&
    !outgoing.loading &&
    !incoming.loading &&
    !outgoing.missing &&
    !incoming.missing &&
    !rehearsal?.current.loading &&
    masterValid &&
    !same;
  const comparison = useMemo(
    () =>
      ready
        ? mixCompatibility(outgoing, incoming, bars, target, extendedTempo)
        : null,
    [bars, extendedTempo, incoming, outgoing, ready, target],
  );
  const plan = comparison?.plan;
  const dualRef = useRef(null);
  const synced = syncPlan(outgoing, incoming, plan, target, extendedTempo);
  const configureTempo = player.configureAuditionTempo;
  const onRehearsalSettings = rehearsal?.onSettingsChange;
  useEffect(() => {
    onRehearsalSettings?.({ bars, extendedTempo });
  }, [bars, extendedTempo, onRehearsalSettings]);
  const currentPath = mixPath(player.track);
  const outgoingPath = mixPath(pair.a);
  const incomingPath = mixPath(pair.b);
  const activeRate =
    currentPath === outgoingPath
      ? master.a
      : currentPath === incomingPath
        ? master.b
        : null;
  useEffect(() => {
    if (!matched || !ready || !activeRate?.allowed) {
      configureTempo(null);
      return;
    }

    if (!configureTempo({ path: currentPath, rate: activeRate.rate })) {
      configureTempo(null);
      setNotice(
        'Pitch-preserving tempo audition is unavailable on this output. Use original-tempo audition.',
      );
    }
  }, [
    matched,
    ready,
    activeRate?.allowed,
    activeRate?.rate,
    configureTempo,
    currentPath,
  ]);
  useEffect(
    () => () => {
      configureTempo(null);
    },
    [configureTempo],
  );
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }

      if (event.key === 'Tab') {
        const targets = [
          ...dialogRef.current.querySelectorAll(
            'button:not(:disabled),input,select,summary,a[href]',
          ),
        ].filter((node) => node.getClientRects().length);
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      (previous?.isConnected
        ? previous
        : document.querySelector('.mix-preview-launch')
      )?.focus();
    };
  }, [onClose]);
  const listen = (data, window, side) => {
    dualRef.current?.stop();
    if (
      (player.queue || []).length > MAX_QUEUE ||
      ((player.queue || []).length >= MAX_QUEUE &&
        !(player.queue || []).some(
          (row) => mixPath(row) === mixPath(data.track),
        ))
    ) {
      setNotice(
        'Your queue is full. Remove a track before auditioning a new one.',
      );
      return;
    }

    const rate = side === 'A' ? master.a : master.b;
    if (
      matched &&
      (!rate.allowed ||
        !player.configureAuditionTempo({
          path: mixPath(data.track),
          rate: rate.rate,
        }))
    ) {
      setNotice(
        `Tempo-matched audition needs supported pitch preservation and a change within ±${master.limit}%. Use original speed or choose another master BPM.`,
      );
      return;
    }

    if (!matched) player.configureAuditionTempo(null);
    const audition = auditionQueue(player.queue, data.track);
    player.seekTrack(audition.tracks, audition.index, window.start);
    setNotice(
      `Loaded ${titleOf(data.track)} at ${formatSeconds(window.start)}${matched ? ` · master ${master.target} BPM, pitch preserved` : ' · original tempo'}. Existing queued tracks are kept.`,
    );
  };

  const errors = [...(outgoing.errors || []), ...(incoming.errors || [])];
  const queued =
    incoming.track &&
    (player.queue || []).some(
      (row) => mixPath(row) === mixPath(incoming.track),
    );
  return createPortal(
    <div className="mix-preview-backdrop dj-workspace">
      <section
        aria-labelledby="mix-preview-title"
        aria-modal="true"
        className={`mix-preview${rehearsal ? ' is-set-rehearsal' : ''}`}
        ref={dialogRef}
        role="dialog"
      >
        <header className="mix-preview-header">
          <div>
            <span className="mix-eyebrow">
              <Headphones size={13} />{' '}
              {rehearsal
                ? 'Your set, handover by handover'
                : 'Find your next transition'}
            </span>
            <h2 id="mix-preview-title">
              {rehearsal ? 'Full-set rehearsal' : 'Mix compatibility'}
            </h2>
            <p>
              {rehearsal
                ? rehearsal.title
                : 'Hear the possibilities. See what needs care.'}
            </p>
          </div>
          <div className="mix-preview-header-tools">
            <button
              aria-label="Close mix preview"
              className="jb-icon-btn"
              onClick={onClose}
              ref={closeRef}
              type="button"
            >
              <X size={19} />
            </button>
          </div>
          {rehearsal?.navigation}
        </header>
        <div className="mix-preview-body">
          {picking ? (
            <TrackPicker
              key={picking}
              onCancel={() => setPicking(null)}
              onChoose={(track) => {
                onPair({ ...pair, [picking === 'A' ? 'a' : 'b']: track });
                setPicking(null);
                setNotice('');
              }}
              otherPath={mixPath(picking === 'A' ? pair.b : pair.a)}
              revision={revision}
              side={picking}
            />
          ) : (
            <>
              <div className="mix-pair-heading">
                <span>
                  A <ArrowRight size={13} /> B · outgoing into incoming
                </span>
                {!rehearsal && (
                  <button
                    className="jb-btn"
                    disabled={!pair.a || !pair.b}
                    onClick={() => {
                      onPair({ a: pair.b, b: pair.a });
                      setNotice('');
                    }}
                    type="button"
                  >
                    <ArrowLeftRight size={13} /> Swap direction
                  </button>
                )}
              </div>
              <div className="mix-master-controls">
                {rehearsal ? (
                  <div className="mix-fixed-master">
                    <strong>{target || '—'} BPM</strong>
                    <span>Fixed set master · first track to last track</span>
                    <label className="mix-master-check">
                      <input
                        checked={extendedTempo}
                        onChange={(e) => setExtendedTempo(e.target.checked)}
                        type="checkbox"
                      />{' '}
                      Extend preview range ±8% to ±25%
                    </label>
                    <button
                      className="jb-btn"
                      onClick={onClose}
                      type="button"
                    >
                      Change master in planner
                    </button>
                  </div>
                ) : (
                  <>
                    <label>
                      Master BPM source
                      <select
                        aria-label="Master BPM source"
                        onChange={(e) => {
                          setMasterMode(e.target.value);
                          setMasterText(String(outgoing.track?.bpm || ''));
                          setNotice('');
                        }}
                        value={masterMode}
                      >
                        <option value="first">First track (A)</option>
                        <option value="custom">Custom BPM</option>
                      </select>
                    </label>
                    <label>
                      Master BPM
                      <input
                        aria-label="Master BPM"
                        disabled={masterMode === 'first'}
                        max="400"
                        min="20"
                        onChange={(e) => {
                          setMasterText(e.target.value);
                          setNotice('');
                        }}
                        step="0.1"
                        type="number"
                        value={
                          masterMode === 'first'
                            ? outgoing.track?.bpm || ''
                            : masterText
                        }
                      />
                    </label>
                    <label className="mix-master-check">
                      <input
                        checked={matched}
                        onChange={(e) => {
                          setMatched(e.target.checked);
                          setNotice('');
                        }}
                        type="checkbox"
                      />{' '}
                      Tempo-matched audition
                    </label>
                    <span className="mix-master-lock">
                      Master Tempo / key lock · pitch preserved
                    </span>
                    <details>
                      <summary>Range</summary>
                      <label className="mix-master-check">
                        <input
                          checked={extendedTempo}
                          onChange={(e) => setExtendedTempo(e.target.checked)}
                          type="checkbox"
                        />{' '}
                        Extend ±8% to ±25%
                      </label>
                    </details>
                  </>
                )}
              </div>
              {comparison && <GenreWarning comparison={comparison.genre} />}
              {!masterValid && (
                <p role="alert">Enter a master BPM between 20 and 400.</p>
              )}
              {matched && ready && (!master.a.allowed || !master.b.allowed) && (
                <p
                  className="mix-master-range-note"
                  role="status"
                >
                  A track is outside the ±{master.limit}% audition range. Choose
                  another master BPM or use original tempo. Half/double-time
                  readings are rhythmic alternatives, not automatic speed
                  changes.
                </p>
              )}
              <div className="mix-decks">
                <MixDeck
                  data={outgoing}
                  direction="Outgoing"
                  input={pair.a}
                  master={master.a}
                  matched={matched}
                  onChoose={rehearsal ? null : () => setPicking('A')}
                  onListen={
                    rehearsal ? null : () => listen(outgoing, plan.exit, 'A')
                  }
                  side="A"
                  target={master.target}
                  window={plan?.exit}
                />
                <MixDeck
                  data={incoming}
                  direction="Incoming"
                  input={pair.b}
                  master={master.b}
                  matched={matched}
                  onChoose={rehearsal ? null : () => setPicking('B')}
                  onListen={
                    rehearsal ? null : () => listen(incoming, plan.entry, 'B')
                  }
                  side="B"
                  target={master.target}
                  window={plan?.entry}
                />
              </div>
              {ready && (
                <DualMixPlayer
                  contextRef={rehearsal?.contextRef}
                  key={JSON.stringify(synced)}
                  labels={[titleOf(outgoing.track), titleOf(incoming.track)]}
                  mainPlaying={player.isPlaying}
                  onBeforePlay={() => {
                    player.pausePlayback();
                    player.configureAuditionTempo(null);
                  }}
                  onComplete={rehearsal?.onComplete}
                  onPreparing={rehearsal?.onPreparing}
                  onStarted={rehearsal?.onStarted}
                  onSuspend={rehearsal?.onSuspend}
                  plan={synced}
                  playRequest={rehearsal?.playRequest}
                  ref={dualRef}
                  volumeRef={rehearsal?.volumeRef}
                />
              )}
              {same && (
                <p role="status">
                  Choose two different tracks to compare a transition.
                </p>
              )}
              {!pair.a || !pair.b ? (
                <div className="mix-empty">
                  <AudioLines size={28} />
                  <h3>Every great transition starts with two tracks.</h3>
                  <p>
                    Choose an outgoing track and the track you want to bring in.
                  </p>
                </div>
              ) : (
                (outgoing.loading || incoming.loading) && (
                  <p role="status">Comparing saved analysis…</p>
                )
              )}
              {Boolean(errors.length) && (
                <div
                  className="mix-analysis-warning"
                  role="status"
                >
                  <Info size={16} />
                  <span>{[...new Set(errors)].join(' ')}</span>
                  <button
                    className="jb-btn"
                    onClick={() => {
                      outgoing.retry();
                      incoming.retry();
                    }}
                    type="button"
                  >
                    Retry analysis lookup
                  </button>
                </div>
              )}
              {comparison && (
                <>
                  <div className="mix-verdict">
                    <div>
                      <span className="mix-eyebrow">Transition guide</span>
                      <h3>{comparison.label}</h3>
                    </div>
                    <span>{comparison.signals} of 6 signals available</span>
                  </div>
                  {!genreWarning(comparison.genre) && (
                    <div
                      className={`mix-genre-fit is-${comparison.genre.kind}`}
                    >
                      <div>
                        <strong>{comparison.genre.label}</strong>
                        <p>{comparison.genre.detail}</p>
                      </div>
                      <span>
                        {comparison.genre.from.family?.label || 'Unknown'} (
                        {comparison.genre.from.source}) →{' '}
                        {comparison.genre.to.family?.label || 'Unknown'} (
                        {comparison.genre.to.source})
                      </span>
                    </div>
                  )}
                  <div className="mix-signals">
                    <Signal
                      attention={
                        comparison.tempo.known &&
                        Math.abs(comparison.tempo.adjustment) > 6
                      }
                      known={comparison.tempo.known}
                      title="Tempo"
                      value={
                        comparison.tempo.known
                          ? percent(comparison.tempo.adjustment)
                          : 'Unknown'
                      }
                    >
                      {comparison.tempo.known ? (
                        <>
                          Master {comparison.master.target} BPM · A{' '}
                          {percent(comparison.master.a.adjustment)}, B{' '}
                          {percent(comparison.master.b.adjustment)}.{' '}
                          {comparison.tempo.label}.
                          {comparison.tempo.alternative && (
                            <>
                              {' '}
                              {comparison.tempo.alternative.factor === 0.5
                                ? 'Half'
                                : 'Double'}
                              -time reading: {comparison.tempo.alternative.bpm}{' '}
                              BPM (
                              {percent(comparison.tempo.alternative.adjustment)}
                              ).
                            </>
                          )}
                        </>
                      ) : (
                        'Both tracks need a saved BPM.'
                      )}
                    </Signal>
                    <Signal
                      attention={comparison.key.kind === 'contrast'}
                      known={comparison.key.known}
                      title="Harmonic key"
                      value={
                        comparison.key.known
                          ? `${comparison.key.from} → ${comparison.key.to}`
                          : 'Unknown'
                      }
                    >
                      {comparison.key.label}. Key guidance assumes key lock when
                      changing tempo.
                    </Signal>
                    <Signal
                      attention={
                        comparison.loudness.known &&
                        Math.abs(comparison.loudness.delta) > 3
                      }
                      known={comparison.loudness.known}
                      title="Loudness"
                      value={
                        comparison.loudness.known
                          ? `${comparison.loudness.delta > 0 ? '+' : ''}${comparison.loudness.delta.toFixed(1)} LU`
                          : 'Unknown'
                      }
                    >
                      {comparison.loudness.known
                        ? `B is ${Math.abs(comparison.loudness.delta) < 0.2 ? 'about as loud as A' : comparison.loudness.delta > 0 ? 'louder than A; trim its gain to blend' : 'quieter than A; check its gain'}. Whole-track loudness estimate.`
                        : 'Saved loudness is needed for a level comparison.'}
                    </Signal>
                    <Signal
                      attention={plan?.overlapSeconds > 2}
                      known={comparison.voiceKnown}
                      title="Vocal overlap"
                      value={
                        !comparison.voiceKnown || !plan
                          ? 'Unknown'
                          : plan.overlapSeconds < 0.1
                            ? 'None predicted'
                            : `~${plan.overlapSeconds.toFixed(1)}s`
                      }
                    >
                      {comparison.voiceKnown && plan
                        ? 'Singing and processed voice in the suggested windows. Listen for clashes.'
                        : 'Enhanced vocal analysis is needed on both tracks.'}
                    </Signal>
                  </div>
                  {plan && (
                    <section className="mix-overlap">
                      <header>
                        <div>
                          <h3>Ending → opening</h3>
                          <p>
                            {plan.exit.aligned && plan.entry.aligned
                              ? `${bars} saved bars on each side · about ${plan.duration.toFixed(1)} seconds at master ${comparison.master.target || 'unknown'} BPM`
                              : 'Time-based windows · detected bar alignment is unavailable'}
                          </p>
                        </div>
                        <label>
                          Length
                          <select
                            aria-label="Suggested mix length"
                            onChange={(e) => setBars(Number(e.target.value))}
                            value={bars}
                          >
                            <option value="8">8 bars</option>
                            <option value="16">16 bars</option>
                            <option value="32">32 bars</option>
                          </select>
                        </label>
                      </header>
                      <div className="mix-overlap-lanes">
                        <OverlapLane
                          data={outgoing}
                          regions={plan.aVoice}
                          side="A"
                          window={plan.exit}
                        />
                        <OverlapLane
                          data={incoming}
                          regions={plan.bVoice}
                          side="B"
                          window={plan.entry}
                        />
                      </div>
                      <div className="mix-overlap-scale">
                        <span>
                          Bring B in · {formatSeconds(plan.entry.start)}
                        </span>
                        <span>Finish A · {formatSeconds(plan.exit.end)}</span>
                      </div>
                      <p className="mix-overlap-note">
                        <span className="mix-voice-dot" /> Predicted voice ·
                        lanes compare A’s final complete bars with B’s first
                        complete bars at the master tempo.
                      </p>
                      {(plan.phaseUncertain ||
                        plan.timingA.variable ||
                        plan.timingB.variable ||
                        plan.timingA.differs ||
                        plan.timingB.differs) && (
                        <div className="mix-timing-note">
                          <Info size={14} />
                          <span>
                            {plan.timingA.variable || plan.timingB.variable
                              ? 'Detected beat spacing varies in a suggested window. Use a short transition and check the timing.'
                              : plan.timingA.differs || plan.timingB.differs
                                ? 'Detected tempo in a suggested window differs from its saved BPM. Check the local timing before a long blend.'
                                : 'Bar-phase confidence is low in saved analysis. Audition the suggested starts.'}
                          </span>
                        </div>
                      )}
                    </section>
                  )}
                  <details className="mix-context">
                    <summary>Sound and analysis context</summary>
                    <dl>
                      <dt>Genre context</dt>
                      <dd>
                        {comparison.genreA || 'Unknown'} →{' '}
                        {comparison.genreB || 'Unknown'}
                      </dd>
                      <dt>Energy proxy</dt>
                      <dd>
                        {Number.isFinite(comparison.energyA)
                          ? comparison.energyA.toFixed(3)
                          : '—'}{' '}
                        →{' '}
                        {Number.isFinite(comparison.energyB)
                          ? comparison.energyB.toFixed(3)
                          : '—'}{' '}
                        RMS · loudness-based, not a musical energy rating
                      </dd>
                    </dl>
                    <p>
                      Section boundaries and voice regions are independent
                      predictions. The preview uses A’s final complete bars and
                      B’s first complete bars; predicted vocal clashes are shown
                      without moving the handover into the middle of a track. A
                      compatibility guide cannot judge the musical result for
                      you.
                    </p>
                  </details>
                  <details className="mix-genre-guide">
                    <summary>Reviewed genre guide</summary>
                    <p>
                      Style relationships help narrow the search; they do not
                      verify a particular mix. Broad tags and tag/prediction
                      disagreements are shown as uncertain.
                    </p>
                    <table>
                      <thead>
                        <tr>
                          <th>Style group</th>
                          <th>Mixing consideration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {GENRE_GUIDE.map((row) => (
                          <tr key={row.styles}>
                            <td>{row.styles}</td>
                            <td>{row.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>
                      Reviewed {GENRE_GUIDE_REVISION} ·{' '}
                      <a
                        href={GENRE_GUIDE_SOURCE}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Pioneer DJ mixing guide
                      </a>
                      . Related-pair rules are conservative Resonance heuristics
                      drawn from the guide.
                    </p>
                  </details>
                </>
              )}
            </>
          )}
        </div>
        <footer className="mix-preview-footer">
          {rehearsal ? (
            rehearsal.footer({
              ready: ready && synced.available,
              onPlay: () => {
                void dualRef.current?.play();
              },
              onPause: () => {
                dualRef.current?.pause();
                player.pausePlayback();
              },
            })
          ) : (
            <>
              <div>
                <span role="status">
                  {notice ||
                    (matched
                      ? `Single-deck audition targets master ${master.target || '—'} BPM. Transition preview uses the master tempo.`
                      : 'Single-deck audition uses original tempo. Transition preview uses the master tempo.')}
                </span>
                <small>
                  Closing stops the two-deck preview and restores original
                  speed. Single-deck processing settings stay as selected.
                </small>
              </div>
              <button
                className="jb-btn"
                disabled={!player.track}
                onClick={() => {
                  dualRef.current?.pause();
                  player.pausePlayback();
                }}
                type="button"
              >
                <Pause size={13} /> Pause
              </button>
              {ready && (
                <>
                  <PlaylistTools
                    paths={[mixPath(outgoing.track), mixPath(incoming.track)]}
                  />
                  <button
                    className="jb-btn mix-primary"
                    disabled={
                      queued || (player.queue || []).length >= MAX_QUEUE
                    }
                    onClick={() => {
                      player.addToQueueNext(mixPlayerTrack(incoming.track));
                      setNotice('Incoming track added next in your queue.');
                    }}
                    type="button"
                  >
                    <ListPlus size={14} />{' '}
                    {queued
                      ? 'B is in queue'
                      : (player.queue || []).length >= MAX_QUEUE
                        ? 'Queue full'
                        : 'Queue B next'}
                  </button>
                </>
              )}
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export const MixPreviewButton = () => {
  const preview = useMixPreview();
  if (!preview) return null;
  return (
    <button
      className="jb-btn mix-preview-launch"
      onClick={(event) =>
        preview.open(
          null,
          null,
          null,
          event.currentTarget.ownerDocument.defaultView,
        )
      }
      title="Compare two tracks and audition a transition"
      type="button"
    >
      <Headphones size={15} /> Mix preview
    </button>
  );
};

export const MixPreviewProvider = ({ children }) => {
  const player = usePlayer();
  const [pair, setPair] = useState(null);
  const [session, setSession] = useState(null);
  const serial = useRef(0);
  const open = useCallback(
    (outgoing, incoming, settings = null) => {
      setSession(null);
      setPair({
        a: outgoing || player.track || null,
        b: incoming || null,
        settings,
      });
    },
    [player.track],
  );
  const openSet = useCallback((plan, startIndex = 0) => {
    if (!plan || plan.items.length < 2) return;
    setPair(null);
    setSession({
      key: ++serial.current,
      plan: JSON.parse(JSON.stringify(plan)),
      startIndex,
    });
  }, []);
  const close = useCallback(() => {
    setPair(null);
    setSession(null);
  }, []);
  const value = useMemo(() => ({ open, openSet }), [open, openSet]);
  return (
    <MixPreviewContext.Provider value={value}>
      {children}
      {pair && (
        <MixCompatibilityPreview
          onClose={close}
          onPair={setPair}
          pair={pair}
        />
      )}
      {session && (
        <SetRehearsal
          Preview={MixCompatibilityPreview}
          key={session.key}
          onClose={close}
          plan={session.plan}
          startIndex={session.startIndex}
        />
      )}
    </MixPreviewContext.Provider>
  );
};
