import './UsbExportPanel.css';
import { urlBase } from '../../config';
import * as analysisApi from '../../lib/analysis';
import api from '../../lib/api';
import { requireLocalBridge } from '../../lib/bridgePresence';
import ExportTrackPicker from './ExportTrackPicker';
import UsbExportInspector from './UsbExportInspector';
import React, { useEffect, useMemo, useState } from 'react';

const message = (error) =>
  typeof error?.response?.data === 'string'
    ? error.response.data
    : error?.message || 'Export failed.';
const active = (job) =>
  job && !['completed', 'failed', 'cancelled'].includes(job.status);
const exportStage = {
  queued: 'Waiting to start export…',
  preparing: 'Checking tracks and analysis…',
  exporting: 'Copying supported audio and building player databases…',
  packaging: 'Finalizing the USB export…',
};
const players = {
  mixed: { name: 'OPUS-QUAD + CDJ-3000/2000NXS2', profile: 'dual' },
  legacy: { name: 'Classic players', profile: 'legacy' },
  'opus-quad': { name: 'OPUS-QUAD', profile: 'dual' },
  'cdj-3000x': { name: 'CDJ-3000X', profile: 'dual' },
  'xdj-az': { name: 'XDJ-AZ', profile: 'dual' },
  'cdj-3000': { name: 'CDJ-3000', profile: 'legacy' },
  'cdj-2000nxs2': { name: 'CDJ-2000NXS2', profile: 'legacy' },
};
const shortenPlaylistName = (name) => {
  const shortened = name.slice(0, 100);
  const last = shortened.codePointAt(shortened.length - 1);
  return last >= 0xd8_00 && last <= 0xdb_ff
    ? shortened.slice(0, -1)
    : shortened;
};

const UsbExportPanel = ({
  initialPaths = null,
  initialPlayerChoice = 'mixed',
  initialPlaylistName = 'Resonance',
  onJobChange = null,
  selectionId = null,
  showInspector = true,
  wizard = false,
}) => {
  const [step, setStep] = useState(0);
  const [tracks, setTracks] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [helperPlatforms, setHelperPlatforms] = useState([]);
  const [selected, setSelected] = useState([]);
  const [playlistName, setPlaylistName] = useState(initialPlaylistName);
  const [playlistNameSource, setPlaylistNameSource] = useState('custom');
  const [playerChoice, setPlayerChoice] = useState(
    players[initialPlayerChoice] ? initialPlayerChoice : 'mixed',
  );
  const profile = players[playerChoice].profile;
  const [job, setJob] = useState(null);
  useEffect(() => {
    onJobChange?.(job);
  }, [job, onJobChange]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [startingExport, setStartingExport] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('idle');
  const [analysisState, setAnalysisState] = useState(null);
  const [analysisError, setAnalysisError] = useState('');
  const playlistNames = useMemo(() => {
    if (!selected.length) return { folder: '', album: '' };
    const paths = new Set(selected);
    const selection = tracks.filter((track) => paths.has(track.path));
    if (!selection.length) return { folder: '', album: '' };
    const directories = selection.map((track) => {
      const path = track.path.replaceAll('\\', '/');
      const slash = path.lastIndexOf('/');
      return slash < 0 ? '' : path.slice(0, slash);
    });
    const folder =
      directories[0] && directories.every((path) => path === directories[0])
        ? directories[0].split('/').at(-1)
        : '';
    const albums = selection.map((track) => track.album?.trim() || '');
    const album =
      albums[0] && albums.every((name) => name === albums[0]) ? albums[0] : '';
    return { folder, album };
  }, [selected, tracks]);
  const automaticPlaylistName =
    playlistNameSource === 'custom'
      ? ''
      : playlistNames[playlistNameSource] || '';
  const exportPlaylistName = automaticPlaylistName
    ? shortenPlaylistName(automaticPlaylistName)
    : playlistName;
  useEffect(() => {
    if (playlistNameSource !== 'custom' && !playlistNames[playlistNameSource])
      setPlaylistNameSource('custom');
  }, [playlistNameSource, playlistNames]);
  useEffect(() => {
    let cancelled = false;
    setLibraryLoading(true);
    const request = initialPaths?.length
      ? api.post('/analysis/usb-export/library', initialPaths)
      : api.get('/analysis/usb-export');
    request
      .then(({ data }) => {
        if (!cancelled) {
          const available = data.tracks || [];
          setLibraryLoaded(true);
          const byPath = new Map(available.map((track) => [track.path, track]));
          if (initialPaths) {
            const matches = initialPaths.map((path) => {
              const exact = byPath.get(path);
              if (exact) return exact;
              if (!path || path.startsWith('/')) return null;
              const candidates = available.filter((track) =>
                track.path.endsWith(`/${path}`),
              );
              return candidates.length === 1 ? candidates[0] : null;
            });
            const scoped = [
              ...new Map(
                matches.filter(Boolean).map((track) => [track.path, track]),
              ).values(),
            ];
            setTracks(scoped);
            setSelected(scoped.map((track) => track.path));
            if (matches.some((track) => !track))
              setError(
                'Some selected tracks are unavailable for export. Review the list before preparing the export.',
              );
          } else {
            setTracks(available);
          }

          setEnabled(data.enabled);
          setHelperPlatforms(data.helperPlatforms || []);
        }
      })
      .catch((error_) => {
        if (!cancelled) setError(message(error_));
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialPaths]);
  useEffect(() => {
    if (!wizard || initialPaths) return undefined;
    const id =
      new URLSearchParams(window.location.search).get('exportJob') ||
      sessionStorage.getItem('resonance-usb-export-job');
    if (!id || !/^[\da-f]{32}$/i.test(id)) return undefined;
    let cancelled = false;
    api
      .get(`/analysis/usb-export/${id}`)
      .then(({ data }) => {
        if (!cancelled) {
          setJob(data);
          setStep(3);
          setPlaylistName(data.playlistName);
          setPlaylistNameSource('custom');
          setPlayerChoice(
            data.playerModel && players[data.playerModel]
              ? data.playerModel
              : data.profile === 'legacy'
                ? 'legacy'
                : 'mixed',
          );
        }
      })
      .catch(() => sessionStorage.removeItem('resonance-usb-export-job'));
    return () => {
      cancelled = true;
    };
  }, [initialPaths, wizard]);
  useEffect(() => {
    if (!job || job.status === 'failed' || job.status === 'cancelled')
      return undefined;
    let cancelled = false;
    const timer = setInterval(
      () => {
        api
          .get(`/analysis/usb-export/${job.jobId}`)
          .then(({ data }) => {
            if (!cancelled) {
              setJob(data);
              setError('');
            }
          })
          .catch((error_) => {
            if (cancelled) return;
            if (error_?.response?.status === 404) {
              setJob(null);
              sessionStorage.removeItem('resonance-usb-export-job');
              setNotice('This export was cancelled.');
            } else setError(message(error_));
          });
      },
      active(job) ? 1_500 : 5_000,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job]);
  useEffect(() => {
    if (analysisStatus !== 'running') return undefined;
    let cancelled = false;
    const timer = { current: null };
    const poll = async () => {
      let repeat = true;
      try {
        const state = await analysisApi.getScanState();
        if (cancelled) return;
        setAnalysisState(state);
        setAnalysisError('');
        if (!state.scanning) {
          repeat = false;
          if (
            state.completed &&
            !state.cancelled &&
            !state.error &&
            !state.failed &&
            !state.enhancedFailed &&
            state.enhancedTotal > 0
          ) {
            setAnalysisStatus('finished');
          } else {
            setAnalysisStatus('idle');
            setAnalysisError(
              state.error ||
                (state.cancelled
                  ? 'Analysis was stopped before it finished.'
                  : 'Full analysis did not finish for every track. Review Track Analysis before retrying.'),
            );
          }
        }
      } catch {
        if (!cancelled)
          setAnalysisError('Could not check analysis progress. Retrying…');
      } finally {
        if (!cancelled && repeat) timer.current = setTimeout(poll, 2_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [analysisStatus]);
  const startMissingAnalysis = async () => {
    if (!selected.length) return;
    setAnalysisStatus('starting');
    setAnalysisError('');
    setAnalysisState(null);
    try {
      const { data } = await api.get('/analysis/candidates', {
        params: { path: selected[0] },
      });
      if (!data.enabled)
        throw new Error('Full analysis is not available on this instance.');
      await analysisApi.startScan({
        metrics: 'All',
        onlyPaths: selected,
        enhanced: true,
        skipAnalysed: true,
        resetAll: false,
      });
      setAnalysisStatus('running');
    } catch (caughtError) {
      setAnalysisStatus('idle');
      setAnalysisError(
        typeof caughtError?.response?.data === 'string'
          ? caughtError.response.data
          : caughtError?.message || 'Could not start full analysis.',
      );
    }
  };

  const start = async () => {
    setBusy(true);
    setStartingExport(true);
    setError('');
    setAnalysisStatus('idle');
    setAnalysisError('');
    try {
      const { data } = await api.post('/analysis/usb-export', {
        ...(selectionId ? { selectionId } : {}),
        paths: selected,
        playlistName: exportPlaylistName,
        profile,
        ...(!['mixed', 'legacy'].includes(playerChoice)
          ? { playerModel: playerChoice }
          : {}),
      });
      setJob(data);
      if (wizard)
        sessionStorage.setItem('resonance-usb-export-job', data.jobId);
      if (wizard) setStep(3);
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
      setStartingExport(false);
    }
  };

  const downloadFile = async (urlPath, filename, fallback, post = false) => {
    setBusy(true);
    setError('');
    try {
      const { data } = post
        ? await api.post(urlPath, null, { responseType: 'blob' })
        : await api.get(urlPath, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error_) {
      const data = error_?.response?.data;
      let detail = typeof data === 'string' ? data : '';
      if (data instanceof Blob && typeof data.text === 'function') {
        try {
          detail = await data.text();
        } catch {
          detail = '';
        }
      }

      setError(detail && detail.length < 500 ? detail : fallback);
    } finally {
      setBusy(false);
    }
  };

  const download = () =>
    downloadFile(
      `/analysis/usb-export/${job.jobId}/download`,
      'resonance-usb.zip',
      'USB export download failed. Retry when the export is complete.',
    );
  const downloadHandoff = () =>
    downloadFile(
      `/analysis/usb-export/${job.jobId}/transfer`,
      'resonance-export.resonance',
      'Could not prepare the Resonance Bridge handoff.',
      true,
    );
  const openHelper = async () => {
    setBusy(true);
    setError('');
    try {
      await requireLocalBridge();
      const { data } = await api.post(
        `/analysis/usb-export/${job.jobId}/transfer`,
        null,
        { responseType: 'json' },
      );
      if (data?.schemaVersion !== 1 || !data.serverUrl || !data.token)
        throw new Error('Resonance Bridge handoff is incomplete.');
      const target = new URL('http://127.0.0.1:55460/usb');
      target.hash = new URLSearchParams({
        handoff: JSON.stringify(data),
      }).toString();
      window.location.assign(target.toString());
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
    }
  };

  const downloadHelper = (platform) =>
    downloadFile(
      `/bridge/helper?platform=${platform}`,
      {
        macos: 'resonance-bridge-macos.pkg',
        windows: 'resonance-bridge-windows-setup.exe',
        linux: 'resonance-bridge-linux-amd64.deb',
        source: 'resonance-bridge-source.zip',
      }[platform],
      'Helper download is unavailable. Please retry or ask the server administrator to configure the archive.',
    );

  const cancel = async () => {
    setBusy(true);
    try {
      await api.delete(`/analysis/usb-export/${job.jobId}`);
      if (job.status === 'completed') {
        setJob(null);
        sessionStorage.removeItem('resonance-usb-export-job');
        setNotice('This export was cancelled. Bridge will release its copy.');
      }
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
    }
  };

  const deferExport = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(
        `/analysis/usb-export/${job.jobId}/defer`,
      );
      setJob(data);
      setNotice(
        'Export saved for later. Bridge will release its prepared copy.',
      );
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
    }
  };

  const analysisRunning =
    analysisStatus === 'starting' || analysisStatus === 'running';
  const needsFullAnalysis =
    job?.status === 'failed' &&
    selected.length > 0 &&
    /full enhanced analysis is required|source changed since enhanced analysis/i.test(
      job.error || '',
    );
  const locked = busy || libraryLoading || active(job);
  const completedExport = job?.status === 'completed' && job.downloadAvailable;
  const compatibilityNotes = (
    <details className="usb-export-notes">
      <summary>
        Experimental export · compatibility and included features
      </summary>
      <p>
        Experimental device-library export. Hardware verification is pending;
        compatibility depends on the player and firmware.
      </p>
      <p>
        Supported MP3, AAC in M4A, WAV, AIFF, Apple Lossless and FLAC files are
        copied without changing their audio. Your music files are not modified.
      </p>
      <p>
        Run full Track Analysis first. Beat grids and waveforms use Resonance’s
        independent analysis. Cue/loop, artwork and device vocal/phrase export
        are not included in this version.
      </p>
    </details>
  );
  return (
    <section
      aria-label="USB export"
      className="usb-export-panel"
    >
      {wizard && (
        <ol
          aria-label="Export steps"
          className="export-steps"
        >
          {[
            selectionId ? 'Review tracks' : 'Select tracks',
            'Player and playlist',
            'Review export',
            'Export and transfer',
          ].map((label, index) => (
            <li
              aria-current={step === index ? 'step' : undefined}
              key={label}
            >
              <span>Step {index + 1}</span> {label}
            </li>
          ))}
        </ol>
      )}
      <h3>
        {wizard
          ? [
              selectionId ? 'Review your tracks' : 'Select your music',
              'Choose player and playlist',
              'Ready to export',
              'Your USB export',
            ][step]
          : 'Export for compatible DJ players'}
      </h3>
      {(!wizard || step !== 3) && compatibilityNotes}
      {libraryLoading && <p role="status">Loading export tracks…</p>}
      {libraryLoaded && !enabled && (
        <p>USB export worker is not configured on this instance.</p>
      )}
      {(!wizard || step === 1) && (
        <>
          <div className="usb-export-settings">
            <label>
              Player
              <select
                aria-label="Player"
                disabled={locked}
                onChange={(event) => setPlayerChoice(event.target.value)}
                value={playerChoice}
              >
                {Object.entries(players).map(([id, player]) => (
                  <option
                    key={id}
                    value={id}
                  >
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Playlist name source
              <select
                aria-label="Playlist name source"
                disabled={locked}
                onChange={(event) => setPlaylistNameSource(event.target.value)}
                value={playlistNameSource}
              >
                <option value="custom">Custom name</option>
                <option
                  disabled={!playlistNames.folder}
                  value="folder"
                >
                  Source folder name
                </option>
                <option
                  disabled={!playlistNames.album}
                  value="album"
                >
                  Album name
                </option>
              </select>
            </label>
            <label>
              Playlist name
              <input
                disabled={locked}
                maxLength={100}
                onChange={(event) => {
                  setPlaylistNameSource('custom');
                  setPlaylistName(event.target.value);
                }}
                value={exportPlaylistName}
              />
            </label>
          </div>
          <p>
            {playerChoice === 'legacy'
              ? 'Classic database: MP3, WAV and AIFF. Choose a specific player to include its other supported formats.'
              : `${players[playerChoice].name}: MP3, AAC (M4A), WAV, AIFF, Apple Lossless and FLAC.`}{' '}
            {profile === 'dual'
              ? 'OneLibrary + classic database.'
              : 'Classic database.'}{' '}
            Files outside the selected player’s supported audio limits are
            reported before transfer.
          </p>
          {automaticPlaylistName.length > exportPlaylistName.length && (
            <p className="usb-export-name-hint">
              The selected name has been shortened to fit the 100-character
              playlist limit. You can edit it above.
            </p>
          )}
        </>
      )}
      {(!wizard || step === 0) && (
        <>
          <p className="usb-export-selection-summary">
            {!selectionId && (
              <>
                <button
                  disabled={locked || !tracks.length}
                  onClick={() => setSelected(tracks.map((track) => track.path))}
                  type="button"
                >
                  Select all
                </button>{' '}
                <button
                  disabled={locked}
                  onClick={() => setSelected([])}
                  type="button"
                >
                  Clear selection
                </button>{' '}
              </>
            )}
            <span className="usb-export-selection-count">
              {selected.length} of {tracks.length} tracks selected
            </span>
            {wizard && (
              <button
                className="usb-export-primary"
                disabled={locked || !enabled || !selected.length}
                onClick={() => setStep(1)}
                type="button"
              >
                Continue to player and playlist
              </button>
            )}
          </p>
          <ExportTrackPicker
            disabled={locked || Boolean(selectionId)}
            onChange={setSelected}
            selected={selected}
            tracks={tracks}
          />
        </>
      )}
      {wizard && step >= 2 && !completedExport && (
        <div className="export-review">
          <h4>{step === 2 ? 'Review your export' : 'Download and transfer'}</h4>
          <p>
            {step === 3 && job ? job.total : selected.length}{' '}
            {(step === 3 && job ? job.total : selected.length) === 1
              ? 'track'
              : 'tracks'}{' '}
            · Playlist: {exportPlaylistName} · {players[playerChoice].name}
          </p>
          <p>
            Supported original audio is copied without conversion. Includes
            playlist, beat grids and waveforms. Resonance Bridge transfers the
            prepared files to an empty compatible USB drive.
          </p>
        </div>
      )}
      {(!wizard ||
        step === 2 ||
        (step === 3 && ['failed', 'cancelled'].includes(job?.status))) && (
        <p>
          <button
            className="usb-export-primary"
            disabled={
              !enabled ||
              locked ||
              analysisRunning ||
              !selected.length ||
              !exportPlaylistName.trim()
            }
            onClick={start}
            type="button"
          >
            {startingExport ? (
              <>
                <span
                  aria-hidden="true"
                  className="usb-export-spinner"
                />{' '}
                Starting USB export…
              </>
            ) : job?.status === 'failed' ? (
              'Retry USB export'
            ) : (
              'Prepare USB export'
            )}
          </button>
        </p>
      )}
      {completedExport && (
        <div
          className="usb-export-ready"
          role="status"
        >
          <strong>
            {job.deferred ? 'USB export saved for later' : 'USB export ready'}
          </strong>
          <p>
            {job.total} tracks · {exportPlaylistName} ·{' '}
            {players[playerChoice].name}
          </p>
          <div className="usb-export-ready-actions">
            <button
              className="usb-export-primary"
              disabled={busy}
              onClick={openHelper}
              type="button"
            >
              Open in Resonance Bridge
            </button>
            <button
              disabled={busy}
              onClick={download}
              type="button"
            >
              Download USB ZIP
            </button>
            {!job.deferred && (
              <button
                disabled={busy}
                onClick={deferExport}
                type="button"
              >
                Save for later
              </button>
            )}
            <button
              disabled={busy}
              onClick={cancel}
              type="button"
            >
              Cancel export
            </button>
          </div>
          <p>
            {job.deferred
              ? 'Reopen this saved export in Bridge when you are ready.'
              : 'Choose your USB drive in Bridge to transfer the prepared files.'}
          </p>
        </div>
      )}
      {job && !completedExport && (
        <div aria-live="polite">
          {active(job) ? (
            <div
              className="usb-export-progress"
              role="status"
            >
              <span
                aria-hidden="true"
                className="usb-export-spinner"
              />
              <div className="usb-export-progress-details">
                <strong>
                  {exportStage[job.status] || 'Preparing USB export…'}
                </strong>
                <p>
                  {job.status === 'preparing'
                    ? `${job.prepared} of ${job.total} tracks checked`
                    : `${job.total} tracks in this export`}
                </p>
                {job.status === 'preparing' ? (
                  <progress
                    aria-label="Tracks checked for export"
                    max={job.total}
                    value={job.prepared}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="usb-export-progress-indeterminate"
                  />
                )}
              </div>
            </div>
          ) : (
            <p>
              Export: {job.status}. Prepared {job.prepared} / {job.total}{' '}
              tracks.
            </p>
          )}
          {active(job) && (
            <button
              onClick={cancel}
              type="button"
            >
              Cancel export
            </button>
          )}
          {job.error && <p role="alert">{job.error}</p>}
          {needsFullAnalysis && (
            <div className="usb-export-analysis-recovery">
              <h4>Full analysis needed for this export</h4>
              <p>
                Check the {selected.length} selected tracks and run full
                analysis where current results are missing. Existing results are
                reused.
              </p>
              <button
                disabled={analysisRunning}
                onClick={startMissingAnalysis}
                type="button"
              >
                {analysisStatus === 'starting'
                  ? 'Starting full analysis…'
                  : analysisStatus === 'running'
                    ? 'Full analysis running…'
                    : 'Analyse tracks needed for export'}
              </button>
              {analysisStatus === 'running' && (
                <p role="status">
                  Full analysis is running
                  {analysisState?.enhancedTotal > 0
                    ? ` · ${analysisState.enhancedCompleted || 0} of ${analysisState.enhancedTotal} enhanced tracks complete`
                    : ' · checking basic results first'}
                  .
                </p>
              )}
              {analysisStatus === 'finished' && (
                <p role="status">
                  Analysis scan finished. Retry the USB export to verify every
                  track is ready.
                </p>
              )}
              {analysisError && <p role="alert">{analysisError}</p>}
            </div>
          )}
          {job.downloadAvailable && (
            <p>
              <button
                disabled={busy}
                onClick={openHelper}
                type="button"
              >
                Open in Resonance Bridge
              </button>{' '}
              <a
                href="http://127.0.0.1:55460/"
                rel="noopener noreferrer"
                target="_blank"
              >
                Open Resonance helper
              </a>
            </p>
          )}
          {job.downloadAvailable && (
            <button
              disabled={busy}
              onClick={download}
              type="button"
            >
              Download USB ZIP
            </button>
          )}
        </div>
      )}
      {wizard && step < 3 && (
        <div className="export-wizard-actions">
          {step > 0 && (
            <button
              disabled={locked}
              onClick={() => setStep(step - 1)}
              type="button"
            >
              Back
            </button>
          )}
          {step < 2 && (
            <button
              className="usb-export-primary"
              disabled={
                locked ||
                !enabled ||
                !selected.length ||
                (step === 1 && !exportPlaylistName.trim())
              }
              onClick={() => setStep(step + 1)}
              type="button"
            >
              Continue
            </button>
          )}
        </div>
      )}
      {wizard && step === 3 && !active(job) && (
        <button
          className="usb-export-start-over"
          disabled={busy}
          onClick={() => {
            setJob(null);
            sessionStorage.removeItem('resonance-usb-export-job');
            setStep(0);
          }}
          type="button"
        >
          Start another export
        </button>
      )}
      {(!wizard || step === 3) && (
        <details className="usb-export-transfer-help">
          <summary>Bridge setup and other transfer options</summary>
          {wizard && step === 3 && compatibilityNotes}
          <p>
            <a href={`${urlBase}/apps/bridge`}>
              All installers and Bridge setup
            </a>
          </p>
          <p>
            Open in Resonance Bridge takes you straight to the installed Bridge
            app. It fetches this export’s files directly and lets you choose a
            USB drive. Confirm the destination there to begin writing.
          </p>
          {job?.downloadAvailable && (
            <p>
              <button
                disabled={busy}
                onClick={downloadHandoff}
                type="button"
              >
                Download action file instead
              </button>
            </p>
          )}
          <p>
            <a
              href="http://127.0.0.1:55460/"
              rel="noopener noreferrer"
              target="_blank"
            >
              Open Resonance helper
            </a>
          </p>
          <p>
            <button
              disabled={busy || !helperPlatforms.includes('macos')}
              onClick={() => downloadHelper('macos')}
              type="button"
            >
              Download Resonance Bridge for Mac
            </button>{' '}
            {['windows', 'linux'].map((platform) => (
              <button
                disabled={busy || !helperPlatforms.includes(platform)}
                key={platform}
                onClick={() => downloadHelper(platform)}
                type="button"
              >
                {platform === 'windows'
                  ? 'Download Resonance Bridge for Windows'
                  : 'Download Resonance Bridge for Debian / Ubuntu'}
              </button>
            ))}{' '}
            <button
              disabled={busy || !helperPlatforms.includes('source')}
              onClick={() => downloadHelper('source')}
              type="button"
            >
              Download cross-platform source and build guide
            </button>
          </p>
          <p>
            Use an empty test drive and safely eject it before testing on
            hardware. For manual transfer, extract the ZIP and copy its device
            library folders together to the drive root.
          </p>
        </details>
      )}
      {showInspector && <UsbExportInspector latestJob={job} />}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
};

export default UsbExportPanel;
