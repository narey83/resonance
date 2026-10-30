import '../LibraryWorkspace.css';
import { useLibraryActivity } from '../../../context/LibraryActivityContext';
import { MAX_QUEUE } from '../../../context/PlayerContext';
import useDebounce from '../../../hooks/useDebounce';
import { CAMELOT_KEYS, harmonicNeighbours } from '../../../lib/camelot';
import {
  crateRuleLabels,
  deleteCrate,
  formRules,
  getCratePage,
  getCrates,
  previewCrate,
  saveCrate,
  workspaceError,
} from '../../../lib/libraryWorkspace';
import { getFolders } from '../../../lib/musicLibrary';
import { usePagedList } from '../../../lib/usePagedList';
import TrackTable from './TrackTable';
import {
  ArrowLeft,
  ArrowUpRight,
  Copy,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const fieldDefaults = {
  bpmMin: '',
  bpmMax: '',
  key: '',
  genre: '',
  energy: '',
  vocals: '',
  analysis: '',
  folder: '',
  addedWithinDays: '',
  notPlayedWithinDays: '',
  neverPlayed: false,
  lovedOnly: false,
};
const inferKey = (keys) =>
  CAMELOT_KEYS.find(({ standard }) => {
    const neighbours = [...harmonicNeighbours(standard)].sort();
    return (
      JSON.stringify(neighbours) === JSON.stringify([...(keys || [])].sort())
    );
  })?.standard || '';

export const CrateEditor = ({ crate, onCancel, onSaved }) => {
  const [name, setName] = useState(crate?.name || '');
  const [description, setDescription] = useState(crate?.description || '');
  const [form, setForm] = useState(() => ({
    ...fieldDefaults,
    ...Object.fromEntries(
      Object.entries(crate?.rules || {}).filter(([, value]) => value !== null),
    ),
    key: inferKey(crate?.rules?.keys),
  }));
  const [folders, setFolders] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(true);
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  const rules = useMemo(() => formRules(form), [form]);
  const query = useDebounce(rules, 350);
  const latestRules = useRef(rules);
  latestRules.current = rules;
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(
      crate?.rules?.energy ||
        crate?.rules?.addedWithinDays ||
        crate?.rules?.notPlayedWithinDays ||
        crate?.rules?.neverPlayed ||
        crate?.rules?.lovedOnly ||
        crate?.rules?.folder,
    ),
  );
  useEffect(() => {
    nameRef.current?.focus();
    getFolders()
      .then(setFolders)
      .catch(() => {});
  }, []);
  useEffect(() => {
    setPreviewing(true);
  }, [rules]);
  useEffect(() => {
    let cancelled = false;
    previewCrate(query)
      .then((next) => {
        if (!cancelled && query === latestRules.current) {
          setPreview(next);
          setPreviewError('');
        }
      })
      .catch((error_) => {
        if (!cancelled && query === latestRules.current) {
          setPreview(null);
          setPreviewError(workspaceError(error_));
        }
      })
      .finally(() => {
        if (!cancelled && query === latestRules.current) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);
  const change = (key, value) =>
    setForm((previous) => ({
      ...previous,
      [key]: value,
      ...(key === 'key' ? { keys: null } : {}),
    }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = await saveCrate({
        id: crate?.id,
        revision: crate?.revision || 0,
        name,
        description,
        rules,
      });
      onSaved(saved);
    } catch (error_) {
      setError(workspaceError(error_));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="library-workspace">
      <button
        className="workspace-back"
        onClick={onCancel}
        type="button"
      >
        <ArrowLeft size={16} /> Smart crates
      </button>
      <header className="workspace-heading">
        <div>
          <span className="workspace-eyebrow">Make room for discovery</span>
          <h2>{crate?.id ? 'Edit smart crate' : 'Create a smart crate'}</h2>
          <p>Set the rules once. Resonance keeps the tracks up to date.</p>
        </div>
      </header>
      <form
        aria-label="Smart crate rules"
        className="crate-editor"
        onSubmit={submit}
      >
        <div className="crate-editor-actions">
          <span
            aria-live="polite"
            className="crate-match-count"
          >
            {previewing
              ? 'Checking matches…'
              : previewError
                ? 'Check your rules'
                : `${preview?.total ?? 0} matching ${preview?.total === 1 ? 'track' : 'tracks'}`}
          </span>
          {error && (
            <p
              className="workspace-error"
              role="alert"
            >
              {error}
            </p>
          )}
          <div className="workspace-actions">
            <button
              className="jb-btn jb-btn--primary"
              disabled={saving || !name.trim() || Boolean(previewError)}
              type="submit"
            >
              {saving ? 'Saving…' : 'Save smart crate'}
            </button>
            <button
              className="jb-btn"
              disabled={saving}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="crate-editor-fields">
          <label>
            Crate name
            <input
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Late-night discoveries"
              ref={nameRef}
              required
              value={name}
            />
          </label>
          <label>
            Description <span>Optional</span>
            <input
              maxLength={200}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A reminder of the sound you are looking for"
              value={description}
            />
          </label>
          <div className="workspace-section-label">
            Match all of these rules
          </div>
          <div className="crate-rule-grid">
            <label>
              BPM from
              <input
                max={400}
                min={20}
                onChange={(e) => change('bpmMin', e.target.value)}
                placeholder="Any"
                step="0.1"
                type="number"
                value={form.bpmMin}
              />
            </label>
            <label>
              BPM to
              <input
                max={400}
                min={20}
                onChange={(e) => change('bpmMax', e.target.value)}
                placeholder="Any"
                step="0.1"
                type="number"
                value={form.bpmMax}
              />
            </label>
            <label>
              Compatible with key
              <select
                onChange={(e) => change('key', e.target.value)}
                value={form.key}
              >
                <option value="">Any key</option>
                {CAMELOT_KEYS.map((key) => (
                  <option
                    key={key.camelot}
                    value={key.standard}
                  >
                    {key.standard} · {key.camelot}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Genre
              <input
                maxLength={100}
                onChange={(e) => change('genre', e.target.value)}
                placeholder="Any tag or predicted genre"
                value={form.genre}
              />
            </label>
            <label>
              Voice prediction
              <select
                onChange={(e) => change('vocals', e.target.value)}
                value={form.vocals}
              >
                <option value="">Any</option>
                <option value="yes">Voice detected</option>
                <option value="no">No voice detected</option>
              </select>
            </label>
            <label>
              Analysis
              <select
                onChange={(e) => change('analysis', e.target.value)}
                value={form.analysis}
              >
                <option value="">Any stage</option>
                <option value="enhanced">Enhanced analysis available</option>
                <option value="pending">Enhanced analysis pending</option>
                <option value="incomplete">Basic analysis incomplete</option>
              </select>
            </label>
          </div>
          <details
            className="crate-extra-rules"
            onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
            open={advancedOpen}
          >
            <summary>
              More rules <span>Dates, history, folders and RMS energy</span>
            </summary>
            <div className="crate-rule-grid">
              <label>
                RMS energy
                <select
                  onChange={(e) => change('energy', e.target.value)}
                  value={form.energy}
                >
                  <option value="">Any energy</option>
                  <option value="low">Low · below 0.15 RMS</option>
                  <option value="medium">Medium · 0.15–0.30 RMS</option>
                  <option value="high">High · 0.30 RMS and above</option>
                </select>
                <small>
                  A loudness measure, rather than a musical energy rating.
                </small>
              </label>
              <label>
                Added within days
                <input
                  max={3_650}
                  min={1}
                  onChange={(e) => change('addedWithinDays', e.target.value)}
                  placeholder="Any time"
                  type="number"
                  value={form.addedWithinDays}
                />
              </label>
              <label>
                Not played within days
                <input
                  disabled={form.neverPlayed}
                  max={3_650}
                  min={1}
                  onChange={(e) =>
                    change('notPlayedWithinDays', e.target.value)
                  }
                  placeholder="Any time"
                  type="number"
                  value={form.notPlayedWithinDays}
                />
              </label>
              <label className="crate-folder-rule">
                Inside folder
                <select
                  onChange={(e) => change('folder', e.target.value)}
                  value={form.folder}
                >
                  <option value="">Entire library</option>
                  {folders.map((folder) => (
                    <option
                      key={folder.path}
                      value={folder.path}
                    >
                      {folder.name}
                    </option>
                  ))}
                </select>
                <small>Includes tracks in its subfolders.</small>
              </label>
            </div>
            <div className="crate-checkboxes">
              <label>
                <input
                  checked={form.neverPlayed}
                  onChange={(e) => change('neverPlayed', e.target.checked)}
                  type="checkbox"
                />{' '}
                Never played by me
              </label>
              <label>
                <input
                  checked={form.lovedOnly}
                  onChange={(e) => change('lovedOnly', e.target.checked)}
                  type="checkbox"
                />{' '}
                Only tracks I love
              </label>
            </div>
          </details>
        </div>
        <aside
          aria-label="Matching tracks preview"
          className="crate-preview"
        >
          <span className="workspace-eyebrow">Live preview</span>
          <strong aria-live="polite">
            {previewing ? 'Checking…' : `${preview?.total ?? 0} tracks`}
          </strong>
          <p>
            Membership updates as tracks, analysis and your play history change.
          </p>
          {previewError ? (
            <p
              className="workspace-error"
              role="alert"
            >
              {previewError}
            </p>
          ) : (
            <ul>
              {preview?.tracks?.map((track) => (
                <li key={track.path}>
                  <b>{track.title || track.filename}</b>
                  <span>{track.artist || 'Unknown artist'}</span>
                </li>
              ))}
            </ul>
          )}
          {!previewing && preview?.total === 0 && (
            <p>
              No matches yet. New matching tracks will appear automatically.
            </p>
          )}
          <small>
            Unknown analysis values are excluded from rules that need them.
            Predictions are guides for discovery.
          </small>
        </aside>
      </form>
    </section>
  );
};

export const CrateTracks = ({ crate, onBack, onEdit, ...trackActions }) => {
  const activity = useLibraryActivity();
  const [sort, setSort] = useState({ col: 'title', dir: 'asc' });
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  const [playbackError, setPlaybackError] = useState('');
  const playbackRequestRef = useRef(0);
  const search = useDebounce(filter, 250);
  useEffect(
    () => setRevision((n) => n + 1),
    [activity?.libraryRevision, activity?.lovedPaths, activity?.playStats],
  );
  useEffect(() => {
    const timer = setInterval(() => setRevision((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const query = useMemo(
    () => ({
      crateId: crate.id,
      revision: crate.revision,
      search,
      sort: sort.col,
      descending: sort.dir === 'desc',
    }),
    [crate.id, crate.revision, search, sort],
  );
  const page = usePagedList(getCratePage, query, {
    pageSize: 100,
    refreshToken: revision,
  });
  useEffect(
    () => () => {
      playbackRequestRef.current++;
    },
    [query],
  );
  const resolvePlaybackQueue = async (track, index) => {
    const request = ++playbackRequestRef.current;
    setPlaybackError('');
    try {
      const result = await getCratePage({
        ...query,
        limit: MAX_QUEUE,
        offset: Math.max(0, index - 50),
      });
      if (request !== playbackRequestRef.current) return null;
      const selectedIndex = result.items.findIndex(
        (item) => item.path === track.path,
      );
      if (selectedIndex < 0) {
        setPlaybackError(
          'This track is no longer in this crate. Refresh and try again.',
        );
        return null;
      }

      return { tracks: result.items, index: selectedIndex };
    } catch {
      if (request === playbackRequestRef.current)
        setPlaybackError(
          'Could not load the crate playback queue. Please try again.',
        );
      return null;
    }
  };

  return (
    <div className="crate-track-view">
      <header className="library-workspace workspace-detail-heading">
        <button
          className="workspace-back"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={16} /> All smart crates
        </button>
        <div className="workspace-heading">
          <div>
            <span className="workspace-eyebrow">
              Smart crate · updates automatically
            </span>
            <h2>{crate.name}</h2>
            <p>
              {crate.description || 'Your collection, organised by its rules.'}
            </p>
          </div>
          <button
            className="jb-btn"
            onClick={onEdit}
            type="button"
          >
            {crate.starter ? <Copy size={15} /> : <Pencil size={15} />}
            {crate.starter ? 'Make a copy' : 'Edit rules'}
          </button>
        </div>
        <div className="workspace-rule-chips">
          {crateRuleLabels(crate.rules).map((label) => (
            <span key={label}>{label}</span>
          ))}
          <b>{page.total} tracks</b>
        </div>
      </header>
      {(page.error || playbackError) && (
        <p
          className="workspace-error"
          role="alert"
        >
          {playbackError ||
            'Could not load this crate. Reopen it to try again.'}
        </p>
      )}
      <TrackTable
        {...trackActions}
        loading={page.loading}
        loadingMore={page.loadingMore}
        onEndReached={() => page.loadMore()}
        resolvePlaybackQueue={resolvePlaybackQueue}
        serverFilter={{ value: filter, onChange: setFilter }}
        serverSort={{ ...sort, onChange: (col, dir) => setSort({ col, dir }) }}
        tracks={page.items}
      />
    </div>
  );
};

const SmartCratesView = (trackActions) => {
  const activity = useLibraryActivity();
  const [crates, setCrates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [collection, setCollection] = useState('All');
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async () => {
      try {
        const next = await getCrates();
        if (!cancelled) {
          setCrates(next);
          setError('');
        }
      } catch (error_) {
        if (!cancelled) setError(workspaceError(error_));
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(load, 30_000);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    revision,
    activity?.libraryRevision,
    activity?.playStats,
    activity?.lovedPaths,
  ]);
  const remove = async (crate) => {
    try {
      await deleteCrate(crate);
      setDeleting(null);
      refresh();
    } catch (error_) {
      setError(workspaceError(error_));
    }
  };

  if (editor)
    return (
      <CrateEditor
        crate={editor}
        onCancel={() => setEditor(null)}
        onSaved={(crate) => {
          setCrates((previous) => [
            ...previous.filter((row) => row.id !== crate.id),
            crate,
          ]);
          setSelectedId(crate.id);
          setEditor(null);
          refresh();
        }}
      />
    );
  const selected = crates.find((crate) => crate.id === selectedId);
  if (selected)
    return (
      <CrateTracks
        {...trackActions}
        crate={selected}
        key={selected.id}
        onBack={() => setSelectedId(null)}
        onEdit={() =>
          setEditor(
            selected.starter
              ? { ...selected, id: null, name: `${selected.name} copy` }
              : selected,
          )
        }
      />
    );
  return (
    <section className="library-workspace">
      <header className="workspace-heading">
        <div>
          <span className="workspace-eyebrow">
            <Sparkles size={13} /> Always finding your next track
          </span>
          <h2>Smart crates</h2>
          <p>
            Living collections that follow your sound. Choose a crate and start
            exploring.
          </p>
        </div>
        <button
          className="jb-btn jb-btn--primary"
          onClick={() => setEditor({})}
          type="button"
        >
          <Plus size={16} /> New smart crate
        </button>
      </header>
      <div className="workspace-notice">
        <RefreshCw size={16} />
        <span>
          Tracks join and leave automatically when they match your rules.
        </span>
        <span className="workspace-notice-tag">Live collections</span>
      </div>
      {error && (
        <div
          className="workspace-error"
          role="alert"
        >
          {error}
          <button
            className="jb-btn"
            onClick={refresh}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {loading && <p role="status">Loading your crates…</p>}
      <div
        aria-label="Crate collections"
        className="crate-editor-actions"
      >
        {['All', 'Genre', 'Key', 'BPM', 'Saved'].map((group) => (
          <button
            aria-pressed={collection === group}
            className={`jb-btn${collection === group ? ' jb-btn--primary' : ''}`}
            key={group}
            onClick={() => setCollection(group)}
            type="button"
          >
            {group}
          </button>
        ))}
      </div>
      {!loading &&
        !error &&
        !crates.some(
          (crate) =>
            collection === 'All' ||
            (collection === 'Saved'
              ? !crate.collection
              : crate.collection === collection),
        ) && (
          <p role="status">
            No matching collections yet. Analyse tracks to populate Genre, Key
            and BPM.
          </p>
        )}
      <div className="smart-crate-grid">
        {crates
          .filter(
            (crate) =>
              collection === 'All' ||
              (collection === 'Saved'
                ? !crate.collection
                : crate.collection === collection),
          )
          .map((crate) => (
            <article
              className="smart-crate-card"
              key={crate.id}
            >
              <button
                aria-label={`Open ${crate.name}`}
                className="smart-crate-open"
                onClick={() => setSelectedId(crate.id)}
                type="button"
              >
                <div className="smart-crate-top">
                  <span className="smart-crate-icon">
                    <Layers3 size={22} />
                  </span>
                  <span>{crate.trackCount ?? '—'} tracks</span>
                  <ArrowUpRight size={17} />
                </div>
                <h3>{crate.name}</h3>
                <p>
                  {crate.description || 'A collection shaped by your rules.'}
                </p>
                <div className="workspace-rule-chips">
                  {crateRuleLabels(crate.rules)
                    .slice(0, 3)
                    .map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                </div>
              </button>
              <footer>
                <span>
                  {crate.collection
                    ? `Automatic ${crate.collection} collection`
                    : crate.starter
                      ? 'Starter crate'
                      : 'Your smart crate'}
                </span>
                <button
                  aria-label={`${crate.starter ? 'Duplicate' : 'Edit'} ${crate.name}`}
                  onClick={() =>
                    setEditor(
                      crate.starter
                        ? { ...crate, id: null, name: `${crate.name} copy` }
                        : crate,
                    )
                  }
                  type="button"
                >
                  {crate.starter ? <Copy size={14} /> : <Pencil size={14} />}
                  {crate.starter ? 'Make a copy' : 'Edit'}
                </button>
                {!crate.starter && (
                  <button
                    aria-label={`Delete ${crate.name}`}
                    onClick={() => setDeleting(crate.id)}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </footer>
              {deleting === crate.id && (
                <div className="crate-delete-confirm">
                  <p>Delete this crate? Its tracks stay in your library.</p>
                  <button
                    className="jb-btn"
                    onClick={() => remove(crate)}
                    type="button"
                  >
                    Delete crate
                  </button>
                  <button
                    aria-label="Cancel deletion"
                    className="jb-btn"
                    onClick={() => setDeleting(null)}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </article>
          ))}
      </div>
      <div className="workspace-footnote">
        <Layers3 size={17} />
        <span>
          Smart crates are saved rules. Playlists keep the exact tracks and
          order you choose.
        </span>
      </div>
    </section>
  );
};

export default SmartCratesView;
