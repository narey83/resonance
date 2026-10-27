import './NetworkLinkPage.css';
import '../TrackAnalysis/UsbExportPanel.css';
import { urlBase } from '../../config';
import api from '../../lib/api';
import { Download, ExternalLink, Radio, Wifi } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const pending = (job) =>
  job && !['completed', 'failed', 'cancelled'].includes(job.status);
const actionError = async (failure, fallback) => {
  if (failure.response?.status === 403)
    return 'Your account needs read/write access to set up or revoke Bridge connections.';
  if (failure.response?.status === 401)
    return 'Your sign-in has expired. Sign in again and retry.';
  let body = failure.response?.data;
  try {
    if (body instanceof Blob) body = await body.text();
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* The server may return plain text. */
      }
    }

    if (typeof body === 'string' && body.trim() && !body.trim().startsWith('<'))
      return body.slice(0, 500);
    const message = body?.detail || body?.error || body?.title;
    return typeof message === 'string' ? message.slice(0, 500) : fallback;
  } catch {
    return fallback;
  }
};

const NetworkLinkPage = () => {
  const [trackCount, setTrackCount] = useState(0);
  const [readiness, setReadiness] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [libraryStatusLoaded, setLibraryStatusLoaded] = useState(false);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    let live = true;
    const refresh = () =>
      api
        .get('/bridge')
        .then(({ data }) => {
          if (!live) return;
          setTrackCount(data.trackCount || 0);
          setReadiness(data);
          setEnabled(data.enabled);
          setLibraryStatusLoaded(true);
          setPlatforms(data.helperPlatforms || []);
        })
        .catch(() => {
          if (live) setError('Could not load Network Link. Please refresh.');
        });
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => {
      clearInterval(timer);
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
    setFeedback('');
    try {
      const { data } = await api.post('/bridge/connection', null, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'resonance-bridge-pairing.resonance';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setFeedback(
        'Pairing file ready. Open resonance-bridge-pairing.resonance with Resonance Bridge to finish setup.',
      );
    } catch (error_) {
      setError(
        await actionError(
          error_,
          'Could not create a Bridge connection. Please try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api.delete('/bridge/connections');
      setFeedback(
        'Bridge pairings revoked. Existing pairing files no longer work. Download a new pairing file to reconnect.',
      );
    } catch (error_) {
      setError(
        await actionError(
          error_,
          'Could not revoke Bridge connections. Please try again.',
        ),
      );
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
            Your fully analysed library, served by Resonance Bridge. Hardware
            validation is still pending.
          </p>
        </div>
      </div>
      <div className="network-link-layout">
        <section className="network-link-card usb-export-panel">
          <h2>
            <span className="network-link-number">1</span> Share your analysed
            library
          </h2>
          <p>
            {readiness?.readyTrackCount ?? 0} fully analysed tracks ready out of{' '}
            {trackCount} indexed tracks. Only current, complete full-track
            analysis is shared, including waveforms, beat grids and key.
          </p>
          <p>
            Connect Resonance Bridge once. It checks Resonance automatically and
            adds new music after indexing and full-track analysis are ready.
            Verified batches resume after a restart. Existing music stays
            available during updates.
          </p>
          {readiness?.readinessMessage && (
            <p role="status">{readiness.readinessMessage}</p>
          )}
          <div className="network-link-actions">
            <button
              className="network-link-primary"
              disabled={busy}
              onClick={connectHelper}
              type="button"
            >
              Download Bridge pairing
            </button>
            <button
              disabled={busy}
              onClick={revoke}
              type="button"
            >
              Revoke Bridge connections
            </button>
          </div>
          {feedback && (
            <p
              className="network-link-feedback"
              role="status"
            >
              {feedback}
            </p>
          )}
          {error && (
            <p
              className="network-link-error"
              role="alert"
            >
              {error}
            </p>
          )}
          {libraryStatusLoaded && !enabled && (
            <p className="network-link-note">
              Bridge setup and software updates are available. This server’s
              library-preparation worker is not configured, so music
              synchronization and Network Link sharing are not ready.
            </p>
          )}
          <p className="network-link-note">
            The pairing file connects Bridge to this Resonance instance for 30
            days. Network Link and USB Export use it for read-only library
            access. Keep it private and use HTTPS over the Internet.
          </p>
          <details>
            <summary>Troubleshooting and support</summary>
            <p>
              In the Bridge dashboard, choose “Save diagnostic report” to
              download recent events and connection status. Credentials and
              music are excluded. For server failures, review the Bridge source
              in System logs.
            </p>
          </details>
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
          <p>
            <a href={`${urlBase}/apps/bridge`}>
              Install and set up Resonance Bridge
            </a>
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
                      macos: 'resonance-bridge-macos.pkg',
                      windows: 'resonance-bridge-windows-setup.exe',
                      linux: 'resonance-bridge-linux-amd64.deb',
                      source: 'resonance-bridge-source.zip',
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
    </main>
  );
};

export default NetworkLinkPage;
