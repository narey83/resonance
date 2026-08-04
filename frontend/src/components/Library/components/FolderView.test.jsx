// <copyright file="FolderView.test.jsx" company="John Narey">
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

import FolderView from './FolderView';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

// The folder grid and the track table are both heavy (virtualised, networked); this file only
// cares about which of the two FolderView chooses to render, so both are reduced to markers.
jest.mock('./TrackTable', () => ({
  __esModule: true,
  default: () => <div data-testid="track-table" />,
}));

jest.mock('./AlbumArt', () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock('../../../lib/usePagedList', () => ({
  __esModule: true,
  usePagedTracks: () => ({
    alphaApplies: true,
    clearLetter: () => {},
    isDefaultView: true,
    letter: null,
    reset: () => {},
    total: 1,
    trackTableProps: { tracks: [] },
  }),
}));

jest.mock('@tanstack/react-virtual', () => ({
  __esModule: true,
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    scrollToIndex: () => {},
  }),
}));

const FOLDER = {
  name: 'TECHNO ZONE',
  path: '/downloads/TECHNO ZONE',
  trackCount: 4_000,
};

const render = (container, properties) =>
  act(() => {
    ReactDOM.render(
      <FolderView
        folders={[FOLDER]}
        initialFolder={FOLDER.path}
        loading={false}
        onPlayFolder={() => {}}
        removedPaths={new Set()}
        {...properties}
      />,
      container,
    );
  });

describe('FolderView', () => {
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

  // Analysing a big folder rewrites every track's tags, the watcher notices and the library
  // broadcasts an update, and Library empties `folders` to force a refetch. If that empty list
  // tears the open folder down, the TrackTable unmounts and the user loses their scroll
  // position — which is what made analysing TECHNO ZONE jump back to the top over and over.
  it('keeps an open folder mounted while the folder list is empty or reloading', () => {
    render(container);
    expect(
      container.querySelector('[data-testid="track-table"]'),
    ).not.toBeNull();

    render(container, { folders: [] });
    expect(
      container.querySelector('[data-testid="track-table"]'),
    ).not.toBeNull();

    render(container, { folders: [], loading: true });
    expect(
      container.querySelector('[data-testid="track-table"]'),
    ).not.toBeNull();
  });

  // The guards still have to do their job before anything is open, otherwise the view renders
  // an empty grid instead of saying why.
  it('still reports an empty folder list when nothing is open', () => {
    render(container, { folders: [], initialFolder: null });
    expect(container.querySelector('[data-testid="track-table"]')).toBeNull();
    expect(container.textContent).toContain('No folders found');
  });
});
