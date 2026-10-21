// <copyright file="TrackAnalysis.jsx" company="John Narey">
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

import './TrackAnalysis.css';
import Analysis from '../Analysis/Analysis';
import IndependentAnalysisLibrary from './IndependentAnalysisLibrary';
import WaveformAnalysis from './WaveformAnalysis';
import { AudioWaveform, SlidersHorizontal } from 'lucide-react';
import React, { useState } from 'react';

// Key, BPM, waveform and loudness are one scan over one queue, so they are one
// page. The waveform tab is a different job — inspecting a single track — not a
// fourth copy of the same table.
const TABS = [
  { icon: SlidersHorizontal, id: 'independent', label: 'Advanced analysis' },
  { icon: SlidersHorizontal, id: 'analysis', label: 'Track Analysis' },
  { icon: AudioWaveform, id: 'waveform', label: 'Waveform Inspector' },
];

const TrackAnalysis = () => {
  const [activeTab, setActiveTab] = useState('analysis');

  const renderPanel = () =>
    activeTab === 'independent' ? (
      <IndependentAnalysisLibrary />
    ) : activeTab === 'analysis' ? (
      <Analysis />
    ) : (
      <WaveformAnalysis />
    );

  return (
    <div className="ta-root">
      <div className="ta-tabs">
        {TABS.map(({ icon: Icon, id, label }) => (
          <button
            className={`ta-tab hover-fx${activeTab === id ? ' ta-tab--active' : ''}`}
            key={id}
            onClick={() => setActiveTab(id)}
            type="button"
          >
            <Icon
              size={14}
              strokeWidth={1.75}
            />
            {label}
          </button>
        ))}
      </div>
      <div className="ta-panel">{renderPanel()}</div>
    </div>
  );
};

export default TrackAnalysis;
