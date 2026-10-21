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
  const Probe = ({ enabled = true, fetchPage, refreshToken }) => {
    const { items } = usePagedList(
      fetchPage,
      { folder: '/TECHNO ZONE' },
      { enabled, pageSize: 2, refreshToken },
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
    sessionStorage.clear();
  });

  it('fills an initially empty smart crate when the library changes', async () => {
    expect.assertions(3);
    const Probe = makeProbe([]);
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValue({ items: [{ label: 'New arrival' }], total: 1 });
    await act(async () =>
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 0 }),
        container,
      ),
    );
    expect(container.textContent).toBe('');
    await act(async () =>
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 1 }),
        container,
      ),
    );
    expect(container.textContent).toBe('New arrival');
    expect(fetchPage.mock.calls.at(-1)[0].limit).toBeGreaterThan(0);
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

  it('does not fetch disabled views when the library changes', async () => {
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
        React.createElement(Probe, {
          enabled: false,
          fetchPage,
          refreshToken: 0,
        }),
        container,
      );
    });
    const before = calls.length;

    await act(async () => {
      ReactDOM.render(
        React.createElement(Probe, {
          enabled: false,
          fetchPage,
          refreshToken: 1,
        }),
        container,
      );
    });

    expect(calls).toHaveLength(before);
  });

  // A library update that landed while a fetch was in flight used to be dropped on the spot,
  // with nothing to retry it — so the broadcast carrying the last analysed track's key, BPM and
  // loudness left the list showing the pre-analysis rows until the view was remounted.
  it('still refetches when the refresh token arrives mid-fetch', async () => {
    expect.assertions(2);
    const seen = [];
    const Probe = makeProbe(seen);
    const calls = [];
    let label = 'stale';
    let releaseFirst;
    const firstFetch = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    // Only the first call is gated; every later one resolves straight away
    // (Promise.resolve(undefined)), which keeps the gating out of the test's own control flow.
    const gates = [firstFetch];

    const fetchPage = async (query) => {
      calls.push(query);
      const tag = label;
      await Promise.resolve(gates[calls.length - 1]);
      return {
        items: Array.from({ length: query.limit }, (_, index) => ({
          label: `${tag}${query.offset + index}`,
        })),
        total: TOTAL,
      };
    };

    await act(async () => {
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 0 }),
        container,
      );
    });

    // The analysis finishes while that first page is still on the wire.
    await act(async () => {
      ReactDOM.render(
        React.createElement(Probe, { fetchPage, refreshToken: 1 }),
        container,
      );
    });

    label = 'fresh';
    await act(async () => {
      releaseFirst();
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
    });

    expect(calls).toHaveLength(2);
    expect(container.textContent).toBe('fresh0,fresh1');
  });

  // Leaving a view and coming back (the library tab switch) remounts the hook with the same
  // query. Without this, it always asks for one page, the list is too short to hold the
  // scroll offset the user left at, and Library.jsx's restore code clamps to the top.
  it('requests as many rows as were loaded last time for the same query', async () => {
    expect.assertions(1);
    sessionStorage.setItem(
      'resonance-paged-count:{"folder":"/TECHNO ZONE"}',
      '6',
    );
    const seen = [];
    const Probe = makeProbe(seen);
    const calls = [];
    const fetchPage = (query) => {
      calls.push(query);
      return Promise.resolve({
        items: Array.from({ length: query.limit }, (_, index) => ({
          label: `row${query.offset + index}`,
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

    expect(calls[0]).toEqual({
      folder: '/TECHNO ZONE',
      limit: 6,
      offset: 0,
    });
  });
});
