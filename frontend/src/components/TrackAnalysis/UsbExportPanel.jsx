import './UsbExportPanel.css';
import api from '../../lib/api';
import ExportTrackPicker from './ExportTrackPicker';
import React, { useEffect, useState } from 'react';

const message = (error) =>
  typeof error?.response?.data === 'string'
    ? error.response.data
    : error?.message || 'Export failed.';
const active = (job) =>
  job && !['completed', 'failed', 'cancelled'].includes(job.status);
const UsbExportPanel = ({
  initialPaths = null,
  initialPlaylistName = 'Resonance',
  wizard = false,
}) => {
  const [step, setStep] = useState(0);
  const [tracks, setTracks] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [helperPlatforms, setHelperPlatforms] = useState([]);
  const [selected, setSelected] = useState([]);
  const [playlistName, setPlaylistName] = useState(initialPlaylistName);
  const [profile, setProfile] = useState('dual');
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .get('/analysis/usb-export')
      .then(({ data }) => {
        if (!cancelled) {
          const available = data.tracks || [];
          if (initialPaths) {
            const matches = initialPaths.map((path) => {
              const exact = available.find((track) => track.path === path);
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
          setProfile(data.profile);
        }
      })
      .catch(() => sessionStorage.removeItem('resonance-usb-export-job'));
    return () => {
      cancelled = true;
    };
  }, [initialPaths, wizard]);
  useEffect(() => {
    if (!active(job)) return undefined;
    let cancelled = false;
    const timer = setInterval(() => {
      api
        .get(`/analysis/usb-export/${job.jobId}`)
        .then(({ data }) => {
          if (!cancelled) {
            setJob(data);
            setError('');
          }
        })
        .catch((error_) => {
          if (!cancelled) setError(message(error_));
        });
    }, 1_500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job]);
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/analysis/usb-export', {
        paths: selected,
        playlistName,
        profile,
      });
      setJob(data);
      if (wizard)
        sessionStorage.setItem('resonance-usb-export-job', data.jobId);
      if (wizard) setStep(3);
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
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
  const openHelper = () =>
    downloadFile(
      `/analysis/usb-export/${job.jobId}/transfer`,
      'resonance-export.resonance',
      'Could not prepare the USB helper handoff.',
      true,
    );
  const downloadHelper = (platform) =>
    downloadFile(
      `/analysis/pioneer-link/helper?platform=${platform}`,
      {
        macos: 'resonance-pioneer-link-macos.pkg',
        windows: 'resonance-pioneer-link-windows-setup.exe',
        linux: 'resonance-pioneer-link-linux-amd64.deb',
        source: 'resonance-pioneer-link-source.zip',
      }[platform],
      'Helper download is unavailable. Please retry or ask the server administrator to configure the archive.',
    );

  const cancel = async () => {
    try {
      await api.delete(`/analysis/usb-export/${job.jobId}`);
    } catch (error_) {
      setError(message(error_));
    }
  };

  const locked = busy || active(job);
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
            'Select tracks',
            'Player and playlist',
            'Review',
            'Export and transfer',
          ].map((label, index) => (
            <li
              aria-current={step === index ? 'step' : undefined}
              key={label}
            >
              <span>{index + 1}</span> {label}
            </li>
          ))}
        </ol>
      )}
      <h3>
        {wizard
          ? [
              'Select your music',
              'Choose player and playlist',
              'Ready to export',
              'Your USB export',
            ][step]
          : 'Export for Pioneer DJ players'}
      </h3>
      <details className="usb-export-notes">
        <summary>
          Experimental export · compatibility and included features
        </summary>
        <p>
          Experimental Rekordbox-format export. Hardware verification is
          pending; compatibility depends on the player and firmware.
        </p>
        <p>
          Audio is exported as stereo 16-bit 44.1 kHz WAV for broad player
          support. This creates new copies and does not change your music files.
        </p>
        <p>
          Run full Track Analysis first. Beat grids and waveforms use
          Resonance’s independent analysis. Cue/loop, artwork and device
          vocal/phrase export are not included in this version.
        </p>
      </details>
      {!enabled && <p>USB export worker is not configured on this instance.</p>}
      {(!wizard || step === 1) && (
        <>
          <label>
            Playlist name{' '}
            <input
              disabled={locked}
              maxLength={100}
              onChange={(event) => setPlaylistName(event.target.value)}
              value={playlistName}
            />
          </label>{' '}
          <label>
            Player profile{' '}
            <select
              disabled={locked}
              onChange={(event) => setProfile(event.target.value)}
              value={profile}
            >
              <option value="dual">
                OPUS-QUAD + legacy players (dual database)
              </option>
              <option value="legacy">Legacy players</option>
            </select>
          </label>
        </>
      )}
      {(!wizard || step === 0) && (
        <>
          <p>
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
            {selected.length} of {tracks.length} tracks selected
          </p>
          <ExportTrackPicker
            disabled={locked}
            onChange={setSelected}
            selected={selected}
            tracks={tracks}
          />
        </>
      )}
      {wizard && step >= 2 && (
        <div className="export-review">
          <h4>{step === 2 ? 'Review your export' : 'Download and transfer'}</h4>
          <p>
            {step === 3 && job ? job.total : selected.length}{' '}
            {(step === 3 && job ? job.total : selected.length) === 1
              ? 'track'
              : 'tracks'}{' '}
            · Playlist: {playlistName} ·{' '}
            {profile === 'dual'
              ? 'OPUS-QUAD + legacy players'
              : 'Legacy players'}
          </p>
          <p>
            Audio: stereo WAV, 16-bit / 44.1 kHz. Includes playlist, beat grids
            and waveforms. Use the native helper to install the downloaded ZIP
            onto an empty compatible USB drive.
          </p>
        </div>
      )}
      {(!wizard ||
        step === 2 ||
        (step === 3 && ['failed', 'cancelled'].includes(job?.status))) && (
        <p>
          <button
            disabled={
              !enabled || locked || !selected.length || !playlistName.trim()
            }
            onClick={start}
            type="button"
          >
            Prepare USB export
          </button>
        </p>
      )}
      {job && (
        <div aria-live="polite">
          <p>
            Export: {job.status}. Prepared {job.prepared} / {job.total} tracks.
          </p>
          {active(job) && (
            <button
              onClick={cancel}
              type="button"
            >
              Cancel export
            </button>
          )}
          {job.error && <p role="alert">{job.error}</p>}
          {job.downloadAvailable && (
            <p>
              <button
                disabled={busy}
                onClick={openHelper}
                type="button"
              >
                Open in USB helper
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
              disabled={
                locked ||
                !enabled ||
                !selected.length ||
                (step === 1 && !playlistName.trim())
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
        <>
          <h4>Native USB helper</h4>
          <p>
            Open in USB helper downloads a small .resonance action file. Open
            that file with the updated Resonance desktop helper; it downloads
            this export and lets you choose a USB drive. Confirm the destination
            in the helper to begin writing. The same installed helper now
            handles USB Export and Network Link.
          </p>
          <p>
            <button
              disabled={busy || !helperPlatforms.includes('macos')}
              onClick={() => downloadHelper('macos')}
              type="button"
            >
              Download updated Mac helper installer
            </button>{' '}
            {['windows', 'linux'].map((platform) => (
              <button
                disabled={busy || !helperPlatforms.includes(platform)}
                key={platform}
                onClick={() => downloadHelper(platform)}
                type="button"
              >
                {platform === 'windows'
                  ? 'Download Windows helper installer'
                  : 'Download Debian / Ubuntu helper installer'}
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
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        Extract the ZIP, then copy its Contents and PIONEER folders to the root
        of a player-compatible USB drive. Keep these folders together. Use an
        empty test drive and safely eject it before testing on hardware. The
        Windows, macOS or Linux native USB helper writes the prepared export to
        your drive. The browser prepares and downloads the ZIP; it cannot write
        directly to USB devices.
      </p>
    </section>
  );
};

export default UsbExportPanel;
