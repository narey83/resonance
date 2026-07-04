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
import BpmAnalysis from '../BpmAnalysis/BpmAnalysis';
import KeyAnalysis from '../KeyAnalysis/KeyAnalysis';
import WaveformAnalysis from './WaveformAnalysis';
import { Activity, AudioWaveform, KeyRound } from 'lucide-react';
import React, { useState } from 'react';

const TABS = [
  { icon: KeyRound, id: 'key', label: 'Key Analysis' },
  { icon: Activity, id: 'bpm', label: 'BPM Analysis' },
  { icon: AudioWaveform, id: 'waveform', label: 'Waveform' },
];

const TrackAnalysis = () => {
  const [activeTab, setActiveTab] = useState('key');

  const renderPanel = () => {
    if (activeTab === 'key') return <KeyAnalysis />;
    if (activeTab === 'bpm') return <BpmAnalysis />;
    return <WaveformAnalysis />;
  };

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
