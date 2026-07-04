import { updateSoulseekCredentials } from '../lib/credentials';
import { getYaml, updateYaml } from '../lib/options';
import { connect, getApplicationState, getState } from '../lib/server';
import * as session from '../lib/session';
import { rescan as rescanShares } from '../lib/shares';
import FolderPicker from './Shared/FolderPicker';
import { CheckCircle, Headphones, Loader as LoaderIcon } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import YAML from 'yaml';

const STEP_ACCOUNT = 1;
const STEP_SOULSEEK = 2;
const STEP_DIRS = 3;

const STEP_LABELS = ['Account', 'Soulseek', 'Directories'];

const waitForConnection = () =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + 20_000;
    const attempt = async () => {
      try {
        const state = await getState();
        if (state.isConnected) {
          resolve();
        } else if (Date.now() > deadline) {
          reject(
            new Error(
              'Connection timed out — check your credentials and try again.',
            ),
          );
        } else {
          setTimeout(attempt, 2_000);
        }
      } catch {
        reject(
          new Error('Could not reach the backend to check connection status.'),
        );
      }
    };

    setTimeout(attempt, 1_500);
  });

const StepIndicator = ({ current }) => (
  <div className="wizard-steps">
    {STEP_LABELS.map((label, index) => {
      const stepNumber = index + 1;
      const isDone = stepNumber < current;
      const isActive = stepNumber === current;
      return (
        <div
          className={`wizard-step${isActive ? ' wizard-step--active' : ''}${isDone ? ' wizard-step--done' : ''}`}
          key={label}
        >
          <div className="wizard-step-circle">
            {isDone ? <CheckCircle size={14} /> : stepNumber}
          </div>
          <span className="wizard-step-label">{label}</span>
          {index < STEP_LABELS.length - 1 && (
            <div className="wizard-step-connector" />
          )}
        </div>
      );
    })}
  </div>
);

// ── Step 1: App account ───────────────────────────────────────────────────────

const StepAccount = ({ onDone }) => {
  const usernameRef = useRef();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [confirm, setConfirm] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const mismatch = confirm.length > 0 && confirm !== password;
  const ready =
    username.length > 0 &&
    password.length > 0 &&
    password === confirm &&
    !loading;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      await session.setup({ password, username });
      onDone();
    } catch (caughtError) {
      setError(caughtError.message ?? String(caughtError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="auth-heading">Create your account</div>
      <div className="auth-sub">
        These are your <strong>app</strong> login credentials — not your
        Soulseek account. You will add your Soulseek username and password in
        the next step.
      </div>
      <form
        className="auth-form"
        onSubmit={handleSubmit}
      >
        <div className="auth-field">
          <label
            className="auth-label"
            htmlFor="setup-username"
          >
            Username
          </label>
          <input
            autoComplete="username"
            className="auth-input"
            disabled={loading}
            id="setup-username"
            onChange={(event) => setUsername(event.target.value)}
            ref={usernameRef}
            type="text"
            value={username}
          />
        </div>
        <div className="auth-field">
          <label
            className="auth-label"
            htmlFor="setup-password"
          >
            Password
          </label>
          <input
            autoComplete="new-password"
            className="auth-input"
            disabled={loading}
            id="setup-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </div>
        <div className="auth-field">
          <label
            className="auth-label"
            htmlFor="setup-confirm"
          >
            Confirm Password
          </label>
          <input
            autoComplete="new-password"
            className={`auth-input${mismatch ? ' auth-input--error' : ''}`}
            disabled={loading}
            id="setup-confirm"
            onChange={(event) => setConfirm(event.target.value)}
            type="password"
            value={confirm}
          />
          {mismatch && (
            <div className="auth-field-error">Passwords do not match</div>
          )}
        </div>
        {error && <div className="auth-error">{error}</div>}
        <button
          className="auth-submit hover-fx"
          disabled={!ready}
          type="submit"
        >
          {loading ? 'Creating account…' : 'Continue'}
        </button>
      </form>
    </>
  );
};

// ── Step 2: Soulseek credentials ──────────────────────────────────────────────

const StepSoulseek = ({ onDone }) => {
  const usernameRef = useRef();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const canTest = username.length > 0 && password.length > 0 && !testing;

  const handleTest = async () => {
    setTesting(true);
    setTestError(null);
    setTested(false);
    try {
      await updateSoulseekCredentials({ username, password });
      await connect();
      await waitForConnection();
      setTested(true);
    } catch (caughtError) {
      setTestError(caughtError.message ?? String(caughtError));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="auth-heading">Soulseek account</div>
      <div className="auth-sub">
        Enter your Soulseek network credentials. These are separate from your
        app login. Test the connection to verify before continuing.
      </div>
      <div className="auth-sub">
        Don&rsquo;t have an account yet? Just pick a username and password and
        hit <strong>Test Connection</strong> — if the username isn&rsquo;t
        taken, the Soulseek server will create it for you automatically.
        Soulseek also offers an optional paid membership with perks like
        priority in upload queues, but a free account is all you need to get
        started.
      </div>
      <form
        className="auth-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="auth-field">
          <label
            className="auth-label"
            htmlFor="slsk-username"
          >
            Soulseek Username
          </label>
          <input
            autoComplete="off"
            className="auth-input"
            disabled={testing}
            id="slsk-username"
            onChange={(event) => {
              setUsername(event.target.value);
              setTested(false);
            }}
            ref={usernameRef}
            type="text"
            value={username}
          />
        </div>
        <div className="auth-field">
          <label
            className="auth-label"
            htmlFor="slsk-password"
          >
            Soulseek Password
          </label>
          <input
            autoComplete="off"
            className="auth-input"
            disabled={testing}
            id="slsk-password"
            onChange={(event) => {
              setPassword(event.target.value);
              setTested(false);
            }}
            type="password"
            value={password}
          />
        </div>

        {testError && <div className="auth-error">{testError}</div>}

        {tested && (
          <div className="auth-success">
            <CheckCircle size={14} />
            Connected successfully as <strong>{username}</strong>
          </div>
        )}

        <div className="auth-button-row">
          <button
            className="auth-submit auth-submit--secondary hover-fx"
            disabled={!canTest}
            onClick={handleTest}
            type="button"
          >
            {testing ? (
              <>
                <LoaderIcon
                  className="auth-spinner"
                  size={14}
                />
                Testing…
              </>
            ) : (
              'Test Connection'
            )}
          </button>
          <button
            className="auth-submit hover-fx"
            disabled={!tested}
            onClick={onDone}
            type="button"
          >
            Continue
          </button>
        </div>
      </form>
    </>
  );
};

// ── Step 3: Directories ───────────────────────────────────────────────────────

const waitForScan = (onProgress, cancelRef) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + 5 * 60_000;
    let seenScanning = false;
    let consecutiveErrors = 0;
    const attempt = async () => {
      if (cancelRef?.current) return;
      try {
        const state = await getApplicationState();
        if (cancelRef?.current) return;
        consecutiveErrors = 0;
        const {
          directories,
          faulted,
          files,
          scanPending,
          scanProgress,
          scanning,
        } = state.shares ?? {};

        onProgress?.({ directories, files, scanProgress, scanning });

        if (faulted) {
          resolve(state.shares);
          return;
        }

        if (scanning) seenScanning = true;
        if ((seenScanning || !scanPending) && !scanning && !scanPending) {
          resolve(state.shares);
        } else if (Date.now() > deadline) {
          reject(new Error('Share scan timed out.'));
        } else {
          setTimeout(attempt, 1_000);
        }
      } catch {
        if (cancelRef?.current) return;
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) {
          reject(new Error('Could not reach the server to check scan status.'));
        } else {
          setTimeout(attempt, 2_000);
        }
      }
    };

    setTimeout(attempt, 1_000);
  });

let nextShareId = 0;

const StepDirectories = ({ onDone }) => {
  const [downloadDirectory, setDownloadDirectory] = useState('');
  const [shareDirectories, setShareDirectories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({
    directories: 0,
    files: 0,
    scanProgress: 0,
  });
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(null); // { type: 'download' | 'share', index?: number }
  const isMountedRef = useRef(true);
  const cancelRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    cancelRef.current = false;
    return () => {
      isMountedRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  const addShareDirectory = () => {
    const id = nextShareId++;
    setShareDirectories((previous) => [...previous, { id, path: '' }]);
  };

  const removeShareDirectory = (targetId) =>
    setShareDirectories((previous) =>
      previous.filter(({ id }) => id !== targetId),
    );
  const updateShareDirectory = (targetId, value) =>
    setShareDirectories((previous) =>
      previous.map((entry) =>
        entry.id === targetId ? { ...entry, path: value } : entry,
      ),
    );

  const handlePickerSelect = (path) => {
    if (picker.type === 'download') {
      setDownloadDirectory(path);
    } else {
      updateShareDirectory(picker.id, path);
    }

    setPicker(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const yamlText = await getYaml();
      const config = YAML.parse(yamlText) ?? {};
      if (downloadDirectory) {
        config.directories = {
          ...config.directories,
          downloads: downloadDirectory,
        };
      }

      const filteredShares = shareDirectories
        .map(({ path }) => path)
        .filter(Boolean);
      if (filteredShares.length > 0) {
        config.shares = { ...config.shares, directories: filteredShares };
      }

      await updateYaml({
        yaml: YAML.stringify(config, {
          simpleKeys: true,
          sortMapEntries: false,
        }),
      });

      if (filteredShares.length > 0) {
        setLoading(false);
        setScanning(true);
        // Wait for the filesystem watcher to reload the config before scanning
        await new Promise((resolve) => {
          setTimeout(resolve, 1_500);
        });
        try {
          await rescanShares();
        } catch (rescanError) {
          // 409 means a scan is already running — that's fine, just wait for it
          if (rescanError?.response?.status !== 409) throw rescanError;
        }

        const result = await waitForScan((progress) => {
          if (isMountedRef.current) setScanProgress(progress);
        }, cancelRef);
        if (isMountedRef.current) {
          setScanResult(result);
          setScanning(false);
        }
      } else {
        onDone();
      }
    } catch (caughtError) {
      if (isMountedRef.current) {
        setError(caughtError.message ?? String(caughtError));
        setLoading(false);
        setScanning(false);
      }
    }
  };

  if (scanning) {
    const pct = Math.round((scanProgress.scanProgress ?? 0) * 100);
    return (
      <>
        <div className="auth-heading">Scanning shared folders</div>
        <div className="auth-sub">
          Indexing your files so other users can find them. This may take a
          moment depending on how many files you have.
        </div>
        <div className="setup-scan-progress">
          <div className="setup-scan-bar-track">
            <div
              className="setup-scan-bar-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="setup-scan-stats">
            <span className="setup-scan-stat">
              <span className="setup-scan-stat-value">
                {(scanProgress.files ?? 0).toLocaleString()}
              </span>
              <span className="setup-scan-stat-label">files</span>
            </span>
            <span className="setup-scan-stat-sep" />
            <span className="setup-scan-stat">
              <span className="setup-scan-stat-value">
                {(scanProgress.directories ?? 0).toLocaleString()}
              </span>
              <span className="setup-scan-stat-label">directories</span>
            </span>
            <span className="setup-scan-spinner">
              <LoaderIcon
                className="auth-spinner"
                size={13}
              />
            </span>
          </div>
        </div>
      </>
    );
  }

  if (scanResult) {
    return (
      <>
        <div className="auth-heading">All done!</div>
        <div className="auth-sub">
          Your shares have been indexed and you&rsquo;re ready to go.
        </div>
        <div className="auth-success setup-scan-result">
          <CheckCircle size={16} />
          Found {scanResult.files?.toLocaleString() ?? 0} files in{' '}
          {scanResult.directories?.toLocaleString() ?? 0} directories
        </div>
        {error && <div className="auth-error">{error}</div>}
        <button
          className="auth-submit hover-fx"
          onClick={onDone}
          type="button"
        >
          Go to Resonance
        </button>
      </>
    );
  }

  return (
    <>
      {picker && (
        <FolderPicker
          onCancel={() => setPicker(null)}
          onSelect={handlePickerSelect}
          title={
            picker.type === 'download'
              ? 'Select download folder'
              : 'Select share folder'
          }
        />
      )}

      <div className="auth-heading">Directories</div>
      <div className="auth-sub">
        Set where downloads are saved and which folders to share with other
        users. You can change these later in Settings.
      </div>
      <form
        className="auth-form"
        onSubmit={handleSubmit}
      >
        <div className="auth-field">
          <label
            className="auth-label"
            htmlFor="dir-downloads"
          >
            Download Directory
          </label>
          <div className="auth-input-row">
            <input
              className="auth-input"
              disabled={loading}
              id="dir-downloads"
              onChange={(event) => setDownloadDirectory(event.target.value)}
              placeholder="/home/user/downloads"
              type="text"
              value={downloadDirectory}
            />
            <button
              className="auth-browse-btn hover-fx"
              disabled={loading}
              onClick={() => setPicker({ type: 'download' })}
              type="button"
            >
              Browse…
            </button>
          </div>
        </div>

        <div className="auth-field">
          <div className="auth-label">Share Directories</div>
          <div className="auth-share-hint">
            Sharing is what keeps the Soulseek community alive. Many users
            won&rsquo;t transfer to accounts with nothing shared — add at least
            one folder to get the best experience.
          </div>
          {shareDirectories.map(({ id, path }) => (
            <div
              className="auth-input-row"
              key={id}
            >
              <input
                className="auth-input"
                disabled={loading}
                onChange={(event) =>
                  updateShareDirectory(id, event.target.value)
                }
                placeholder="/home/user/music"
                type="text"
                value={path}
              />
              <button
                className="auth-browse-btn"
                disabled={loading}
                onClick={() => setPicker({ id, type: 'share' })}
                type="button"
              >
                Browse…
              </button>
              <button
                className="auth-remove-btn"
                disabled={loading}
                onClick={() => removeShareDirectory(id)}
                type="button"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="auth-add-dir-btn hover-fx"
            disabled={loading}
            onClick={addShareDirectory}
            type="button"
          >
            + Add folder
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}
        <button
          className="auth-submit hover-fx"
          disabled={loading}
          type="submit"
        >
          {loading ? 'Saving…' : 'Finish Setup'}
        </button>
      </form>
    </>
  );
};

// ── Wizard shell ──────────────────────────────────────────────────────────────

const Setup = ({ initialStep = STEP_ACCOUNT, onComplete }) => {
  const [step, setStep] = useState(initialStep);

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card--wide">
        <div className="auth-brand">
          <Headphones
            size={28}
            strokeWidth={1.5}
          />
          <span className="auth-brand-name">Resonance</span>
        </div>

        <StepIndicator current={step} />

        {step === STEP_ACCOUNT && (
          <StepAccount onDone={() => setStep(STEP_SOULSEEK)} />
        )}
        {step === STEP_SOULSEEK && (
          <StepSoulseek onDone={() => setStep(STEP_DIRS)} />
        )}
        {step === STEP_DIRS && <StepDirectories onDone={onComplete} />}
      </div>
    </div>
  );
};

export default Setup;
