import React, { useEffect, useRef, useState } from 'react';

const ResonanceMark = ({ size = 48 }) => (
  <svg
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="12"
      cy="12"
      r="8"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M4 12 C6 6.5 10 6.5 12 12 C14 17.5 18 17.5 20 12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
    />
  </svg>
);

const LoginForm = ({ error, loading, onLoginAttempt }) => {
  const usernameRef = useRef();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    usernameRef.current?.focus();
  }, [loading]);

  const ready = username.length > 0 && password.length > 0 && !loading;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (ready) onLoginAttempt(username, password, rememberMe);
  };

  return (
    <div className="auth-shell">
      <div className="auth-split">
        {/* ── Left brand panel ── */}
        <div className="auth-brand-panel">
          <div className="auth-brand-panel-inner">
            <div className="auth-brand-logo">
              <ResonanceMark size={56} />
            </div>
            <div className="auth-brand-title">Resonance</div>
            <div className="auth-brand-tagline">
              Your personal Soulseek client
            </div>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="auth-form-panel">
          <div className="auth-form-inner">
            <div className="auth-heading">Welcome back</div>
            <div className="auth-sub">Sign in to your account to continue.</div>

            <form
              className="auth-form"
              onSubmit={handleSubmit}
            >
              <div className="auth-field">
                <label
                  className="auth-label"
                  htmlFor="login-username"
                >
                  Username
                </label>
                <input
                  autoComplete="username"
                  className="auth-input"
                  disabled={loading}
                  id="login-username"
                  onChange={(event) => setUsername(event.target.value)}
                  ref={usernameRef}
                  type="text"
                  value={username}
                />
              </div>

              <div className="auth-field">
                <label
                  className="auth-label"
                  htmlFor="login-password"
                >
                  Password
                </label>
                <input
                  autoComplete="current-password"
                  className="auth-input"
                  disabled={loading}
                  id="login-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </div>

              <label className="auth-remember">
                <input
                  checked={rememberMe}
                  disabled={loading}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  type="checkbox"
                />
                <span>Keep me signed in</span>
              </label>

              {error && (
                <div className="auth-error">
                  {error?.response?.status === 401
                    ? 'Incorrect username or password.'
                    : error?.response?.status === 429
                      ? 'Too many failed attempts. Try again in a few minutes.'
                      : error.message ?? String(error)}
                </div>
              )}

              <button
                className="auth-submit hover-fx"
                disabled={!ready}
                type="submit"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div
              className="auth-legal"
              style={{
                borderTop: '1px solid rgba(128,128,128,0.2)',
                fontSize: 11,
                lineHeight: 1.5,
                marginTop: 24,
                opacity: 0.6,
                paddingTop: 16,
              }}
            >
              Resonance is a modified version of{' '}
              <a
                href="https://github.com/slskd/slskd"
                rel="noreferrer"
                target="_blank"
              >
                slskd
              </a>
              . It is not maintained by, endorsed by, or affiliated with the
              slskd project or its author(s). Licensed under{' '}
              <a
                href="https://www.gnu.org/licenses/agpl-3.0.html"
                rel="noreferrer"
                target="_blank"
              >
                AGPL-3.0
              </a>{' '}
              with additional terms.{' '}
              <a
                href="https://github.com/narey83/resonance"
                rel="noreferrer"
                target="_blank"
              >
                Source code
              </a>
              .
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
