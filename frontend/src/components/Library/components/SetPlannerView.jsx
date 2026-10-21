import './SetPlannerView.css';
import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { useSetPlanner } from '../../../context/SetPlannerContext';
import useDebounce from '../../../hooks/useDebounce';
import useSetPlanAnalysis from '../../../hooks/useSetPlanAnalysis';
import { getCratePage, getCrates } from '../../../lib/libraryWorkspace';
import { mixDuration, mixPath } from '../../../lib/mixCompatibility';
import { getFolders, getTrackPage } from '../../../lib/musicLibrary';
import {
  appendSetTracks,
  insertSetTrack,
  MAX_SET_TRACKS,
  moveSetTrack,
  removeSetTrack,
  setMixtape,
  setOverview,
  validBpm,
  validSet,
} from '../../../lib/setPlanner';
import { usePagedList } from '../../../lib/usePagedList';
import { formatSeconds } from '../../../lib/util';
import AlbumArt from './AlbumArt';
import GenreWarning from './GenreWarning';
import { useMixPreview } from './MixCompatibilityPreview';
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Clock,
  Copy,
  GripVertical,
  Headphones,
  Layers3,
  ListMusic,
  Loader2,
  Plus,
  RefreshCw,
  Route,
  Save,
  Search,
  Trash2,
  Undo2,
  Usb,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const titleOf = (track) =>
  track?.title ||
  track?.filename ||
  mixPath(track)?.split('/').pop() ||
  'Track unavailable';
const swallow = (promise) => {
  void promise.catch(() => {});
};

const TempoField = ({ disabled, label, onChange, value }) => {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(String(value ?? '')), [value]);
  return (
    <input
      aria-label={label}
      disabled={disabled}
      max="400"
      min="20"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next && validBpm(Number(next))) onChange(Number(next));
      }}
      required
      step="0.1"
      type="number"
      value={text}
    />
  );
};

const SetSource = ({ busy, onAdd, used }) => {
  const activity = useLibraryActivity();
  const revision = useDebounce(activity?.libraryRevision || 0, 600);
  const [crates, setCrates] = useState([]);
  const [folders, setFolders] = useState([]);
  const [source, setSource] = useState('');
  const [folder, setFolder] = useState('');
  const [search, setSearch] = useState('');
  const query = useDebounce(search, 250);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getCrates(), getFolders()]).then(
      ([crateResult, folderResult]) => {
        if (cancelled) return;
        if (crateResult.status === 'fulfilled') setCrates(crateResult.value);
        if (folderResult.status === 'fulfilled') setFolders(folderResult.value);
        if (
          crateResult.status === 'rejected' ||
          folderResult.status === 'rejected'
        )
          setError(
            'Some sources could not load. The whole-library search is still available.',
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const page = usePagedList(
    (params) =>
      source
        ? getCratePage({ ...params, crateId: source })
        : getTrackPage(params),
    {
      source,
      search: query || undefined,
      folder: !source && folder ? folder : undefined,
      sort: 'title',
    },
    { pageSize: 50, refreshToken: revision },
  );
  useEffect(() => setSelected(new Set()), [folder, query, source]);
  const available = page.items.filter((track) => !used.has(mixPath(track)));
  const allSelected =
    available.length > 0 &&
    available.every((track) => selected.has(mixPath(track)));
  return (
    <aside
      aria-label="Set track browser"
      className="set-source"
    >
      <header>
        <span className="set-eyebrow">
          <Layers3 size={13} /> Dig into your collection
        </span>
        <h3>Find the next track</h3>
      </header>
      <div className="set-source-filters">
        <label>
          Source
          <select
            aria-label="Set track source"
            onChange={(e) => setSource(e.target.value)}
            value={source}
          >
            <option value="">Whole library</option>
            {crates.map((crate) => (
              <option
                key={crate.id}
                value={crate.id}
              >
                {crate.name}
              </option>
            ))}
          </select>
        </label>
        {!source && (
          <label>
            Folder
            <select
              aria-label="Set track folder"
              onChange={(e) => setFolder(e.target.value)}
              value={folder}
            >
              <option value="">All folders</option>
              {folders.map((row) => (
                <option
                  key={row.path}
                  value={row.path}
                >
                  {row.name || row.path}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="set-source-search">
          <Search size={14} />
          <input
            aria-label="Search tracks for set"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, artist, album…"
            value={search}
          />
        </label>
      </div>
      {error && <p className="set-inline-note">{error}</p>}
      <div className="set-source-selection">
        <label>
          <input
            checked={allSelected}
            disabled={busy || !available.length}
            onChange={(e) =>
              setSelected(
                e.target.checked ? new Set(available.map(mixPath)) : new Set(),
              )
            }
            type="checkbox"
          />{' '}
          Select displayed
        </label>
        <span>{page.total} tracks</span>
      </div>
      <div className="set-source-list">
        {page.loading ? (
          <p className="set-inline-note">Loading tracks…</p>
        ) : page.error ? (
          <p role="alert">
            Could not load tracks. Change the source or search to retry.
          </p>
        ) : !page.items.length ? (
          <p className="set-inline-note">No tracks match this source.</p>
        ) : (
          page.items.map((track) => {
            const path = mixPath(track);
            const already = used.has(path);
            return (
              <div
                className={`set-source-track${already ? ' is-used' : ''}`}
                draggable={!already && !busy}
                key={path}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/resonance-track',
                    JSON.stringify(track),
                  );
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <input
                  aria-label={`Select ${titleOf(track)} for set`}
                  checked={selected.has(path) && !already}
                  disabled={already || busy}
                  onChange={(e) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (e.target.checked) next.add(path);
                      else next.delete(path);
                      return next;
                    })
                  }
                  type="checkbox"
                />
                <div>
                  <strong title={titleOf(track)}>{titleOf(track)}</strong>
                  <span>{track.artist || 'Unknown artist'}</span>
                  <small>
                    {track.bpm || '—'} BPM · {track.key || 'Key unknown'} ·{' '}
                    {formatSeconds(track.duration || 0)}
                  </small>
                </div>
                <button
                  aria-label={`Add ${titleOf(track)} to set`}
                  className="set-icon-button"
                  disabled={already || busy}
                  onClick={() => onAdd([track])}
                  title={already ? 'Already in this set' : 'Add to set'}
                  type="button"
                >
                  {already ? <Check size={14} /> : <Plus size={14} />}
                </button>
              </div>
            );
          })
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
      </div>
      <footer>
        <button
          className="jb-btn set-primary"
          disabled={
            busy ||
            !page.items.some(
              (track) =>
                selected.has(mixPath(track)) && !used.has(mixPath(track)),
            )
          }
          onClick={() => {
            onAdd(page.items.filter((track) => selected.has(mixPath(track))));
            setSelected(new Set());
          }}
          type="button"
        >
          <Plus size={14} /> Add selected
        </button>
        <small>Drag tracks into the order, or add them here.</small>
      </footer>
    </aside>
  );
};

const TempoJourney = ({ overview }) => {
  const values = overview.rows.map((row) => row.master).filter(validBpm);
  if (!values.length)
    return (
      <p className="set-inline-note">
        Add a track with a saved BPM or choose a custom set master to see the
        tempo journey.
      </p>
    );
  const min = Math.min(...values) - 3;
  const max = Math.max(...values) + 3;
  const x = (i) =>
    overview.rows.length > 1 ? 24 + (i * 752) / (overview.rows.length - 1) : 24;
  const y = (bpm) => 68 - ((bpm - min) / (max - min)) * 48;
  const points = overview.rows
    .flatMap((row, i) => (row.master ? [`${x(i)},${y(row.master)}`] : []))
    .join(' ');
  return (
    <figure className="set-tempo-journey">
      <figcaption>
        <span>Tempo journey</span>
        <strong>
          {Math.min(...values) === Math.max(...values)
            ? `${values[0]} BPM throughout`
            : `${values[0]} → ${values[values.length - 1]} BPM`}
        </strong>
      </figcaption>
      <svg
        aria-label="Planned master tempo by track position"
        role="img"
        viewBox="0 0 800 100"
      >
        <line
          className="set-chart-baseline"
          x1="24"
          x2="776"
          y1="78"
          y2="78"
        />
        <polyline
          className="set-chart-line"
          points={points}
        />
        {overview.rows.map(
          (row, i) =>
            row.master && (
              <g key={row.path}>
                <circle
                  className={
                    i === 0 ? 'set-chart-checkpoint' : 'set-chart-point'
                  }
                  cx={x(i)}
                  cy={y(row.master)}
                  r={i === 0 ? 4 : 2.5}
                >
                  <title>
                    {i + 1}. {titleOf(row.data?.track || { path: row.path })} ·
                    master {row.master} BPM
                  </title>
                </circle>
                {(overview.rows.length <= 8 ||
                  i % Math.ceil(overview.rows.length / 8) === 0 ||
                  i === overview.rows.length - 1) && (
                  <text
                    textAnchor="middle"
                    x={x(i)}
                    y="96"
                  >
                    {i + 1}
                  </text>
                )}
              </g>
            ),
        )}
      </svg>
    </figure>
  );
};

const SetPlannerView = ({ onExport, onMixtape }) => {
  const planner = useSetPlanner();
  const preview = useMixPreview();
  const plan = planner.draft;
  const empty = useMemo(() => [], []);
  const data = useSetPlanAnalysis(plan?.items || empty);
  const overview = useMemo(
    () => (plan ? setOverview(plan, data) : null),
    [data, plan],
  );
  const [action, setAction] = useState('');
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [undo, setUndo] = useState(null);
  const [over, setOver] = useState(null);
  const handledLaunch = useRef(null);
  const snapshotRequest = useRef(null);
  const formRef = useRef(null);
  const activate = planner.activate;
  useEffect(() => {
    void activate();
  }, [activate]);
  useEffect(() => {
    if (
      !planner.loading &&
      !planner.switching &&
      plan &&
      planner.launch &&
      handledLaunch.current !== planner.launch.token
    ) {
      handledLaunch.current = planner.launch.token;
      planner.consumeLaunch?.(planner.launch.token);
      if (planner.launch.tracks.length)
        planner.edit((current) =>
          appendSetTracks(current, planner.launch.tracks),
        );
    }
  }, [plan, planner]);
  const busy = Boolean(action || planner.switching);
  const perform = async (name, fn) => {
    if (formRef.current && !formRef.current.reportValidity()) return;
    setAction(name);
    setNotice('');
    try {
      await fn();
    } catch (error) {
      setNotice(
        error?.response?.data?.message ||
          error.message ||
          'This action could not finish. Your set is kept.',
      );
    } finally {
      setAction('');
    }
  };

  const add = (tracks) => {
    const remaining = MAX_SET_TRACKS - plan.items.length;
    planner.edit((current) => appendSetTracks(current, tracks));
    setNotice(
      remaining <
        tracks.filter(
          (track) => !plan.items.some((item) => item.path === mixPath(track)),
        ).length
        ? 'This set is limited to 200 tracks; the remaining tracks were not added.'
        : 'Tracks added in their displayed order.',
    );
  };

  const remove = (item, index) => {
    setUndo({ item, index });
    planner.edit((current) => removeSetTrack(current, item.path));
    setNotice('Track removed from this set. Your library file is kept.');
  };

  const drop = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    if (busy) return;
    try {
      const internal = event.dataTransfer.getData(
        'application/resonance-set-item',
      );
      if (internal) {
        const item = JSON.parse(internal);
        if (item.setId !== plan.id) return;
        const from = plan.items.findIndex((row) => row.path === item.path);
        planner.edit((current) =>
          moveSetTrack(
            current,
            from,
            Math.min(index, current.items.length - 1),
          ),
        );
      } else {
        const track = JSON.parse(
          event.dataTransfer.getData('application/resonance-track'),
        );
        if (plan.items.some((row) => row.path === mixPath(track))) return;
        if (plan.items.length >= MAX_SET_TRACKS) {
          setNotice('This set is limited to 200 tracks.');
          return;
        }

        planner.edit((current) => insertSetTrack(current, track, index));
      }
    } catch {
      setNotice('This item could not be added. Choose a library track.');
    }
  };

  const dragOver = (event, index) => {
    if (busy) return;
    if (
      event.dataTransfer.types.some((type) =>
        [
          'application/resonance-set-item',
          'application/resonance-track',
        ].includes(type),
      )
    ) {
      event.preventDefault();
      setOver(index);
    }
  };

  return (
    <section
      aria-label="Set Planner"
      className="set-planner library-workspace"
    >
      <header className="workspace-heading">
        <div>
          <span className="set-eyebrow">
            <Route size={13} /> Set workspace
          </span>
          <h2>Shape your next set</h2>
          <p>Build the order. Hear the handovers. Take it to the booth.</p>
        </div>
        <div className="set-heading-actions">
          <button
            className="jb-btn set-primary"
            disabled={busy || planner.loading || !plan || plan.items.length < 2}
            onClick={() =>
              swallow(
                perform('rehearse', async () => {
                  const saved = await planner.flush(true);
                  preview.openSet(saved);
                }),
              )
            }
            type="button"
          >
            <Headphones size={14} /> Rehearse set
          </button>
          <button
            className="jb-btn"
            disabled={busy || planner.loading || !plan}
            onClick={() => swallow(perform('new', () => planner.create()))}
            type="button"
          >
            <Plus size={14} /> New set
          </button>
        </div>
      </header>
      {planner.loading && <p role="status">Loading your sets…</p>}
      {planner.error && (
        <div
          className="set-error"
          role="alert"
        >
          <span>{planner.error}</span>
          <div>
            <button
              className="jb-btn"
              disabled={busy || planner.saving}
              onClick={() =>
                swallow(plan ? planner.retry() : planner.activate())
              }
              type="button"
            >
              Retry save
            </button>
            {plan && (
              <>
                <button
                  className="jb-btn"
                  disabled={busy || planner.saving}
                  onClick={() => swallow(perform('copy', () => planner.copy()))}
                  type="button"
                >
                  Save a new copy
                </button>
                <button
                  className="jb-btn"
                  disabled={busy || planner.saving}
                  onClick={() =>
                    swallow(perform('reload', () => planner.reload()))
                  }
                  type="button"
                >
                  Reload saved version
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {planner.recoveryWarning && (
        <p role="alert">
          The browser could not keep a recovery draft. Use Save now before
          leaving this page.
        </p>
      )}
      {plan && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            swallow(planner.retry());
          }}
          ref={formRef}
        >
          <div className="set-control-bar">
            <label>
              Saved sets
              <select
                aria-label="Saved sets"
                disabled={busy || planner.saving}
                onChange={(e) =>
                  swallow(
                    perform('select', () => planner.select(e.target.value)),
                  )
                }
                value={plan.id || ''}
              >
                <option
                  disabled
                  value=""
                >
                  New draft
                </option>
                {planner.sets
                  .filter((set) => !set.archived)
                  .map((set) => (
                    <option
                      key={set.id}
                      value={set.id}
                    >
                      {set.name} · {set.items.length} tracks
                    </option>
                  ))}
              </select>
            </label>
            <label className="set-name-field">
              Set name
              <input
                aria-label="Set name"
                disabled={busy}
                maxLength={80}
                onChange={(e) => planner.edit({ name: e.target.value })}
                required
                value={plan.name}
              />
            </label>
            <span
              className="set-save-state"
              role="status"
            >
              {planner.saving ? (
                <>
                  <Loader2
                    className="set-spin"
                    size={13}
                  />{' '}
                  Saving…
                </>
              ) : planner.dirty ? (
                'Changes waiting to save'
              ) : plan.id ? (
                <>
                  <Check size={13} /> All changes saved
                </>
              ) : (
                'New draft'
              )}
            </span>
            <button
              className="jb-btn"
              disabled={
                busy ||
                planner.saving ||
                !validSet(plan) ||
                (!planner.dirty && Boolean(plan.id))
              }
              type="submit"
            >
              <Save size={13} /> Save now
            </button>
          </div>
          <div className="set-overview">
            <div className="set-stat">
              <span>Running order</span>
              <strong>
                {plan.items.length}
                <small> / 200 tracks</small>
              </strong>
            </div>
            <div className="set-stat">
              <span>Estimated playing time</span>
              <strong>
                {overview.unknownDurations
                  ? 'Incomplete'
                  : `~${formatSeconds(overview.total)}`}
              </strong>
              <small>
                {formatSeconds(overview.knownMusic)} source music
                {overview.provisional
                  ? ' · timing provisional'
                  : ' · overlaps included'}
              </small>
            </div>
            <div className="set-stat">
              <span>Set master</span>
              <strong>
                {overview.rows[0]?.master || '—'}
                <small> BPM</small>
              </strong>
              <small>
                {plan.initialMasterBpm
                  ? 'Custom tempo'
                  : 'One tempo from first track to last'}
              </small>
            </div>
            <div className="set-stat">
              <span>Handovers to check</span>
              <strong>
                {overview.attention}
                <small> / {overview.transitions.length}</small>
              </strong>
              <small>Guidance from saved analysis</small>
            </div>
          </div>
          <div className="set-plan-settings">
            <label>
              Set master
              <select
                aria-label="Set initial master source"
                disabled={busy}
                onChange={(e) =>
                  planner.edit({
                    initialMasterBpm:
                      e.target.value === 'first'
                        ? null
                        : overview.rows[0]?.master || 128,
                  })
                }
                value={plan.initialMasterBpm === null ? 'first' : 'custom'}
              >
                <option value="first">First track</option>
                <option value="custom">Custom BPM</option>
              </select>
            </label>
            {plan.initialMasterBpm !== null && (
              <label>
                Master BPM
                <TempoField
                  disabled={busy}
                  label="Set initial master BPM"
                  onChange={(value) =>
                    planner.edit({ initialMasterBpm: value })
                  }
                  value={plan.initialMasterBpm}
                />
              </label>
            )}
            <label>
              Handover length
              <select
                aria-label="Set handover length"
                disabled={busy}
                onChange={(e) => planner.edit({ bars: Number(e.target.value) })}
                value={plan.bars}
              >
                <option value="8">8 bars</option>
                <option value="16">16 bars</option>
                <option value="32">32 bars</option>
              </select>
            </label>
            <label className="set-range">
              <input
                checked={plan.extendedTempo}
                disabled={busy}
                onChange={(e) =>
                  planner.edit({ extendedTempo: e.target.checked })
                }
                type="checkbox"
              />{' '}
              Extend preview range ±8% → ±25%
            </label>
            <span>Saved track BPM and key stay unchanged.</span>
          </div>
          {plan.items.length > 0 && <TempoJourney overview={overview} />}
          <div className="set-planner-body">
            <SetSource
              busy={busy || plan.items.length >= MAX_SET_TRACKS}
              onAdd={add}
              used={new Set(plan.items.map((item) => item.path))}
            />
            <div className="set-order">
              <header>
                <div>
                  <h3>Your running order</h3>
                  <p>
                    Drag to reorder · first track sets the default master · one
                    fixed master throughout
                  </p>
                </div>
                {undo && (
                  <button
                    className="jb-btn"
                    disabled={
                      busy ||
                      plan.items.length >= MAX_SET_TRACKS ||
                      plan.items.some((item) => item.path === undo.item.path)
                    }
                    onClick={() => {
                      planner.edit((current) => {
                        const items = [...current.items];
                        items.splice(
                          Math.min(undo.index, items.length),
                          0,
                          undo.item,
                        );
                        items[0] = { ...items[0], masterBpm: null };
                        return { ...current, items };
                      });
                      setUndo(null);
                      setNotice('Track restored to the set.');
                    }}
                    type="button"
                  >
                    <Undo2 size={13} /> Undo remove
                  </button>
                )}
              </header>
              {/* Track drops are non-destructive references, and buttons provide keyboard reordering. */}
              <ol
                aria-label="Set running order"
                className="set-order-list"
                onDragOver={(e) => dragOver(e, plan.items.length)}
                onDrop={(e) => drop(e, plan.items.length)}
              >
                {overview.rows.map((row, i) => {
                  const track = row.data?.track || { path: row.path };
                  const transition = overview.transitions[i];
                  return (
                    <li
                      className={`set-order-item${over === i ? ' is-drop-target' : ''}`}
                      key={row.path}
                      onDragLeave={() => setOver(null)}
                      onDragOver={(e) => {
                        e.stopPropagation();
                        dragOver(e, i);
                      }}
                      onDrop={(e) => drop(e, i)}
                    >
                      <div className="set-row-main">
                        <button
                          aria-label={`Drag ${titleOf(track)}; Alt and arrow keys to reorder`}
                          className="set-drag-handle"
                          disabled={busy}
                          draggable={!busy}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              'application/resonance-set-item',
                              JSON.stringify({
                                setId: plan.id,
                                path: row.path,
                              }),
                            );
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onKeyDown={(e) => {
                            if (
                              e.altKey &&
                              ['ArrowUp', 'ArrowDown'].includes(e.key)
                            ) {
                              e.preventDefault();
                              planner.edit((current) =>
                                moveSetTrack(
                                  current,
                                  i,
                                  i + (e.key === 'ArrowUp' ? -1 : 1),
                                ),
                              );
                            }
                          }}
                          title="Drag to reorder, or use Alt + Up/Down"
                          type="button"
                        >
                          <GripVertical size={14} />
                          <span>{i + 1}</span>
                        </button>
                        <div className="set-row-art">
                          <AlbumArt
                            hasArtwork={track.hasArtwork}
                            name={track.album || track.artist || titleOf(track)}
                            path={row.path}
                            size={40}
                          />
                        </div>
                        <div className="set-row-title">
                          <strong title={titleOf(track)}>
                            {titleOf(track)}
                          </strong>
                          <span>
                            {track.artist ||
                              (row.data?.missing
                                ? 'Track is no longer in the library'
                                : row.data?.loading
                                  ? 'Loading track details…'
                                  : 'Unknown artist')}
                          </span>
                          <small>
                            {track.bpm || '—'} BPM ·{' '}
                            {track.key || 'Key unknown'} ·{' '}
                            {formatSeconds(mixDuration(row.data))}
                            {row.data?.error ? ` · ${row.data.error}` : ''}
                          </small>
                        </div>
                        <div className="set-row-tempo">
                          <span>Set master</span>
                          <strong>{row.master || '—'} BPM</strong>
                          <span>Fixed for the whole set</span>
                          <small>~{formatSeconds(row.start)} into set</small>
                        </div>
                        <div className="set-row-actions">
                          <button
                            aria-label={`Move ${titleOf(track)} up`}
                            className="set-icon-button"
                            disabled={busy || i === 0}
                            onClick={() =>
                              planner.edit((current) =>
                                moveSetTrack(current, i, i - 1),
                              )
                            }
                            type="button"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            aria-label={`Move ${titleOf(track)} down`}
                            className="set-icon-button"
                            disabled={busy || i === plan.items.length - 1}
                            onClick={() =>
                              planner.edit((current) =>
                                moveSetTrack(current, i, i + 1),
                              )
                            }
                            type="button"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            aria-label={`Remove ${titleOf(track)} from set`}
                            className="set-icon-button"
                            disabled={busy}
                            onClick={() => remove(row, i)}
                            type="button"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <details className="set-track-note">
                        <summary>
                          {row.note
                            ? 'Performance note added'
                            : 'Add a performance note'}
                        </summary>
                        <input
                          aria-label={`Performance note for ${titleOf(track)}`}
                          disabled={busy}
                          maxLength={240}
                          onChange={(e) =>
                            planner.edit((current) => ({
                              ...current,
                              items: current.items.map((item, index) =>
                                index === i
                                  ? { ...item, note: e.target.value }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="For example: long blend, swap bass at the drop…"
                          value={row.note || ''}
                        />
                      </details>
                      {transition && (
                        <div
                          className={`set-transition${transition.messages.some((message) => message.kind === 'attention') ? ' needs-care' : ''}`}
                        >
                          <div>
                            <span className="set-transition-heading">
                              <ArrowRight size={13} /> Into track {i + 2} ·{' '}
                              {row.master || '—'} BPM master · {plan.bars} bars
                            </span>
                            <div className="set-transition-chips">
                              {transition.messages.length ? (
                                transition.messages
                                  .filter(
                                    (message) => message.group !== 'genre',
                                  )
                                  .map((message) => (
                                    <span
                                      className={`is-${message.kind}`}
                                      key={message.text}
                                    >
                                      {message.text}
                                    </span>
                                  ))
                              ) : (
                                <span>
                                  Tempo and key fit · no vocal clash predicted
                                </span>
                              )}
                            </div>
                            <GenreWarning
                              comparison={transition.comparison.genre}
                            />
                            {transition.comparison.tempo.alternative && (
                              <small>
                                Half/double-time reading is a rhythmic
                                alternative; no automatic speed doubling.
                              </small>
                            )}
                          </div>
                          <button
                            aria-label={`Preview handover ${i + 1} to ${i + 2}`}
                            className="jb-btn"
                            disabled={
                              busy ||
                              !row.master ||
                              transition.missing ||
                              !row.data?.track ||
                              !overview.rows[i + 1].data?.track
                            }
                            onClick={() =>
                              preview.open(
                                row.data.track,
                                overview.rows[i + 1].data.track,
                                {
                                  masterBpm: row.master,
                                  bars: plan.bars,
                                  extendedTempo: plan.extendedTempo,
                                },
                              )
                            }
                            type="button"
                          >
                            <Headphones size={13} /> Preview
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              {!plan.items.length && (
                <div
                  className="set-empty"
                  onDragOver={(e) => dragOver(e, 0)}
                  onDrop={(e) => drop(e, 0)}
                >
                  <Route size={32} />
                  <h3>Every set starts with one track</h3>
                  <p>
                    Choose your opener on the left. It becomes the master tempo,
                    then build the journey around it.
                  </p>
                </div>
              )}
              <p className="set-footnote">
                <Clock size={13} /> Playing time is estimated from saved track
                durations, planned tempos and supported overlaps. Preview
                changes are temporary; choose the fixed set master above.
              </p>
            </div>
          </div>
          <details className="set-notes">
            <summary>Set notes</summary>
            <textarea
              aria-label="Set notes"
              disabled={busy}
              maxLength={2_000}
              onChange={(e) => planner.edit({ notes: e.target.value })}
              placeholder="The room, the mood, moments to leave space…"
              rows="3"
              value={plan.notes}
            />
          </details>
          <footer className="set-finish">
            <div>
              <strong>Ready for the next step?</strong>
              <p>
                Mixtapes and USB preserve your order. The fixed master and fades
                remain rehearsal settings.
              </p>
            </div>
            <div className="set-finish-actions">
              <button
                className="jb-btn"
                disabled={
                  busy ||
                  !plan.items.length ||
                  overview.rows.some(
                    (row) => !row.data?.track || row.data.missing,
                  )
                }
                onClick={() => {
                  void perform('mixtape', async () => {
                    const saved = await planner.flush(true);
                    if (
                      !snapshotRequest.current ||
                      snapshotRequest.current.planId !== saved.id ||
                      snapshotRequest.current.revision !== saved.revision ||
                      snapshotRequest.current.done
                    )
                      snapshotRequest.current = {
                        planId: saved.id,
                        revision: saved.revision,
                        token: uuidv4().replaceAll('-', ''),
                      };
                    const request = snapshotRequest.current;
                    const result = await setMixtape(saved, request.token);
                    request.done = true;
                    setSnapshot(result);
                    setNotice(
                      `Mixtape “${result.name}” is ready with ${result.count} tracks in set order.`,
                    );
                  });
                }}
                type="button"
              >
                <ListMusic size={14} />{' '}
                {action === 'mixtape' ? 'Saving mixtape…' : 'Save as mixtape'}
              </button>
              <button
                className="jb-btn set-primary"
                disabled={
                  busy ||
                  !plan.items.length ||
                  overview.rows.some(
                    (row) => !row.data?.track || row.data.missing,
                  )
                }
                onClick={() => {
                  void perform('export', async () => {
                    const saved = await planner.flush(true);
                    onExport(
                      saved.items.map((item) => item.path),
                      saved.name,
                    );
                  });
                }}
                type="button"
              >
                <Usb size={14} /> Export set
              </button>
            </div>
          </footer>
          {snapshot && (
            <button
              className="jb-btn"
              onClick={() => onMixtape(snapshot.id)}
              type="button"
            >
              Open “{snapshot.name}” mixtape <ArrowRight size={13} />
            </button>
          )}
          <div
            aria-live="polite"
            className="set-notice"
          >
            {notice}
          </div>
          <details className="set-management">
            <summary>Manage sets</summary>
            <button
              className="jb-btn"
              disabled={busy || planner.saving || !validSet(plan)}
              onClick={() => swallow(perform('copy', () => planner.copy()))}
              type="button"
            >
              <Copy size={13} /> Save a copy
            </button>
            <button
              className="jb-btn"
              disabled={busy || planner.saving || !plan.id}
              onClick={() =>
                swallow(perform('archive', () => planner.archive(plan, true)))
              }
              type="button"
            >
              <Archive size={13} /> Archive this set
            </button>
            <div>
              {planner.sets
                .filter((set) => set.archived)
                .map((set) => (
                  <p key={set.id}>
                    <span>
                      {set.name} · {set.items.length} tracks
                    </span>
                    <button
                      className="jb-btn"
                      disabled={busy || planner.saving}
                      onClick={() =>
                        swallow(
                          perform('restore', () => planner.archive(set, false)),
                        )
                      }
                      type="button"
                    >
                      <RefreshCw size={12} /> Restore {set.name}
                    </button>
                  </p>
                ))}
            </div>
          </details>
        </form>
      )}
    </section>
  );
};

export default SetPlannerView;
