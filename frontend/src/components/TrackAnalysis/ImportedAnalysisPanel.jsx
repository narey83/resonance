// <copyright file="ImportedAnalysisPanel.jsx" company="John Narey">
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

import './ImportedAnalysisPanel.css';
import api from '../../lib/api';
import {
  importedFeatureSummary,
  importedGridWindow,
  importedVocalWindow,
} from '../../lib/importedAnalysis';
import React, { useEffect, useRef, useState } from 'react';

const ImportedAnalysisPanel = ({ path }) => {
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState(0);
  const [windowSeconds, setWindowSeconds] = useState(30);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setSources([]);
    setSelected('');
    setSnapshot(null);
    setError('');
    setLoading(false);
    setStart(0);
    if (path) {
      api
        .get('/analysis/imports/sources', { params: { path } })
        .then(({ data }) => {
          if (generation.current === current) setSources(data);
        })
        .catch(() => {
          if (generation.current === current)
            setError('Imported analysis sources are unavailable.');
        });
    }

    return () => {
      generation.current += 1;
    };
  }, [path]);

  const chooseSource = async (collectionSha256) => {
    const current = ++generation.current;
    setSelected(collectionSha256);
    setSnapshot(null);
    setError('');
    setLoading(Boolean(collectionSha256));
    if (!collectionSha256) return;
    try {
      const { data } = await api.get('/analysis/imports', {
        params: { collectionSha256, path },
      });
      if (generation.current === current) setSnapshot(data);
    } catch {
      if (generation.current === current)
        setError('This imported analysis could not be loaded.');
    } finally {
      if (generation.current === current) setLoading(false);
    }
  };

  const grid = importedGridWindow(snapshot, start, windowSeconds);
  const analysis = snapshot?.analysis;
  const vocalFrames = importedVocalWindow(snapshot, start, windowSeconds);
  const featureSummary = importedFeatureSummary(analysis);
  if (!path) return null;
  return (
    <section
      aria-label="Imported analysis comparison"
      className="imported-analysis"
    >
      <label>
        Analysis view
        <select
          onChange={(event) => chooseSource(event.target.value)}
          value={selected}
        >
          <option value="">Resonance analysis</option>
          {sources.map((source) => (
            <option
              key={source.collectionSha256}
              value={source.collectionSha256}
            >
              Rekordbox import {new Date(source.importedAt).toLocaleString()} ·
              Track {source.sourceTrackId}
            </option>
          ))}
        </select>
      </label>
      {loading && <p role="status">Loading imported analysis…</p>}
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <>
          <p>
            Rekordbox imported grid · BPM {analysis.bpm ?? 'unavailable'} · Key{' '}
            {analysis.key || 'unavailable'}
            {' · '}
            {snapshot.contentCurrent
              ? 'Audio matches import'
              : 'Audio changed: imported grid hidden'}
          </p>
          <p>
            Compare this source with Resonance’s waveform below. Existing
            analysis stays unchanged.
          </p>
          {grid && (
            <>
              <div className="imported-analysis-window">
                <label>
                  Window start (seconds)
                  <input
                    max={grid.gridExtent}
                    min="0"
                    onChange={(event) => setStart(Number(event.target.value))}
                    step="1"
                    type="number"
                    value={start}
                  />
                </label>
                <label>
                  Window length
                  <select
                    onChange={(event) =>
                      setWindowSeconds(Number(event.target.value))
                    }
                    value={windowSeconds}
                  >
                    {[10, 30, 60, 120].map((seconds) => (
                      <option
                        key={seconds}
                        value={seconds}
                      >
                        {seconds} seconds
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <svg
                aria-label="Imported beats and explicit downbeats"
                className="imported-analysis-grid"
                role="img"
                viewBox="0 0 1000 80"
              >
                <title>
                  Rekordbox beat positions from {grid.start.toFixed(1)} to{' '}
                  {grid.end.toFixed(1)} seconds
                </title>
                {grid.beats.map((beat) => (
                  <line
                    className={
                      beat.downbeat ? 'imported-downbeat' : 'imported-beat'
                    }
                    key={beat.timeSeconds}
                    x1={beat.x}
                    x2={beat.x}
                    y1={beat.downbeat ? 8 : 30}
                    y2="70"
                  >
                    <title>
                      {beat.timeSeconds.toFixed(3)}s · Beat {beat.beatInBar} ·{' '}
                      {beat.bpm} BPM{beat.downbeat ? ' · Downbeat' : ''}
                    </title>
                  </line>
                ))}
              </svg>
              <p>Short marks: source beats. Tall marks: source downbeats.</p>
              <p>
                Audio duration {grid.audioDuration.toFixed(3)}s · Imported grid
                extent {grid.gridExtent.toFixed(3)}s
              </p>
            </>
          )}
          {snapshot.contentCurrent && !grid && (
            <p>This source has no usable beat timeline.</p>
          )}
          <details>
            <summary>Imported features</summary>
            <dl className="imported-analysis-features">
              {featureSummary.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p>
              Energy is a source model value. Vocal bins are source activity
              levels, not separated audio or exact probabilities.
            </p>
            {vocalFrames.length > 0 && (
              <svg
                aria-label="Imported vocal activity bins"
                className="imported-vocal-grid"
                role="img"
                viewBox="0 0 1000 60"
              >
                <title>Source vocal bins in the selected time window</title>
                {vocalFrames.map((frame) => (
                  <rect
                    height={frame.level * 12}
                    key={frame.seconds}
                    width={frame.width}
                    x={frame.x}
                    y={55 - frame.level * 12}
                  >
                    <title>
                      {frame.seconds.toFixed(3)}s · Source vocal bin{' '}
                      {frame.level} of 4
                    </title>
                  </rect>
                ))}
              </svg>
            )}
            {analysis.phrases?.entries?.length > 0 && (
              <>
                <p>
                  Phrase boundaries are candidates; final boundary inclusivity
                  remains unresolved.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Start (s)</th>
                      <th>Start beat</th>
                      <th>Next candidate beat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.phrases.entries.map((phrase) => (
                      <tr key={phrase.index}>
                        <td>
                          {phrase.label ||
                            `Unmapped kind ${phrase.kindCodeUnmapped}`}
                        </td>
                        <td>{phrase.startSecondsCandidate ?? 'Unknown'}</td>
                        <td>{phrase.startBeatCandidate}</td>
                        <td>{phrase.nextBoundaryBeatCandidate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {analysis.positionMarks?.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Source mark</th>
                    <th>Slot</th>
                    <th>Start (s)</th>
                    <th>End (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.positionMarks.map((mark) => (
                    <tr key={JSON.stringify(mark)}>
                      <td>
                        {mark.attributes?.Name ||
                          mark.typeName ||
                          'Unmapped mark'}
                      </td>
                      <td>
                        {mark.slotKind || 'Unknown'} {mark.typed?.Num}
                      </td>
                      <td>{mark.typed?.Start ?? 'Unknown'}</td>
                      <td>{mark.typed?.End ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p>
              Source availability:{' '}
              {Object.entries(analysis.featureAvailability || {})
                .map(([name, state]) => `${name}: ${state}`)
                .join('; ') || 'Not recorded'}
            </p>
          </details>
          <details>
            <summary>Source details</summary>
            <p>
              Track {analysis.trackId} · {analysis.source}
            </p>
            <p>
              Import set: <code>{snapshot.collectionSha256}</code>
            </p>
            <p>
              Document: <code>{snapshot.documentSha256}</code>
            </p>
            <p>
              Source XML: <code>{snapshot.sourceXmlSha256 || 'Unknown'}</code>
            </p>
            <p>Imported source confidence is unavailable.</p>
          </details>
        </>
      )}
    </section>
  );
};

export default ImportedAnalysisPanel;
