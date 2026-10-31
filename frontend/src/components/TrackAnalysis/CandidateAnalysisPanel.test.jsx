// <copyright file="CandidateAnalysisPanel.test.jsx" company="John Narey">
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
import CandidateAnalysisPanel from './CandidateAnalysisPanel';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({ get: jest.fn(), post: jest.fn() }));
const job = {
  jobId: 'a'.repeat(32),
  status: 'completed-with-gaps',
  createdAt: '2026-10-14T00:00:00Z',
  requestedSeconds: 30,
};
const result = {
  job,
  contentCurrent: true,
  analysis: {
    sourceKind: 'independent-candidate',
    scope: { fullTrack: false, requestedSeconds: 30 },
    durationSeconds: 30,
    featureAvailability: {
      beats: 'available',
      key: 'available',
      stems: 'unavailable',
      cues: 'available',
      structure: 'available',
    },
    features: {
      beats: {
        status: 'available',
        result: {
          engine: 'BeatThis',
          duration_seconds: 30,
          beats_seconds: [0.2, 0.8],
          downbeats_seconds: [0.8],
          bpm_median_interval: 100,
        },
      },
      key: { status: 'available', result: { engine: 'Essentia', key: 'Gm' } },
      stems: {
        status: 'unavailable',
        reason: 'Explicit local checkpoint missing',
      },
      cues: {
        status: 'available',
        result: { cueProposals: [{ seconds: 0.2 }] },
      },
      structure: {
        status: 'available',
        result: {
          experimental: true,
          sections: [{ label: 'Section 1', start_seconds: 0, end_seconds: 30 }],
          cue_proposals: [{ seconds: 0.2, reason: 'Candidate' }],
        },
      },
    },
    limitations: ['Independent engines; differences expected'],
    provenance: { syntheticFixture: true },
  },
};
describe('CandidateAnalysisPanel', () => {
  let container;
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (path = 'track.flac') => {
    await act(async () => {
      ReactDOM.render(<CandidateAnalysisPanel path={path} />, container);
    });
  };

  const button = (label) =>
    [...container.querySelectorAll('button')].find(
      (node) => node.textContent === label,
    );
  it('generates only after explicit action and reads a separate candidate with gaps and experimental proposals', async () => {
    expect.hasAssertions();
    api.get
      .mockResolvedValueOnce({ data: { enabled: true, jobs: [] } })
      .mockResolvedValueOnce({ data: { enabled: true, jobs: [job] } })
      .mockResolvedValueOnce({ data: result });
    api.post.mockResolvedValue({ data: { job } });
    await render();
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => {
      Simulate.click(button('Generate candidate'));
    });
    expect(api.post.mock.calls[0][0]).toBe('/analysis/candidates');
    expect(api.post.mock.calls[0][1]).toEqual({
      path: 'track.flac',
      seconds: 30,
      features: [
        'beats',
        'key',
        'waveform',
        'energy',
        'loudness',
        'embedding',
        'structure',
        'phrases',
      ],
    });
    expect(container.textContent).toContain(
      'Explicit local checkpoint missing',
    );
    expect(container.textContent).toContain('experimental proposals');
    expect(container.textContent).toContain('Existing analysis is unchanged');
    const lines = container.querySelectorAll('svg line');
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('class')).toBe('candidate-beat');
    expect(lines[1].getAttribute('class')).toBe('candidate-downbeat');
  });
  it('source changes abort the owned request and ignore its late response', async () => {
    expect.hasAssertions();
    let resolveOld;
    api.get.mockResolvedValueOnce({ data: { enabled: true, jobs: [] } });
    api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render();
    act(() => {
      Simulate.click(button('Generate candidate'));
    });
    const signal = api.post.mock.calls[0][2].signal;
    api.get.mockResolvedValueOnce({ data: { enabled: true, jobs: [] } });
    await render('different.flac');
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveOld({ data: { job } });
    });
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).not.toContain('Candidate job: completed');
  });
  it('cancellation is explicit and leaves existing analysis unchanged', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValueOnce({ data: { enabled: true, jobs: [] } });
    api.post.mockImplementationOnce(
      (_url, _body, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('cancelled')),
          );
        }),
    );
    await render();
    act(() => {
      Simulate.click(button('Generate candidate'));
    });
    await act(async () => {
      Simulate.click(button('Cancel generation'));
    });
    expect(container.textContent).toContain('Generation cancelled');
    expect(button('Generate candidate').disabled).toBe(false);
  });
  it('reports worker request errors without a fabricated result', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValueOnce({ data: { enabled: true, jobs: [] } });
    api.post.mockRejectedValueOnce(new Error('worker unavailable'));
    await render();
    await act(async () => {
      Simulate.click(button('Generate candidate'));
    });
    expect(container.textContent).toContain('Candidate generation failed');
    expect(container.querySelector('svg')).toBeNull();
  });
  it('does not generate when independent engines are disabled', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValueOnce({ data: { enabled: false, jobs: [] } });
    await render();
    expect(button('Generate candidate').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('sends an explicit full-track request when the full scope is selected', async () => {
    expect.hasAssertions();
    api.get
      .mockResolvedValueOnce({ data: { enabled: true, jobs: [] } })
      .mockResolvedValueOnce({ data: { enabled: true, jobs: [job] } })
      .mockResolvedValueOnce({ data: result });
    api.post.mockResolvedValueOnce({ data: { job } });
    await render();
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Analysis scope"]'),
        {
          target: { value: 'full' },
        },
      );
    });
    await act(async () => {
      Simulate.click(button('Generate candidate'));
    });
    expect(api.post.mock.calls[0][1]).toEqual({
      path: 'track.flac',
      seconds: null,
      features: [
        'beats',
        'key',
        'waveform',
        'energy',
        'loudness',
        'embedding',
        'structure',
        'phrases',
      ],
    });
  });
  it('does not attach an old candidate read error to a different track', async () => {
    expect.hasAssertions();
    let rejectOld;
    api.get
      .mockResolvedValueOnce({ data: { enabled: true, jobs: [job] } })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      );
    await render();
    act(() => {
      Simulate.change(container.querySelectorAll('select')[2], {
        target: { value: job.jobId },
      });
    });
    api.get.mockResolvedValueOnce({ data: { enabled: true, jobs: [] } });
    await render('different.flac');
    await act(async () => {
      rejectOld(new Error('late read error'));
    });
    expect(container.textContent).not.toContain(
      'Candidate could not be loaded',
    );
  });
  it('sends quick preset choices and keeps experimental features off', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: { enabled: true, jobs: [] } });
    api.post.mockRejectedValue(new Error('test completed at request'));
    await render();
    act(() =>
      Simulate.change(
        container.querySelector('[aria-label="Analysis preset"]'),
        { target: { value: 'quick' } },
      ),
    );
    await act(async () => Simulate.click(button('Generate candidate')));
    expect(api.post.mock.calls[0][1].features).toEqual([
      'waveform',
      'energy',
      'loudness',
    ]);
    expect(
      [...container.querySelectorAll('input')].filter((input) => input.checked),
    ).toHaveLength(3);
  });
  it('sends explicit experimental toggles and disables empty selection', async () => {
    expect.hasAssertions();
    api.get.mockResolvedValue({ data: { enabled: true, jobs: [] } });
    api.post.mockRejectedValue(new Error('test completed at request'));
    await render();
    const semantic = [...container.querySelectorAll('label')]
      .find((label) =>
        label.textContent.includes('Intro / verse / chorus labels'),
      )
      .querySelector('input');
    act(() => Simulate.change(semantic));
    await act(async () => Simulate.click(button('Generate candidate')));
    expect(api.post.mock.calls[0][1].features).toContain('semanticPhrases');
    expect(container.textContent).toContain('Stem analysis takes more time');
    for (const input of [...container.querySelectorAll('input')].filter(
      (node) => node.checked,
    ))
      act(() => Simulate.change(input));
    expect(button('Generate candidate').disabled).toBe(true);
    expect(container.textContent).toContain('Select at least one');
  });
  it('shows loop and vocal-presence suggestions as experimental without writing source data', async () => {
    expect.hasAssertions();
    const extra = {
      ...result,
      analysis: {
        ...result.analysis,
        featureAvailability: {
          ...result.analysis.featureAvailability,
          loops: 'available',
          vocalPresence: 'available',
        },
        features: {
          ...result.analysis.features,
          loops: {
            status: 'available',
            result: {
              proposals: [
                {
                  startSeconds: 2,
                  endSeconds: 4,
                  beatCount: 4,
                  rankingScore: 0.8,
                  downbeatAligned: true,
                },
              ],
            },
          },
          vocalPresence: {
            status: 'available',
            result: {
              settings: {
                onDbfs: -40,
                offDbfs: -45,
                onRatio: 0.25,
                offRatio: 0.15,
              },
              segments: [{ startSeconds: 3, endSeconds: 8 }],
            },
          },
        },
      },
    };
    api.get
      .mockResolvedValueOnce({ data: { enabled: true, jobs: [job] } })
      .mockResolvedValueOnce({ data: extra });
    await render();
    await act(async () =>
      Simulate.change(container.querySelectorAll('select')[2], {
        target: { value: job.jobId },
      }),
    );
    expect(container.textContent).toContain('Experimental loop suggestions');
    expect(container.textContent).toContain('4 beats');
    expect(container.textContent).toContain('These are not probabilities');
    expect(container.textContent).toContain('3.0s–8.0s');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('shows saved full-track results without starting a new analysis in results-only mode', async () => {
    expect.hasAssertions();
    const full = {
      ...job,
      jobId: 'full',
      requestedSeconds: null,
      status: 'completed',
    };
    api.get
      .mockResolvedValueOnce({ data: { enabled: true, jobs: [job, full] } })
      .mockResolvedValueOnce({
        data: {
          ...result,
          job: full,
          analysis: { ...result.analysis, scope: { fullTrack: true } },
        },
      });
    await act(async () => {
      ReactDOM.render(
        <CandidateAnalysisPanel
          path="track.flac"
          resultsOnly
        />,
        container,
      );
    });
    expect(container.textContent).toContain('Enhanced analysis results');
    expect(
      container.querySelector('[aria-label="Analysis preset"]'),
    ).toBeNull();
    expect(button('Generate candidate')).toBeUndefined();
    expect(container.querySelectorAll('select option')).toHaveLength(2);
    expect(api.get).toHaveBeenCalledWith('/analysis/candidates/full');
    expect(api.post).not.toHaveBeenCalled();
  });
});
