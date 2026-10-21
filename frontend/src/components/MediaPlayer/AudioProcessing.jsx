// <copyright file="AudioProcessing.jsx" company="John Narey">
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

import { applyPreset, PRESETS } from '../../lib/dsp/presets';
import {
  applySubtleSettings,
  persistProcessingSettings,
  SUBTLE_PRESETS,
} from '../../lib/dsp/processingPolicy';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import CompressorView from './CompressorView';
import EqView from './EqView';
import FilterView from './FilterView';
import LimiterView from './LimiterView';
import PerformanceMode from './PerformanceMode';
import SaturationView from './SaturationView';
import StereoView from './StereoView';
import { X } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Every processor that can appear in the rack. Adding a new one is:
// implement it under lib/dsp/, register it in mediaAudioGraph.js's chain,
// add its view component, and add one entry here — this shell doesn't
// need to change beyond that.
const PROCESSORS = [
  { Component: PerformanceMode, id: 'performance' },
  { Component: EqView, id: 'eq' },
  { Component: CompressorView, id: 'compressor' },
  { Component: LimiterView, id: 'limiter' },
  { Component: SaturationView, id: 'saturation' },
  { Component: StereoView, id: 'stereo' },
  { Component: FilterView, id: 'filter' },
];

// Launcher + modal for the player's Web Audio processing rack: a list of
// processors on the left, the selected one's settings on the right, and a
// preset dropdown that configures several processors at once. This shell
// only tracks which processor is selected, whether the modal is open, and
// an aggregate "is anything on" flag for the button — it has no idea what
// a compressor or limiter is, that's each processor's own business (see
// lib/dsp/ and each *View.jsx).
//
// The modal is always in the DOM (visibility toggled via CSS), not
// conditionally mounted, so every processor stays alive and running
// regardless of whether the modal happens to be open.
const AudioProcessing = ({
  audioRef,
  launcherTarget = null,
  modalTarget = null,
  targetLufs,
}) => {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('performance');
  const [activeById, setActiveById] = useState({});
  const [detailNode, setDetailNode] = useState(null);
  const [presetId, setPresetId] = useState('');
  const [bypassed, setBypassed] = useState(() =>
    prefs.get('mediaPlayer.processingBypassed', true),
  );
  const [advanced, setAdvanced] = useState(() =>
    prefs.get('mediaPlayer.processingAdvanced', false),
  );
  // Keep the portal container identity stable when docking. Remounting the
  // processor views would dispose Performance Mode and alter the live sound.
  const modalHostRef = useRef(null);
  if (!modalHostRef.current)
    modalHostRef.current = document.createElement('div');
  const modalHost = modalHostRef.current;
  useLayoutEffect(() => {
    (modalTarget || document.body).append(modalHost);
    return () => modalHost.remove();
  }, [modalHost, modalTarget]);

  useEffect(() => {
    if (!audioRef.current) return undefined;
    return getMediaAudioGraph(audioRef.current).processing.subscribe(
      setBypassed,
    );
  }, [audioRef]);

  const toggleBypass = () => {
    const next = !bypassed;
    getMediaAudioGraph(audioRef.current)?.processing.setBypassed(next);
    prefs.set('mediaPlayer.processingBypassed', next);
  };

  const toggleAdvanced = () => {
    const next = !advanced;
    if (audioRef.current)
      getMediaAudioGraph(audioRef.current).dsp.performance.setAdvanced(next);
    if (!next && audioRef.current) {
      const { dsp } = getMediaAudioGraph(audioRef.current);
      applySubtleSettings(dsp);
      persistProcessingSettings(dsp);
    }

    setAdvanced(next);
    prefs.set('mediaPlayer.processingAdvanced', next);
  };

  const setActive = (id, active) => {
    setActiveById((previous) =>
      previous[id] === active ? previous : { ...previous, [id]: active },
    );
  };

  const anyActive = Object.values(activeById).some(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    const modalDocument = modalHost.ownerDocument;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    modalDocument.addEventListener('keydown', onKeyDown);
    modalHost.querySelector('.mp-processing-modal-close')?.focus();
    return () => modalDocument.removeEventListener('keydown', onKeyDown);
  }, [modalHost, modalTarget, open]);

  const handleSelectPreset = (event) => {
    const nextPresetId = event.target.value;
    setPresetId(nextPresetId);
    if (!nextPresetId) return;

    const audio = audioRef.current;
    if (!audio) return;

    if (!advanced && !SUBTLE_PRESETS.includes(nextPresetId)) return;
    const { dsp } = getMediaAudioGraph(audio);
    applyPreset(dsp, nextPresetId);
    if (!advanced) applySubtleSettings(dsp);
    persistProcessingSettings(dsp);
    // Presets act through the same processor instances every panel reads,
    // so each panel's own subscription (enabled) and this shell's
    // per-track effect (params, on next mount) pick the change up — this
    // reset just clears the dropdown back to "choose a preset" rather than
    // pretending to track which preset is still "active" after a manual
    // tweak.
    setPresetId('');
  };

  const launcher = (
    <button
      aria-expanded={open}
      className={`mp-processing-btn${!bypassed && anyActive ? ' mp-processing-btn--active' : ''}`}
      onClick={() => setOpen((previous) => !previous)}
      title="Audio processing"
      type="button"
    >
      {bypassed ? 'Processing · Bypassed' : 'Processing'}
    </button>
  );

  return (
    <div className="mp-processing">
      {launcher}
      {launcherTarget && createPortal(launcher, launcherTarget)}

      {createPortal(
        <div
          aria-label="Audio processing"
          aria-modal="true"
          className={`mp-processing-overlay${open ? '' : ' mp-processing-overlay--hidden'}`}
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="mp-processing-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mp-processing-modal-header">
              <span>Audio Processing</span>
              <select
                aria-label="Preset"
                className="mp-processing-preset-select"
                disabled={bypassed}
                onChange={handleSelectPreset}
                value={presetId}
              >
                <option value="">Preset…</option>
                {PRESETS.filter(
                  (preset) => advanced || SUBTLE_PRESETS.includes(preset.id),
                ).map((preset) => (
                  <option
                    key={preset.id}
                    value={preset.id}
                  >
                    {preset.name}
                  </option>
                ))}
              </select>
              <button
                className="mp-processing-modal-close hover-fx"
                onClick={() => setOpen(false)}
                title="Close"
                type="button"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mp-processing-master">
              <label className="mp-processing-master-toggle">
                <input
                  aria-label="Enable audio processing"
                  checked={!bypassed}
                  onChange={toggleBypass}
                  type="checkbox"
                />
                <strong>
                  {bypassed
                    ? 'Original audio · all processing bypassed'
                    : 'Audio processing enabled'}
                </strong>
              </label>
              <p>
                {bypassed
                  ? 'Bypasses effects and loudness normalisation. Your settings are kept; player volume still works.'
                  : advanced
                    ? 'Advanced controls unlocked. Wider ranges can change the sound substantially.'
                    : 'Subtle controls: gentle tone, dynamics and stereo adjustments.'}
              </p>
              <button
                aria-pressed={advanced}
                className="mp-processing-unlock"
                onClick={toggleAdvanced}
                type="button"
              >
                {advanced
                  ? 'Use subtle controls · reset advanced values'
                  : 'Unlock advanced controls'}
              </button>
            </div>
            <fieldset
              className="mp-processing-modal-body"
              disabled={bypassed}
            >
              <div className="mp-processing-modal-list">
                {PROCESSORS.map(({ Component, id }) => (
                  <Component
                    advanced={advanced}
                    audioRef={audioRef}
                    detailContainerNode={detailNode}
                    isSelected={selectedId === id}
                    key={id}
                    onActiveChange={(active) => setActive(id, active)}
                    onSelect={() => setSelectedId(id)}
                    targetLufs={id === 'performance' ? targetLufs : undefined}
                  />
                ))}
              </div>

              <div
                className="mp-processing-modal-detail"
                ref={setDetailNode}
              />
            </fieldset>
          </div>
        </div>,
        modalHost,
      )}
    </div>
  );
};

export default AudioProcessing;
