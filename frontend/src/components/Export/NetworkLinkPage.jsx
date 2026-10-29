import './NetworkLinkPage.css';
import '../TrackAnalysis/UsbExportPanel.css';
import { urlBase } from '../../config';
import api from '../../lib/api';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Laptop,
  Link2,
  Radio,
  Server,
  ShieldCheck,
  Trash2,
  Wifi,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

const pending = (job) =>
  job && !['completed', 'failed', 'cancelled'].includes(job.status);
const platformName = (value) =>
  ({ darwin: 'macOS', windows: 'Windows', linux: 'Linux' })[value] ||
  value ||
  'Unknown platform';
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
  const [section, setSection] = useState('overview');
  const [trackCount, setTrackCount] = useState(0);
  const [readiness, setReadiness] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [libraryStatusLoaded, setLibraryStatusLoaded] = useState(false);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    let live = true;
    let timer;
    const request = new AbortController();
    const refresh = () =>
      api
        .get('/bridge', { signal: request.signal, timeout: 15_000 })
        .then(({ data }) => {
          if (!live) return;
          setTrackCount(data.trackCount || 0);
          setReadiness(data);
          setEnabled(data.enabled);
          setLibraryStatusLoaded(true);
          setStatusError('');
          setPlatforms(data.helperPlatforms || []);
        })
        .catch(() => {
          if (live)
            setStatusError('Could not refresh Bridge status. Retrying…');
        })
        .finally(() => {
          if (live) timer = setTimeout(refresh, 5_000);
        });
    refresh();
    return () => {
      live = false;
      clearTimeout(timer);
      request.abort();
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
      const { data } = await api.post('/bridge');
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

  const revokeOne = async (id) => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api.delete(`/bridge/connections/${id}`);
      setReadiness((current) => ({
        ...current,
        pairedBridgeCount: Math.max(0, (current?.pairedBridgeCount || 1) - 1),
        bridgePairings: (current?.bridgePairings || []).filter(
          (pairing) => pairing.id !== id,
        ),
        connectedBridges: (current?.connectedBridges || []).filter(
          (bridge) => bridge.pairingId !== id,
        ),
      }));
      setFeedback('Bridge pairing deleted. That Bridge can no longer connect.');
    } catch (error_) {
      setError(
        await actionError(error_, 'Could not delete this Bridge pairing.'),
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
  const bridges = readiness?.connectedBridges || [];
  const bridgePairings = readiness?.bridgePairings || [];
  const pairedCount = readiness?.pairedBridgeCount || 0;
  const bridgeStatus = bridges.length
    ? `${bridges.length} online`
    : 'No Bridge online';
  const bridgeHeading = bridges.length
    ? 'Online and checking for updates'
    : 'Waiting for a Bridge';
  return (
    <main className={`network-link-page network-link-section-${section}`}>
      <div className="network-link-banner">
        <Radio size={25} />
        <div>
          <strong>Resonance Bridge</strong>
          <p>
            Pair a computer on your player network and manage its live
            connection to your analysed Resonance library.
          </p>
        </div>
        <span className={`network-link-live ${bridges.length ? 'online' : ''}`}>
          {libraryStatusLoaded ? bridgeStatus : 'Checking connections…'}
        </span>
      </div>
      <nav
        aria-label="Bridge functions"
        className="network-link-tabs"
      >
        {[
          ['overview', 'Overview'],
          ['bridges', 'Bridges & pairing'],
          ['library', 'Shared library'],
          ['setup', 'Install & support'],
        ].map(([id, label]) => (
          <button
            aria-current={section === id ? 'page' : undefined}
            className={section === id ? 'active' : ''}
            key={id}
            onClick={() => setSection(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      {(error || statusError) && (
        <p
          className="network-link-error"
          role="alert"
        >
          {error || statusError}
        </p>
      )}
      {(section === 'overview' || section === 'bridges') && (
        <section className="network-link-card network-link-connected">
          <div className="network-link-section-heading">
            <div>
              <span className="network-link-kicker">Connected Bridge</span>
              <h2>
                {libraryStatusLoaded
                  ? bridgeHeading
                  : 'Checking Bridge connections'}
              </h2>
            </div>
            {bridges.length > 0 && (
              <CheckCircle2
                className="network-link-ok"
                size={28}
              />
            )}
          </div>
          {!libraryStatusLoaded && (
            <p role="status">Loading connected Bridges…</p>
          )}
          {libraryStatusLoaded &&
            (bridges.length ? (
              <div className="network-link-devices">
                {bridges.map((bridge) => (
                  <article
                    className="network-link-device"
                    key={`${bridge.name}-${bridge.address}-${bridge.lastSeen}`}
                  >
                    <div className="network-link-device-icon">
                      <Laptop size={26} />
                    </div>
                    <div className="network-link-device-title">
                      <strong>{bridge.name || 'Resonance Bridge'}</strong>
                      <span>
                        <i /> Online now
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>Address</dt>
                        <dd>{bridge.address || 'Upgrade Bridge to report'}</dd>
                      </div>
                      {bridge.observedAddress &&
                        bridge.observedAddress !== bridge.address && (
                          <div>
                            <dt>Connection route</dt>
                            <dd>{bridge.observedAddress}</dd>
                          </div>
                        )}
                      <div>
                        <dt>Version</dt>
                        <dd>{bridge.version || 'Legacy version'}</dd>
                      </div>
                      <div>
                        <dt>System</dt>
                        <dd>
                          {platformName(bridge.platform)}
                          {bridge.architecture
                            ? ` · ${bridge.architecture}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>Last contact</dt>
                        <dd>
                          {new Date(bridge.lastSeen).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>Heartbeat latency</dt>
                        <dd>
                          {bridge.latencyMs > 0
                            ? `${bridge.latencyMs} ms`
                            : 'Awaiting sample'}
                        </dd>
                      </div>
                    </dl>
                    {section === 'bridges' && (
                      <button
                        aria-label={`Delete pairing for ${bridge.name || 'Bridge'}`}
                        className="network-link-delete"
                        disabled={busy}
                        onClick={() => revokeOne(bridge.pairingId)}
                        type="button"
                      >
                        <Trash2 size={15} /> Delete pairing
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="network-link-empty">
                <Link2 size={30} />
                <div>
                  <strong>
                    {pairedCount
                      ? 'A Bridge is paired but currently offline'
                      : 'Pair your first Bridge'}
                  </strong>
                  <p>
                    {pairedCount
                      ? 'Start Resonance Bridge on the paired computer. It will appear here within 30 seconds.'
                      : 'Download a pairing file, then open it on the computer connected to your player network.'}
                  </p>
                </div>
              </div>
            ))}
        </section>
      )}
      {section !== 'overview' && (
        <div className="network-link-layout">
          {section === 'bridges' && (
            <section className="network-link-card network-link-pairing">
              <div className="network-link-section-heading">
                <div>
                  <span className="network-link-kicker">Pairing</span>
                  <h2>
                    {pairedCount
                      ? 'Add or replace a Bridge'
                      : 'Connect Resonance Bridge'}
                  </h2>
                </div>
                <ShieldCheck size={25} />
              </div>
              <p>
                The pairing file securely connects Bridge to this Resonance
                server for 30 days. Open it on the computer running Bridge.
              </p>
              <div className="network-link-actions">
                <button
                  className="network-link-primary"
                  disabled={busy}
                  onClick={connectHelper}
                  type="button"
                >
                  {pairedCount
                    ? 'Pair another Bridge'
                    : 'Download Bridge pairing'}
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
              {libraryStatusLoaded && !enabled && (
                <p className="network-link-note">
                  Bridge setup and software updates are available. This server’s
                  library-preparation worker is not configured, so music
                  synchronization and Network Link sharing are not ready.
                </p>
              )}
              <p className="network-link-note">
                {pairedCount} active pairing{pairedCount === 1 ? '' : 's'}.
                Pairing credentials are private and provide read-only library
                access.
              </p>
              {bridgePairings.some((pairing) => !pairing.connected) && (
                <div className="network-link-offline-pairings">
                  <strong>Offline pairings</strong>
                  {bridgePairings
                    .filter((pairing) => !pairing.connected)
                    .map((pairing) => (
                      <div key={pairing.id}>
                        <span>
                          Bridge {pairing.id} · expires{' '}
                          {new Date(pairing.expires).toLocaleDateString()}
                        </span>
                        <button
                          aria-label={`Delete offline pairing ${pairing.id}`}
                          disabled={busy}
                          onClick={() => revokeOne(pairing.id)}
                          type="button"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </section>
          )}
          {section === 'library' && (
            <section className="network-link-card network-link-library">
              <div className="network-link-library-content">
                <div className="network-link-section-heading">
                  <div>
                    <span className="network-link-kicker">Shared library</span>
                    <h2>Ready for Network Link</h2>
                  </div>
                  <Server size={25} />
                </div>
                <div className="network-link-library-count">
                  <strong>{readiness?.readyTrackCount ?? 0}</strong>
                  <span>fully analysed tracks</span>
                </div>
                <p>
                  Out of {trackCount} indexed tracks. Waveforms, beat grids, key
                  and player metadata are supplied with streamed audio.
                </p>
                {readiness?.readinessMessage && (
                  <p role="status">{readiness.readinessMessage}</p>
                )}
                {libraryStatusLoaded && !enabled && (
                  <p className="network-link-note">
                    The library-preparation worker is not configured, so sharing
                    is not ready.
                  </p>
                )}
                <a
                  className="network-link-open"
                  href="http://127.0.0.1:55460/"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Wifi size={16} /> Open Bridge dashboard{' '}
                  <ExternalLink size={14} />
                </a>
                <details className="network-link-offline">
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
                          .catch(() =>
                            setError('Could not cancel preparation.'),
                          )
                      }
                      type="button"
                    >
                      Cancel preparation
                    </button>
                  )}
                </details>
              </div>
            </section>
          )}
          {section === 'setup' && (
            <section className="network-link-card network-link-setup">
              <div className="network-link-setup-content">
                <div className="network-link-section-heading">
                  <div>
                    <span className="network-link-kicker">
                      Install & support
                    </span>
                    <h2>Get Resonance Bridge</h2>
                  </div>
                  <Download size={25} />
                </div>
                <p>
                  <a href={`${urlBase}/apps/bridge`}>
                    Bridge installation and setup
                  </a>
                </p>
                <div className="network-link-downloads">
                  {platforms.map((p) => (
                    <button
                      disabled={busy}
                      key={p}
                      onClick={() =>
                        download(
                          `/bridge/helper?platform=${p}`,
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
                  <p>
                    Helper downloads have not been configured on this server.
                  </p>
                )}
                <p className="network-link-note">
                  Install Bridge on the computer connected to your player
                  network, then return to Bridges & pairing to connect it
                  securely.
                </p>
                <details>
                  <summary>Troubleshooting and support</summary>
                  <p>
                    In the Bridge dashboard, choose “Save diagnostic report” to
                    download recent events and connection status. Credentials
                    and music are excluded. For server failures, review the
                    Bridge source in System logs.
                  </p>
                </details>
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
};

export default NetworkLinkPage;
