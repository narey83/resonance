import './ExportPage.css';
import { urlBase } from '../../config';
import api from '../../lib/api';
import * as mixtapes from '../../lib/mixtapes';
import UsbExportInspector from '../TrackAnalysis/UsbExportInspector';
import UsbExportPanel from '../TrackAnalysis/UsbExportPanel';
import ExportSourcePicker from './ExportSourcePicker';
import { FolderOpen, Layers3, ListMusic, Plus, Save } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useHistory } from 'react-router-dom';

const sourceOptions = [
  [
    'playlist',
    'Saved playlist',
    'Export a playlist with its saved name and track order.',
  ],
  [
    'create',
    'Create a playlist first',
    'Build and arrange a reusable playlist in your Library before exporting.',
  ],
  [
    'smart-crate',
    'Smart crate',
    'Export a snapshot of the tracks currently matching your crate’s rules.',
  ],
  [
    'folder',
    'Quick folder export',
    'Export a whole music folder, including subfolders, without creating a saved playlist.',
  ],
  [
    'saved-list',
    'Saved export list',
    'Make a fresh USB export from a previous track list and player choice.',
  ],
];
const sourceIcons = {
  playlist: ListMusic,
  create: Plus,
  'smart-crate': Layers3,
  folder: FolderOpen,
  'saved-list': Save,
};
const failure = (error) =>
  typeof error?.response?.data === 'string'
    ? error.response.data
    : 'Could not load the export source. Please retry.';
const ExportPage = () => {
  const history = useHistory();
  const [kind, setKind] = useState('playlist');
  const [sourceId, setSourceId] = useState('');
  const [sources, setSources] = useState({
    playlists: [],
    crates: [],
    folders: [],
    savedLists: [],
  });
  const [selection, setSelection] = useState(null);
  const [resume, setResume] = useState(() =>
    /^[\da-f]{32}$/i.test(
      new URLSearchParams(window.location.search).get('exportJob') || '',
    ),
  );
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [latestJob, setLatestJob] = useState(null);
  useEffect(() => {
    if (latestJob?.status === 'completed') setReload((value) => value + 1);
  }, [latestJob?.jobId, latestJob?.status]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get('/analysis/usb-export/sources')
      .then(({ data }) => {
        if (!cancelled) setSources(data);
      })
      .catch((error_) => {
        if (!cancelled) setError(failure(error_));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);
  const resolve = async () => {
    const chosen = sources.savedLists?.find((item) => item.id === sourceId);
    if (kind === 'saved-list' && chosen?.missingCount) {
      setError(
        `${chosen.missingCount} track(s) in this list are missing or no longer indexed: ${chosen.missingTracks.slice(0, 5).join(', ')}. Restore them before exporting.`,
      );
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(
        '/analysis/usb-export/resolve',
        kind === 'folder' ? { kind, folder: sourceId } : { kind, id: sourceId },
      );
      setSelection(data);
      setResume(false);
    } catch (error_) {
      setError(failure(error_));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const playlist = await mixtapes.create({ name: name.trim() });
      history.push({
        pathname: `${urlBase}/library`,
        state: { libraryNav: { type: 'playlist', id: playlist.id } },
      });
    } catch (error_) {
      setError(failure(error_));
    } finally {
      setBusy(false);
    }
  };

  const deleteSavedList = async () => {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/analysis/usb-export/saved-lists/${sourceId}`);
      setSourceId('');
      setSelection(null);
      setReload((value) => value + 1);
    } catch (error_) {
      setError(failure(error_));
    } finally {
      setBusy(false);
    }
  };

  const options =
    kind === 'playlist'
      ? sources.playlists
      : kind === 'smart-crate'
        ? sources.crates
        : kind === 'saved-list'
          ? sources.savedLists || []
          : sources.folders;
  const selectedSavedList =
    kind === 'saved-list' ? options.find((item) => item.id === sourceId) : null;
  const libraryLink = {
    pathname: `${urlBase}/library`,
    state: {
      libraryNav: {
        type: 'playlist',
        id: kind === 'playlist' ? sourceId || undefined : undefined,
      },
    },
  };
  const finishedExport =
    latestJob?.status === 'completed' && latestJob.downloadAvailable;
  return (
    <main className="export-page">
      <section
        className="export-source"
        hidden={finishedExport}
      >
        <h2>Choose what to export</h2>
        <p className="export-source-intro">
          Take a saved set, a smart crate or a music folder to your players.
        </p>
        <fieldset className="export-source-options">
          <legend>Export source</legend>
          {sourceOptions.map(([value, label, description]) => {
            const Icon = sourceIcons[value];
            return (
              <label
                className={`export-source-card${kind === value ? ' is-selected' : ''}`}
                key={value}
              >
                <input
                  checked={kind === value}
                  disabled={busy}
                  name="export-source"
                  onChange={() => {
                    setKind(value);
                    setSourceId('');
                    setSelection(null);
                    setResume(false);
                    setError('');
                  }}
                  type="radio"
                  value={value}
                />
                <Icon
                  aria-hidden="true"
                  className="export-source-icon"
                  size={21}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
        {loading && <p role="status">Loading export sources…</p>}
        {error && (
          <p role="alert">
            {error}{' '}
            <button
              onClick={() => setReload(reload + 1)}
              type="button"
            >
              Reload sources
            </button>
          </p>
        )}
        <div className="export-source-form">
          {kind === 'create' ? (
            <>
              <p>
                Create your playlist, add tracks and arrange their order in the
                Library. Then return to Export and choose Saved playlist.
              </p>
              <label>
                New playlist name
                <input
                  aria-label="New playlist name"
                  disabled={busy}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </label>
              <p>
                <button
                  className="export-primary-action"
                  disabled={busy || !name.trim()}
                  onClick={create}
                  type="button"
                >
                  Create playlist and add tracks
                </button>
              </p>
            </>
          ) : (
            <>
              <ExportSourcePicker
                disabled={loading || busy}
                kind={kind}
                label={
                  kind === 'playlist'
                    ? 'Saved playlist'
                    : kind === 'smart-crate'
                      ? 'Smart crate'
                      : kind === 'saved-list'
                        ? 'Saved export list'
                        : 'Music folder'
                }
                onChange={(value) => {
                  setSourceId(value);
                  setSelection(null);
                }}
                options={options}
                value={sourceId}
              />
              {kind === 'smart-crate' && (
                <p>
                  Membership is resolved now and saved as a fixed selection for
                  this export. Later rule or library changes affect the next
                  export.
                </p>
              )}
              {kind === 'folder' && (
                <p>
                  Quick export includes every track in the selected folder and
                  its subfolders. The folder name is suggested as the exported
                  playlist name.
                </p>
              )}
              {kind === 'saved-list' && sourceId && (
                <>
                  <p>
                    {selectedSavedList?.missingCount
                      ? `${selectedSavedList.missingCount} missing or no longer indexed: ${selectedSavedList.missingTracks.slice(0, 5).join(', ')}. Restore them before exporting.`
                      : 'Tracks are currently available. Resonance checks again when you review and prepare the export.'}
                  </p>
                  <p>
                    <button
                      disabled={busy}
                      onClick={() => setReload((value) => value + 1)}
                      type="button"
                    >
                      Refresh list status
                    </button>
                  </p>
                  <p>
                    <button
                      disabled={busy}
                      onClick={deleteSavedList}
                      type="button"
                    >
                      Delete saved list
                    </button>
                  </p>
                </>
              )}
              <p>
                <button
                  className="export-primary-action"
                  disabled={
                    !sourceId ||
                    loading ||
                    busy ||
                    Boolean(selectedSavedList?.missingCount)
                  }
                  onClick={resolve}
                  type="button"
                >
                  {busy ? 'Resolving selection…' : 'Review export selection'}
                </button>
              </p>
              {!loading && !options.length && (
                <p>
                  No{' '}
                  {kind === 'playlist'
                    ? 'saved playlists'
                    : kind === 'smart-crate'
                      ? 'smart crates'
                      : kind === 'saved-list'
                        ? 'saved export lists'
                        : 'music folders'}{' '}
                  available.
                </p>
              )}
            </>
          )}
          {(kind === 'playlist' || kind === 'create') && (
            <p className="export-source-library">
              <Link to={libraryLink}>Manage playlists in Library</Link>
            </p>
          )}
        </div>
      </section>
      {selection && (
        <section
          className="export-source-context"
          hidden={finishedExport}
        >
          <h2>{selection.source.name}</h2>
          <p>
            {selection.trackCount} tracks ·{' '}
            {
              sourceOptions.find(
                ([value]) => value === selection.source.kind,
              )?.[1]
            }{' '}
            · Selection captured{' '}
            {new Date(selection.source.resolvedAt).toLocaleString()}
          </p>
          <p>
            {selection.source.kind === 'saved-list'
              ? 'This reusable list preserves the previous track order and player choice. You can adjust the player and playlist name before preparing a fresh export.'
              : 'This export preserves the reviewed selection and order. Edit the source in your Library to change its membership, then select it again.'}
          </p>
        </section>
      )}
      {(selection || resume) && (
        <UsbExportPanel
          initialPaths={selection?.paths || null}
          initialPlayerChoice={
            selection?.playerModel ||
            (selection?.profile === 'legacy' ? 'legacy' : 'mixed')
          }
          initialPlaylistName={selection?.playlistName || 'Resonance'}
          key={selection?.selectionId || 'resume'}
          onJobChange={setLatestJob}
          selectionId={selection?.selectionId || null}
          showInspector={false}
          wizard
        />
      )}
      <section className="export-saved">
        <UsbExportInspector
          latestJob={latestJob}
          onSavedListChange={() => setReload((value) => value + 1)}
        />
      </section>
    </main>
  );
};

export default ExportPage;
