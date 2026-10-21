// <copyright file="KeyFormatToggle.jsx" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
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
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

import React from 'react';

const ROOT = {
  display: 'inline-flex',
  borderRadius: '5px',
  border: '1px solid var(--border)',
  overflow: 'hidden',
  flexShrink: 0,
};

const button = (active) => ({
  background: active ? 'var(--accent)' : 'none',
  border: 'none',
  color: active ? 'var(--on-accent, #fff)' : 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.03em',
  padding: '3px 8px',
  transition: 'background 0.15s, color 0.15s',
});

const KeyFormatToggle = ({ format, onChange }) => {
  return (
    <div
      style={ROOT}
      title="Key display format"
    >
      <button
        onClick={() => onChange('camelot')}
        style={button(format === 'camelot')}
        type="button"
      >
        Camelot
      </button>
      <button
        onClick={() => onChange('standard')}
        style={button(format === 'standard')}
        type="button"
      >
        Musical
      </button>
    </div>
  );
};

export default KeyFormatToggle;
