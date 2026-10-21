// <copyright file="candidateAnalysis.test.js" company="John Narey">
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

import { candidateBeatWindow, candidateFeatureRows } from './candidateAnalysis';

describe('independent candidate semantics', () => {
  it('prefers the multi-interval tempo and flags inferred tempo variation', () => {
    expect.hasAssertions();
    const [row] = candidateFeatureRows({
      featureAvailability: { beats: 'available' },
      features: {
        beats: {
          result: {
            bpm_median_interval: 130.434,
            bpm_multi_interval: 128.342,
            tempo_variation_ratio: 1.6,
          },
        },
      },
    });
    expect(row.description).toContain('128.34 BPM');
    expect(row.description).toContain('variable inferred tempo');
    expect(row.description).not.toContain('130.434');
  });
  it('keeps unavailable values absent and genre scores as similarities', () => {
    expect.hasAssertions();
    const rows = candidateFeatureRows({
      featureAvailability: { genre: 'available', key: 'unavailable' },
      features: {
        genre: { result: { scores: [{ cosine: 0.9 }] } },
        key: { reason: 'Model missing' },
      },
    });
    expect(rows[0].description).toContain('not genre-class probabilities');
    expect(rows[1].description).toBe('Model missing');
  });
  it('uses independent explicit downbeats and hides stale output', () => {
    expect.hasAssertions();
    const response = {
      contentCurrent: true,
      analysis: {
        featureAvailability: { beats: 'available' },
        features: {
          beats: {
            result: {
              duration_seconds: 1,
              beats_seconds: [0.1, 1.1],
              downbeats_seconds: [1.1],
            },
          },
        },
      },
    };
    const grid = candidateBeatWindow(response);
    expect(grid.beats[0].downbeat).toBe(false);
    expect(grid.beats[1].downbeat).toBe(true);
    expect(grid.beats[1].x).toBe(1_000);
    expect(
      candidateBeatWindow({ ...response, contentCurrent: false }),
    ).toBeNull();
  });
  it('keeps semantic model predictions distinct from generic sections and explicitly experimental', () => {
    expect.hasAssertions();
    const rows = candidateFeatureRows({
      featureAvailability: {
        phrases: 'available',
        semanticPhrases: 'available',
      },
      features: {
        phrases: { result: { sections: [{ label: 'Section 1' }] } },
        semanticPhrases: {
          result: {
            engine: 'AllInOne-functional-segmentation',
            experimental: true,
            segments: [{ label: 'intro', start_seconds: 0, end_seconds: 30 }],
          },
        },
      },
    });
    expect(rows[0].description).toContain('generic candidate sections');
    expect(rows[1].description).toContain('experimental semantic segments');
    expect(rows[1].description).toContain('distribution differs');
  });
});

describe('genre suggestion ranking', () => {
  it('shows the three highest similarities without changing retained scores', () => {
    expect.hasAssertions();
    const scores = [
      { label: 'Pop', cosine: 0.1 },
      { label: 'Trance', cosine: 0.8 },
      { label: 'House', cosine: 0.6 },
      { label: 'Techno', cosine: 0.5 },
    ];
    const rows = candidateFeatureRows({
      featureAvailability: { genre: 'available' },
      features: { genre: { result: { scores } } },
    });
    expect(rows[0].description).toBe(
      'Trance · House · Techno; not genre-class probabilities',
    );
    expect(scores[0].label).toBe('Pop');
  });
});

describe('singing detector summaries', () => {
  it('distinguishes singing-model output from energy thresholds', () => {
    expect.hasAssertions();
    const rows = candidateFeatureRows({
      featureAvailability: { vocalPresence: 'available' },
      features: {
        vocalPresence: {
          result: { engine: 'CPJKU-zero-mean-singing-voice', segments: [] },
        },
      },
    });
    expect(rows[0].description).toContain(
      'experimental singing model; speech may be missed',
    );
    expect(rows[0].description).not.toContain('energy thresholds');
  });
});
