import './NetworkLinkPage.css';
import '../TrackAnalysis/UsbExportPanel.css';
import api from '../../lib/api';
import { Download, ExternalLink, Radio, Wifi } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const pending = (job) =>
  job && !['completed', 'failed', 'cancelled'].includes(job.status);
const NetworkLinkPage = () => {
  const [trackCount, setTrackCount] = useState(0);
  const [platforms, setPlatforms] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api
      .get('/analysis/pioneer-link')
      .then(({ data }) => {
        if (!live) return;
        setTrackCount(data.trackCount || 0);
        setEnabled(data.enabled);
        setPlatforms(data.helperPlatforms || []);
      })
      .catch(() => {
        if (live) setError('Could not load Network Link. Please refresh.');
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!pending(job)) return undefined;
    let live = true;
    const timer = setInterval(
      () =>
        api
          .get(`/analysis/usb-export/${job.jobId}`)
          .then(({ data }) => {
            if (live) {
              setJob(data);
              setError('');
            }
          })
          .catch(() => {
            if (live)
              setError(
                'Status temporarily unavailable. Preparation may still be running.',
              );
          }),
      1_500,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job]);
  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/analysis/pioneer-link');
      setJob(data);
    } catch (error_) {
      setError(
        typeof error_.response?.data === 'string'
          ? error_.response.data
          : 'Could not prepare this set.',
      );
    } finally {
      setBusy(false);
    }
  };

  const connectHelper = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(
        '/analysis/pioneer-link/connection',
        null,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'resonance-library.resonance';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Could not create a helper connection.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError('');
    try {
      await api.delete('/analysis/pioneer-link/connections');
    } catch {
      setError('Could not revoke helper connections.');
    } finally {
      setBusy(false);
    }
  };

  const download = async (path, filename) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Download unavailable. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  const locked = busy || pending(job);
  return (
    <main className="network-link-page">
      <div className="network-link-banner">
        <Radio size={25} />
        <div>
          <strong>
            Pioneer Network Link{' '}
            <span className="network-link-badge">Experimental</span>
          </strong>
          <p>
            Your whole library, served by a helper beside your decks. Hardware
            validation is still pending.
          </p>
        </div>
      </div>
      <div className="network-link-layout">
        <section className="network-link-card usb-export-panel">
          <h2>
            <span className="network-link-number">1</span> Share your whole
            library
          </h2>
          <p>
            All {trackCount} tracks in your Resonance library are included
            automatically, with available waveforms and beat grids.
          </p>
          <p>
            Connect the desktop helper once. It checks Resonance automatically
            and adds new music after indexing and full-track analysis are ready.
            Existing music stays available during updates.
          </p>
          <div className="network-link-actions">
            <button
              className="network-link-primary"
              disabled={busy || !enabled}
              onClick={connectHelper}
              type="button"
            >
              Download helper connection
            </button>
            <button
              disabled={busy}
              onClick={revoke}
              type="button"
            >
              Revoke helper connections
            </button>
          </div>
          <p className="network-link-note">
            The connection file grants read-only access to your library for 30
            days. Keep it private. The helper needs to reach this Resonance
            server; use HTTPS when connecting over the Internet.
          </p>
          <details>
            <summary>Offline library copy</summary>
            <p>
              Use this when the helper cannot stay connected to Resonance.
              Offline copies need a manual refresh.
            </p>
            <div className="network-link-actions">
              <button
                className="network-link-primary"
                disabled={!enabled || !trackCount || locked}
                onClick={prepare}
                type="button"
              >
                {job?.status === 'completed'
                  ? 'Refresh whole library'
                  : 'Prepare whole library'}
              </button>
              {job?.status === 'completed' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    download(
                      `/analysis/usb-export/${job.jobId}/download`,
                      'resonance-network-library.zip',
                    )
                  }
                  type="button"
                >
                  <Download size={15} /> Download library
                </button>
              )}
            </div>
            {!enabled && (
              <p>Library preparation is not enabled on this server.</p>
            )}
            {job && (
              <p role="status">
                Preparation: {job.status}
                {job.error ? ` · ${job.error}` : ''}
              </p>
            )}
            {pending(job) && (
              <button
                onClick={() =>
                  api
                    .delete(`/analysis/usb-export/${job.jobId}`)
                    .catch(() => setError('Could not cancel preparation.'))
                }
                type="button"
              >
                Cancel preparation
              </button>
            )}
          </details>
        </section>
        <aside className="network-link-card">
          <h2>
            <span className="network-link-number">2</span> Open the desktop
            helper
          </h2>
          <p>
            Run it on the computer connected to your players’ network.
            Resonance’s server can be elsewhere.
          </p>
          <div className="network-link-downloads">
            {platforms.map((p) => (
              <button
                disabled={busy}
                key={p}
                onClick={() =>
                  download(
                    `/analysis/pioneer-link/helper?platform=${p}`,
                    {
                      macos: 'resonance-pioneer-link-macos.pkg',
                      windows: 'resonance-pioneer-link-windows-setup.exe',
                      linux: 'resonance-pioneer-link-linux-amd64.deb',
                      source: 'resonance-pioneer-link-source.zip',
                    }[p],
                  )
                }
                type="button"
              >
                <Download size={15} />{' '}
                {
                  {
                    macos: 'macOS installer · Apple silicon',
                    windows: 'Windows installer · x64',
                    linux: 'Debian / Ubuntu installer · x64',
                    source: 'Source and build guide',
                  }[p]
                }
              </button>
            ))}
          </div>
          {!platforms.length && (
            <p>Helper downloads have not been configured on this server.</p>
          )}
          <h2>
            <span className="network-link-number">3</span> Connect your decks
          </h2>
          <ol>
            <li>
              Open the .resonance action file with the installed helper. Your
              library downloads automatically.
            </li>
            <li>
              Choose the network connected to your players. Close rekordbox’s
              LINK EXPORT first.
            </li>
            <li>
              Start sharing. Discovered players appear in the helper; select
              Resonance from the player’s LINK sources.
            </li>
          </ol>
          <a
            className="network-link-open"
            href="http://127.0.0.1:55460/"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Wifi size={16} /> Open helper dashboard <ExternalLink size={14} />
          </a>
          <p className="network-link-note">
            Install and start the helper before opening its dashboard. Sharing
            stays off until you start it. A wired connection is recommended.
            Player support and firewall setup vary by model; test before a
            performance.
          </p>
        </aside>
      </div>
      {error && (
        <p
          className="network-link-error"
          role="alert"
        >
          {error}
        </p>
      )}
    </main>
  );
};

export default NetworkLinkPage;
