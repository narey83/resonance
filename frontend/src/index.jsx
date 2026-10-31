// <copyright file="index.jsx" company="JP Dillingham">
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

import 'semantic-ui-less/semantic.less';
import App from './components/App';
import FrontendHealthBoundary from './components/FrontendHealthBoundary';
import { postLog } from './lib/logs';
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter as Router } from 'react-router-dom';

const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  originalConsoleError(...args);
  postLog('error', ...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  originalConsoleWarn(...args);
  postLog('warn', ...args);
};

window.addEventListener('unhandledrejection', (event) => {
  postLog('error', event.reason ?? 'Unhandled promise rejection');
});

window.addEventListener('error', (event) => {
  if (event.message?.includes('ResizeObserver loop')) {
    event.stopImmediatePropagation();
    return;
  }

  postLog('error', event.error ?? event.message ?? 'Unknown error');
});

ReactDOM.render(
  <FrontendHealthBoundary>
    <Router>
      <App />
    </Router>
  </FrontendHealthBoundary>,
  document.querySelector('#root'),
);
