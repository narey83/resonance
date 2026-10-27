import './AppsIntegrations.css';
import { urlBase } from '../../config';
import api from '../../lib/api';
import {
  ArrowRight,
  Cable,
  Download,
  Laptop,
  Monitor,
  Terminal,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const platforms = [
  {
    id: 'macos',
    name: 'macOS',
    detail: 'Apple silicon · .pkg installer',
    icon: Laptop,
    instruction:
      'Open the package, then launch Resonance Bridge from Applications.',
    file: 'resonance-bridge-macos.pkg',
  },
  {
    id: 'windows',
    name: 'Windows',
    detail: 'x64 · .exe setup',
    icon: Monitor,
    instruction: 'Run setup, then launch Resonance Bridge from the Start menu.',
    file: 'resonance-bridge-windows-setup.exe',
  },
  {
    id: 'linux',
    name: 'Linux',
    detail: 'Debian / Ubuntu · amd64 · .deb package',
    icon: Terminal,
    instruction:
      'Install the package with your software installer, then launch Resonance Bridge from your apps.',
    file: 'resonance-bridge-linux-amd64.deb',
  },
];

export const detectPlatform = (agent = '') => {
  if (/android|iphone|ipad|ipod/i.test(agent)) return null;
  if (/windows/i.test(agent)) return 'windows';
  if (/macintosh|mac os/i.test(agent)) return 'macos';
  if (/linux/i.test(agent)) return 'linux';
  return null;
};

const AppsIntegrations = () => {
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [retry, setRetry] = useState(0);
  const downloadRequest = useRef(null);
  const recommended = detectPlatform(navigator.userAgent);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError('');
    api
      .get('/bridge', { signal: request.signal })
      .then(({ data }) => {
        if (!request.signal.aborted)
          setAvailable(
            Array.isArray(data.helperPlatforms) ? data.helperPlatforms : [],
          );
      })
      .catch(() => {
        if (!request.signal.aborted)
          setError('Could not load Bridge downloads. Please try again.');
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [retry]);
  useEffect(() => () => downloadRequest.current?.abort(), []);

  const download = async (platform, filename) => {
    const request = new AbortController();
    downloadRequest.current = request;
    setBusy(platform);
    setError('');
    try {
      const { data } = await api.get(`/bridge/download?platform=${platform}`, {
        responseType: 'blob',
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      const address = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = address;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(address), 60_000);
    } catch {
      if (!request.signal.aborted)
        setError('The download could not be completed. Please try again.');
    } finally {
      if (!request.signal.aborted) setBusy(null);
    }
  };

  return (
    <main className="bridge-page">
      <header className="bridge-page-heading">
        <p className="bridge-eyebrow">RESONANCE</p>
        <h1>Apps &amp; integrations</h1>
        <p>Connect Resonance to the computers and devices you use.</p>
      </header>
      <section
        aria-labelledby="bridge-title"
        className="bridge-intro"
      >
        <div className="bridge-app-icon">
          <Cable
            aria-hidden="true"
            size={28}
          />
        </div>
        <div>
          <h2 id="bridge-title">Resonance Bridge</h2>
          <p>
            Your desktop companion for USB Export, Network Link and more. Bridge
            stays available in your menu bar or system tray.
          </p>
        </div>
        <span className="bridge-preview">Development release</span>
      </section>
      {loading && <p role="status">Loading installers from this instance…</p>}
      {error && (
        <div
          className="bridge-error"
          role="alert"
        >
          {error}{' '}
          <button
            onClick={() => setRetry((value) => value + 1)}
            type="button"
          >
            Reload downloads
          </button>
        </div>
      )}
      {!loading && !error && !available.length && (
        <p role="status">
          Bridge installers have not been published on this instance yet.
        </p>
      )}
      <div
        aria-label="Bridge installers"
        className="bridge-platforms"
      >
        {platforms.map(
          ({ detail, file, icon: Icon, id, instruction, name }) => (
            <section
              aria-labelledby={`bridge-${id}`}
              className={`bridge-platform bridge-platform-${id}`}
              key={id}
            >
              <div className="bridge-platform-heading">
                <Icon
                  aria-hidden="true"
                  size={25}
                />
                <h3 id={`bridge-${id}`}>{name}</h3>
              </div>
              <p className="bridge-platform-detail">{detail}</p>
              <div className="bridge-recommendation">
                {recommended === id && <span>Your operating system</span>}
              </div>
              <button
                className="bridge-download"
                disabled={loading || busy !== null || !available.includes(id)}
                onClick={() => download(id, file)}
                type="button"
              >
                <Download
                  aria-hidden="true"
                  size={16}
                />
                {busy === id ? 'Downloading…' : `Download for ${name}`}
              </button>
              {!loading && !error && !available.includes(id) && (
                <p className="bridge-unavailable">
                  Not available on this instance
                </p>
              )}
              <p>{instruction}</p>
              {id === 'macos' && (
                <p className="bridge-platform-note">
                  Requires an Apple silicon Mac. Intel Macs are not included in
                  this build.
                </p>
              )}
              {id === 'linux' && (
                <p className="bridge-platform-note">
                  The tray needs a StatusNotifier/AppIndicator host. GNOME may
                  need its AppIndicator extension.
                </p>
              )}
            </section>
          ),
        )}
      </div>
      <section
        aria-labelledby="bridge-setup"
        className="bridge-setup"
      >
        <h2 id="bridge-setup">Get connected</h2>
        <ol>
          <li>
            <strong>Install and open Bridge.</strong> Use the installer for your
            computer. Development installers are unsigned or not notarized.
          </li>
          <li>
            <strong>Connect your instance.</strong> In{' '}
            <Link to={`${urlBase}/networklink`}>Network Link</Link>, download a
            Bridge pairing file and open it with Bridge.
          </li>
          <li>
            <strong>Keep Bridge nearby.</strong> It starts quietly at sign-in.
            Turn this off using <em>Start at sign-in</em> in its menu.
          </li>
        </ol>
        <p>
          Bridge downloads signed software updates from its connected instance
          and installs them when idle. USB exports, library synchronization and
          active Network Link sessions defer installation. Network Link sharing
          starts only when you choose.
        </p>
        <p className="bridge-platform-note">
          Software updates currently need a library connection. Changes to the
          native macOS launcher still use an installer.
        </p>
        <div className="bridge-feature-links">
          <Link to={`${urlBase}/export`}>
            USB Export{' '}
            <ArrowRight
              aria-hidden="true"
              size={15}
            />
          </Link>
          <Link to={`${urlBase}/networklink`}>
            Network Link{' '}
            <ArrowRight
              aria-hidden="true"
              size={15}
            />
          </Link>
        </div>
      </section>
      <section
        aria-labelledby="mobile-apps-title"
        className="mobile-apps"
      >
        <h2 id="mobile-apps-title">Mobile apps</h2>
        <p>
          Resonance on your phone. Downloads will appear here when available.
        </p>
        <div className="mobile-app-platforms">
          {['iOS', 'Android'].map((platform) => (
            <section
              aria-labelledby={`mobile-${platform}`}
              className={`bridge-platform mobile-app-${platform.toLowerCase()}`}
              key={platform}
            >
              <div className="bridge-platform-heading">
                <h3 id={`mobile-${platform}`}>Resonance for {platform}</h3>
              </div>
              <div className="mobile-store-badge">
                <img
                  alt={
                    platform === 'iOS'
                      ? 'Download on the App Store'
                      : 'Get it on Google Play'
                  }
                  className={
                    platform === 'iOS' ? 'app-store-badge' : 'google-play-badge'
                  }
                  src={`${urlBase}/assets/store-badges/${platform === 'iOS' ? 'app-store.svg' : 'google-play.png'}`}
                />
              </div>
              <p className="mobile-app-status">Coming soon</p>
              <p>The {platform} app is not available to download yet.</p>
            </section>
          ))}
        </div>
      </section>
      <footer className="bridge-source">
        <span>Building for another platform?</span>
        <button
          disabled={loading || busy !== null || !available.includes('source')}
          onClick={() => download('source', 'resonance-bridge-source.zip')}
          type="button"
        >
          Download source &amp; build guide
        </button>
      </footer>
    </main>
  );
};

export default AppsIntegrations;
