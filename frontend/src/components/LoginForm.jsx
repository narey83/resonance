// <copyright file="LoginForm.jsx" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import ResonanceMark from './Shared/ResonanceMark';
import React, { useEffect, useRef, useState } from 'react';

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
              Your music, ready to stream
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
