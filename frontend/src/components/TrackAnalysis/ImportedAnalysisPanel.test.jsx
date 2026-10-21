// <copyright file="ImportedAnalysisPanel.test.jsx" company="John Narey">
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

import api from '../../lib/api';
import ImportedAnalysisPanel from './ImportedAnalysisPanel';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({ get: jest.fn() }));
const source = {
  collectionSha256: 'a'.repeat(64),
  sourceTrackId: 'fixture',
  importedAt: '2026-10-14T00:00:00Z',
};
const snapshot = {
  contentCurrent: true,
  collectionSha256: source.collectionSha256,
  documentSha256: 'b'.repeat(64),
  analysis: {
    source: 'Explicit synthetic UI fixture',
    trackId: 'fixture',
    durationSeconds: 10,
    bpm: 128.5,
    key: 'Gm',
    beats: [
      { timeSeconds: 0.1, beatInBar: 2, bpm: 100 },
      { timeSeconds: 0.7, beatInBar: 3, bpm: 120 },
    ],
    downbeatsSeconds: [0.7],
    energyModelValue: 0,
    genreClassId: 0,
    genreFamilyLabel: 'Test family',
    vocals: { frameStepSeconds: 0.5, levels: [0, 1, 2, 3, 4] },
    phrases: {
      entries: [
        {
          index: 1,
          label: 'INTRO 1',
          startSecondsCandidate: 0.1,
          startBeatCandidate: 1,
          nextBoundaryBeatCandidate: 4,
        },
      ],
    },
    positionMarks: [
      {
        attributes: { Name: 'Synthetic loop' },
        typeName: 'loop',
        slotKind: 'hot',
        typed: { Num: 0, Start: 1.2, End: 2.3 },
      },
    ],
    waveforms: { PWV7: { points: [[1, 2, 3]], pointsPerSecond: 150 } },
    embedding: {
      track: Array.from({ length: 64 }).fill(0),
      projection2d: [0, 1],
      chunks: [Array.from({ length: 64 }).fill(0)],
    },
    featureAvailability: { vocals: 'available', phrases: 'available' },
  },
};
describe('ImportedAnalysisPanel', () => {
  let container;
  beforeEach(() => {
    api.get.mockReset();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (path = 'fixture.mp3') => {
    await act(async () => {
      ReactDOM.render(<ImportedAnalysisPanel path={path} />, container);
    });
  };

  const choose = async () => {
    await act(async () => {
      Simulate.change(container.querySelector('select'), {
        target: { value: source.collectionSha256 },
      });
    });
  };

  it('selects an import and renders exact source timings and all retained feature summaries', async () => {
    expect.hasAssertions();
    api.get
      .mockResolvedValueOnce({ data: [source] })
      .mockResolvedValueOnce({ data: snapshot });
    await render();
    expect(container.querySelector('option:last-child').textContent).toContain(
      'Rekordbox import',
    );
    expect(container.querySelector('input')).toBeNull();
    await choose();
    const lines = container.querySelectorAll(
      'svg[aria-label="Imported beats and explicit downbeats"] line',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('class')).toBe('imported-beat');
    expect(lines[1].getAttribute('class')).toBe('imported-downbeat');
    for (const text of [
      '128.5',
      'Test family',
      '64D track; 2D projection; 1 chunks',
      'INTRO 1',
      'Synthetic loop',
      'final boundary inclusivity remains unresolved',
    ])
      expect(container.textContent).toContain(text);
    expect(
      container.querySelectorAll(
        'svg[aria-label="Imported vocal activity bins"] rect',
      ),
    ).toHaveLength(5);
  });
  it('stale source keeps metadata but hides beat and vocal overlays', async () => {
    expect.hasAssertions();
    api.get
      .mockResolvedValueOnce({ data: [source] })
      .mockResolvedValueOnce({ data: { ...snapshot, contentCurrent: false } });
    await render();
    await choose();
    expect(container.textContent).toContain(
      'Audio changed: imported grid hidden',
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('Synthetic loop');
  });
  it('late source response cannot attach to a different selected track', async () => {
    expect.hasAssertions();
    let resolveOld;
    api.get.mockResolvedValueOnce({ data: [source] }).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render();
    act(() => {
      Simulate.change(container.querySelector('select'), {
        target: { value: source.collectionSha256 },
      });
    });
    api.get.mockResolvedValueOnce({ data: [] });
    await render('different.mp3');
    await act(async () => {
      resolveOld({ data: snapshot });
    });
    expect(container.textContent).not.toContain('Synthetic loop');
    expect(container.querySelector('svg')).toBeNull();
  });
});
