// <copyright file="CandidateAnalysisPanel.jsx" company="John Narey">
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

import './CandidateAnalysisPanel.css';
import api from '../../lib/api';
import {
  candidateBeatWindow,
  candidateFeatureRows,
} from '../../lib/candidateAnalysis';
import { fullTrackJobs } from '../../lib/independentSummary';
import StemPreview from './StemPreview';
import React, { useEffect, useRef, useState } from 'react';

const analysisChoices = [
  ['beats', 'Beats and BPM'],
  ['key', 'Musical key'],
  ['waveform', 'Waveforms'],
  ['energy', 'Signal energy'],
  ['loudness', 'Loudness'],
  ['embedding', 'Similarity embedding'],
  ['structure', 'Sections and generic phrases'],
  ['stems', 'Four stems'],
  ['vocalActivity', 'Vocal activity'],
];
const experimentalChoices = [
  ['genre', 'Genre suggestions'],
  ['cues', 'Cue suggestions'],
  ['semanticPhrases', 'Intro / verse / chorus labels'],
  ['loops', 'Automatic loop suggestions'],
  ['vocalPresence', 'Vocal presence detector'],
];
const analysisPresets = {
  quick: ['waveform', 'energy', 'loudness'],
  standard: [
    'beats',
    'key',
    'waveform',
    'energy',
    'loudness',
    'embedding',
    'structure',
  ],
  full: analysisChoices.map(([id]) => id),
};

const CandidateAnalysisPanel = ({
  initialJobId,
  path,
  resultsOnly = false,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState(null);
  const [scope, setScope] = useState('30');
  const [preset, setPreset] = useState('standard');
  const [features, setFeatures] = useState(analysisPresets.standard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [start, setStart] = useState(0);
  const generation = useRef(0);
  const pending = useRef(null);

  const refresh = async (current = generation.current) => {
    const { data } = await api.get('/analysis/candidates', {
      params: { path },
    });
    if (generation.current === current) {
      setEnabled(data.enabled);
      setJobs(data.jobs || []);
    }
  };

  useEffect(() => {
    const current = ++generation.current;
    setEnabled(false);
    setJobs([]);
    setSelected('');
    setResult(null);
    setBusy(false);
    setMessage('');
    setStart(0);
    if (path)
      refresh(current).catch(() => {
        if (generation.current === current)
          setMessage('Independent candidate analysis is unavailable.');
      });
    return () => {
      generation.current += 1;
      pending.current?.abort();
    };
    // Source changes reset the candidate view and cancel an owned request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const load = async (jobId, current) => {
    const requestGeneration = current ?? ++generation.current;
    if (generation.current !== requestGeneration) return;
    setSelected(jobId);
    setResult(null);
    if (!jobId) return;
    try {
      const { data } = await api.get(
        `/analysis/candidates/${encodeURIComponent(jobId)}`,
      );
      if (generation.current === requestGeneration) setResult(data);
    } catch {
      if (generation.current === requestGeneration)
        setMessage('Candidate could not be loaded.');
    }
  };

  useEffect(() => {
    if (initialJobId && path) load(initialJobId, generation.current);
    // Explicit library selection opens the verified full-track result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId, path]);

  useEffect(() => {
    if (resultsOnly && !initialJobId && !selected) {
      const latest = fullTrackJobs(jobs)[0];
      if (latest) load(latest.jobId, generation.current);
    }
    // Only choose an initial result; manual result selection remains in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId, jobs, resultsOnly, selected]);

  const generate = async () => {
    const current = ++generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setResult(null);
    setSelected('');
    setMessage('Generating an independent candidate…');
    try {
      const { data } = await api.post(
        '/analysis/candidates',
        {
          path,
          seconds: scope === 'full' ? null : Number(scope),
          features: [
            ...features,
            ...(features.includes('structure') ? ['phrases'] : []),
          ],
        },
        { signal: controller.signal },
      );
      if (generation.current !== current) return;
      setMessage(
        `Candidate job: ${data.job.status}. Existing analysis is unchanged.`,
      );
      await refresh(current);
      await load(data.job.jobId, current);
    } catch {
      if (generation.current === current)
        setMessage(
          controller.signal.aborted
            ? 'Generation cancelled. Refresh candidates to see its final state.'
            : 'Candidate generation failed. Existing analysis is unchanged.',
        );
    } finally {
      if (generation.current === current) {
        setBusy(false);
        pending.current = null;
      }
    }
  };

  const toggleFeature = (id) => {
    setPreset('custom');
    setFeatures((previous) =>
      previous.includes(id)
        ? previous.filter((feature) => feature !== id)
        : [...previous, id],
    );
  };

  const rows = candidateFeatureRows(result?.analysis);
  const grid = candidateBeatWindow(result, start, 30);
  const structure = result?.analysis?.features?.structure;
  const semantic = result?.analysis?.features?.semanticPhrases;
  const fullScope = result?.analysis?.scope
    ? result.analysis.scope.fullTrack
    : result?.job?.requestedSeconds == null;
  const requestedSeconds =
    result?.analysis?.scope?.requestedSeconds ?? result?.job?.requestedSeconds;
  if (!path) return null;
  return (
    <section
      aria-label="Independent analysis candidates"
      className="candidate-analysis"
    >
      <h3>
        {resultsOnly
          ? 'Enhanced analysis results'
          : 'Independent analysis candidates'}
      </h3>
      <p>
        {resultsOnly
          ? 'Saved measurements and predictions are kept separate from file tags and your manual edits.'
          : 'Independent engines can differ from Rekordbox. Candidates preserve existing analysis and manual edits.'}
      </p>
      <StemPreview
        enabled={enabled}
        key={path}
        onGenerated={() => refresh().catch(() => {})}
        path={path}
      />
      {!resultsOnly && (
        <fieldset
          className="candidate-analysis-settings"
          disabled={busy}
        >
          <legend>Analysis settings</legend>
          <label>
            Preset
            <select
              aria-label="Analysis preset"
              onChange={(event) => {
                const next = event.target.value;
                setPreset(next);
                if (analysisPresets[next]) setFeatures(analysisPresets[next]);
              }}
              value={preset}
            >
              <option value="quick">Quick · waveform, energy, loudness</option>
              <option value="standard">
                Standard · adds beats, key, similarity, sections
              </option>
              <option value="full">Full · adds stems and vocal activity</option>
              <option
                disabled
                value="custom"
              >
                Custom
              </option>
            </select>
          </label>
          <div className="candidate-feature-options">
            {analysisChoices.map(([id, label]) => (
              <label key={id}>
                <input
                  checked={features.includes(id)}
                  onChange={() => toggleFeature(id)}
                  type="checkbox"
                />
                {label}
              </label>
            ))}
          </div>
          <fieldset>
            <legend>Experimental features · off in presets</legend>
            {experimentalChoices.map(([id, label]) => (
              <label key={id}>
                <input
                  checked={features.includes(id)}
                  onChange={() => toggleFeature(id)}
                  type="checkbox"
                />
                {label}
              </label>
            ))}
            <p>
              Predictions may differ from Rekordbox and are not calibrated
              confidence scores.
            </p>
          </fieldset>
          <p>
            Genre needs an embedding; sections, cues and loop suggestions need
            beats. Vocal activity, the presence detector and semantic labels
            need stems. Stems also need waveform analysis. Required dependencies
            run automatically; unavailable engines remain unavailable.
          </p>
          {features.some((id) =>
            [
              'stems',
              'vocalActivity',
              'semanticPhrases',
              'vocalPresence',
            ].includes(id),
          ) && (
            <p>
              Stem analysis takes more time and stores four separated audio
              files.
            </p>
          )}
          {features.length === 0 && (
            <p role="alert">Select at least one analysis feature.</p>
          )}
        </fieldset>
      )}
      <div className="candidate-analysis-controls">
        {!resultsOnly && (
          <>
            <label>
              Scope
              <select
                aria-label="Analysis scope"
                disabled={busy}
                onChange={(event) => setScope(event.target.value)}
                value={scope}
              >
                <option value="30">First 30 seconds</option>
                <option value="full">Full track</option>
              </select>
            </label>
            <button
              disabled={!enabled || busy || features.length === 0}
              onClick={generate}
              type="button"
            >
              Generate candidate
            </button>
            {busy && (
              <button
                onClick={() => pending.current?.abort()}
                type="button"
              >
                Cancel generation
              </button>
            )}
          </>
        )}
        <button
          onClick={() =>
            refresh().catch(() =>
              setMessage('Candidates could not be refreshed.'),
            )
          }
          type="button"
        >
          {resultsOnly ? 'Refresh results' : 'Refresh candidates'}
        </button>
        <label>
          {resultsOnly ? 'Saved full-track result' : 'Candidate'}
          <select
            aria-label={resultsOnly ? 'Saved full-track result' : 'Candidate'}
            disabled={busy}
            onChange={(event) =>
              load(event.target.value).catch(() =>
                setMessage('Candidate could not be loaded.'),
              )
            }
            value={selected}
          >
            <option value="">
              {resultsOnly ? 'Choose a saved result' : 'Choose a candidate'}
            </option>
            {(resultsOnly ? fullTrackJobs(jobs) : jobs).map((job) => (
              <option
                key={job.jobId}
                value={job.jobId}
              >
                {new Date(job.createdAt).toLocaleString()} · {job.status} ·{' '}
                {job.requestedSeconds
                  ? `${job.requestedSeconds}s`
                  : 'Full track'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!enabled && (
        <p>Independent engines are not configured on this server.</p>
      )}
      {message && <p role="status">{message}</p>}
      {result && (
        <>
          <p>
            Source: independent candidate · Job {result.job.status} ·{' '}
            {result.contentCurrent
              ? 'Audio matches candidate'
              : 'Audio changed; timed overlay hidden'}
          </p>
          <p>
            Scope:{' '}
            {fullScope
              ? 'Full track'
              : `First ${requestedSeconds ?? 'unknown'} seconds`}
          </p>
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Status</th>
                <th>{resultsOnly ? 'Result' : 'Engine and result'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.status}</td>
                  <td>
                    {!resultsOnly && `${row.engine}: `}
                    {row.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {grid && (
            <>
              <label>
                Beat window start (seconds)
                <input
                  max={grid.extent}
                  min="0"
                  onChange={(event) => setStart(Number(event.target.value))}
                  type="number"
                  value={start}
                />
              </label>
              <svg
                aria-label="Independent candidate beat positions"
                className="candidate-beat-grid"
                role="img"
                viewBox="0 0 1000 80"
              >
                <title>
                  Independent beats {grid.start.toFixed(1)}–
                  {grid.end.toFixed(1)} seconds
                </title>
                {grid.beats.map((beat) => (
                  <line
                    className={
                      beat.downbeat ? 'candidate-downbeat' : 'candidate-beat'
                    }
                    key={beat.time}
                    x1={beat.x}
                    x2={beat.x}
                    y1={beat.downbeat ? 8 : 30}
                    y2="70"
                  >
                    <title>
                      {beat.time.toFixed(3)}s
                      {beat.downbeat ? ' · Candidate downbeat' : ''}
                    </title>
                  </line>
                ))}
              </svg>
            </>
          )}
          {structure?.status === 'available' && (
            <details>
              <summary>Experimental structure and cue proposals</summary>
              <p>
                Generic sections and proposals are experimental. No imported
                phrases or hot cues are replaced.
              </p>
              <ul>
                {structure.result.sections.map((section) => (
                  <li key={`${section.start_seconds}-${section.end_seconds}`}>
                    {section.label}: {section.start_seconds}s–
                    {section.end_seconds}s
                  </li>
                ))}
              </ul>
              <ul>
                {(result.analysis.featureAvailability.cues === 'available'
                  ? structure.result.cue_proposals
                  : []
                ).map((cue) => (
                  <li key={cue.seconds}>
                    Cue proposal {cue.seconds}s: {cue.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.analysis.features?.loops?.status === 'available' && (
            <details>
              <summary>Experimental loop suggestions</summary>
              <p>
                Beat-aligned proposals for audition. Ranking scores are not
                confidence; no saved loops or audio are changed.
              </p>
              <ul>
                {result.analysis.features.loops.result.proposals.map((loop) => (
                  <li key={`${loop.startSeconds}-${loop.beatCount}`}>
                    {loop.startSeconds.toFixed(3)}s–{loop.endSeconds.toFixed(3)}
                    s · {loop.beatCount} beats · heuristic rank score{' '}
                    {loop.rankingScore.toFixed(3)}
                    {loop.downbeatAligned
                      ? ' · starts on an independent downbeat'
                      : ''}
                  </li>
                ))}
              </ul>
              {result.analysis.features.loops.result.proposals.length === 0 && (
                <p>No eligible loops found.</p>
              )}
            </details>
          )}
          {result.analysis.features?.vocalPresence?.status === 'available' && (
            <details>
              <summary>Experimental vocal presence</summary>
              <p>
                Possible singing from the independent voice detector. Bleed can
                create false detections; quiet vocals can be missed. These are
                not probabilities.
              </p>
              <p>
                Start:{' '}
                {result.analysis.features.vocalPresence.result.settings.onDbfs}{' '}
                dBFS / RMS ratio{' '}
                {result.analysis.features.vocalPresence.result.settings.onRatio}
                ; retain:{' '}
                {result.analysis.features.vocalPresence.result.settings.offDbfs}{' '}
                dBFS / ratio{' '}
                {
                  result.analysis.features.vocalPresence.result.settings
                    .offRatio
                }
                .
              </p>
              <ul>
                {result.analysis.features.vocalPresence.result.segments.map(
                  (segment) => (
                    <li key={segment.startSeconds}>
                      {segment.startSeconds.toFixed(1)}s–
                      {segment.endSeconds.toFixed(1)}s · possible vocals
                    </li>
                  ),
                )}
              </ul>
              {result.analysis.features.vocalPresence.result.segments.length ===
                0 && (
                <p>No possible-vocal spans met the configured thresholds.</p>
              )}
            </details>
          )}
          {semantic?.status === 'available' && (
            <details>
              <summary>Musical phrase predictions (verse / chorus)</summary>
              <p>
                These labels are model predictions using separated stems with a
                different input distribution. They do not replace generic
                sections or imported phrase labels.
              </p>
              <ul>
                {semantic.result.segments.map((segment) => (
                  <li key={`${segment.start_seconds}-${segment.end_seconds}`}>
                    {segment.label}: {segment.start_seconds}s–
                    {segment.end_seconds}s · experimental prediction
                  </li>
                ))}
              </ul>
            </details>
          )}
          {semantic?.result?.djStructure && (
            <details>
              <summary>DJ structure suggestions (experimental)</summary>
              <p>
                Energy-based arrangement roles on independent phrase boundaries.
                Audition required; musical labels remain separate.
              </p>
              <ul>
                {semantic.result.djStructure.segments.map((segment) => (
                  <li key={segment.start_seconds}>
                    {segment.label}: {segment.start_seconds.toFixed(1)}s–
                    {segment.end_seconds.toFixed(1)}s
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.analysis.features?.vocalPresence?.result?.processedVoice
            ?.segments && (
            <details>
              <summary>
                Possible speech / processed vocals (experimental)
              </summary>
              <p>
                Speech detection on separated vocals. Music bleed can cause
                false detections; this supplements singing detection.
              </p>
              {result.analysis.features.vocalPresence.result.processedVoice
                .sustainedSegments && (
                <details open>
                  <summary>Sustained voice — fewer short detections</summary>
                  <p>
                    Spans lasting at least six seconds. When singing support is
                    available, unsupported speech needs a stronger retention
                    score. Short real vocals may be omitted; this is a stricter
                    audition view, not calibrated confidence.
                  </p>
                  <ul>
                    {result.analysis.features.vocalPresence.result.processedVoice.sustainedSegments.map(
                      (segment) => (
                        <li key={segment.startSeconds}>
                          {segment.startSeconds.toFixed(1)}s–
                          {segment.endSeconds.toFixed(1)}s · {segment.label}
                        </li>
                      ),
                    )}
                  </ul>
                </details>
              )}
              <p>Broader voice detections (includes short passages):</p>
              <ul>
                {result.analysis.features.vocalPresence.result.processedVoice.segments.map(
                  (segment) => (
                    <li key={segment.startSeconds}>
                      {segment.startSeconds.toFixed(1)}s–
                      {segment.endSeconds.toFixed(1)}s · {segment.label}
                    </li>
                  ),
                )}
              </ul>
            </details>
          )}
          {result.analysis && (
            <details>
              <summary>Engine provenance and limitations</summary>
              <ul>
                {(result.analysis.limitations || []).map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
              <pre>{JSON.stringify(result.analysis.provenance, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
};

export default CandidateAnalysisPanel;
