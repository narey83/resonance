// <copyright file="usePagedList.test.js" company="John Narey">
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

import { usePagedList } from './usePagedList';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

const TOTAL = 10;

// Renders the hook's items as text, and records every value it has ever shown so a test can
// assert on what happened between two states, not just where it ended up.
const makeProbe = (seen) => {
  const Probe = ({ fetchPage, refreshToken }) => {
    const { items } = usePagedList(
      fetchPage,
      { folder: '/TECHNO ZONE' },
      { pageSize: 2, refreshToken },
    );
    const rendered = items.map((index_) => index_.label).join(',');
    seen.push(rendered);
    return React.createElement('div', null, rendered);
  };

  return Probe;
};

describe('usePagedList', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  // The analysis writes BPM and key into a track's tags, so rows already on screen are stale the
  // moment it finishes. The library broadcasts an update, which bumps refreshToken — the hook has
  // to re-read the window it holds *in place*. Emptying it first would collapse a folder back to
  // its first page and lose the user's place, which is the whole reason this path exists.
  it('refetches the loaded window in place when the refresh token changes', async () => {
    expect.assertions(4);
    const seen = [];
    const Probe = makeProbe(seen);
    const calls = [];
    let label = 'stale';

    const fetchPage = (query) => {
      calls.push(query);
      return Promise.resolve({
        items: Array.from({ length: query.limit }, (_, index) => ({
          label: `${label}${query.offset + index}`,
        })),
        total: TOTAL,
      });
    };

    await act(async () => {
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 0 }),
        container,
      );
    });
    expect(container.textContent).toBe('stale0,stale1');

    label = 'fresh';
    await act(async () => {
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 1 }),
        container,
      );
    });

    // The refetch asks for exactly what is already loaded, from the top.
    expect(calls.at(-1)).toEqual({
      folder: '/TECHNO ZONE',
      limit: 2,
      offset: 0,
    });
    expect(container.textContent).toBe('fresh0,fresh1');

    // Nothing was ever blanked after the first load — that blank is what costs scroll position.
    expect(seen.slice(seen.indexOf('stale0,stale1'))).not.toContain('');
  });

  it('does not refetch when nothing is loaded yet', async () => {
    expect.assertions(1);
    const seen = [];
    const Probe = makeProbe(seen);
    const calls = [];
    const fetchPage = (query) => {
      calls.push(query);
      return Promise.resolve({ items: [], total: 0 });
    };

    await act(async () => {
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 0 }),
        container,
      );
    });
    const before = calls.length;

    await act(async () => {
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 1 }),
        container,
      );
    });

    expect(calls).toHaveLength(before);
  });
});
