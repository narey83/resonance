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
import WaveformAnalysis from './WaveformAnalysis';
import {
  AlertTriangle,
  AudioWaveform,
  LayoutDashboard,
  SlidersHorizontal,
} from 'lucide-react';
import React, { useRef, useState } from 'react';

const TAB_KEY = 'resonance-analysis-tab';
const TABS = [
  { icon: LayoutDashboard, id: 'overview', label: 'Overview' },
  { icon: SlidersHorizontal, id: 'analysis', label: 'Analyse tracks' },
  { icon: AlertTriangle, id: 'failures', label: 'Failures' },
  { icon: AudioWaveform, id: 'waveform', label: 'Waveform Inspector' },
];

const TrackAnalysis = () => {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return TABS.some((tab) => tab.id === saved) ? saved : 'overview';
    } catch {
      return 'overview';
    }
  });
  const [statusHost, setStatusHost] = useState(null);
  const selectTab = (id) => {
    setActiveTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* Storage may be unavailable. */
    }
  };

  const analysisView = useRef(null);
  const waveformView = useRef(null);

  return (
    <div className="ta-root">
      <div
        className="ta-scan-status"
        ref={setStatusHost}
      />
      <div
        aria-label="Track analysis views"
        className="ta-tabs"
        role="tablist"
      >
        {TABS.map(({ icon: Icon, id, label }) => (
          <button
            aria-controls={`track-analysis-panel-${id}`}
            aria-selected={activeTab === id}
            className={`ta-tab hover-fx${activeTab === id ? ' ta-tab--active' : ''}`}
            id={`track-analysis-tab-${id}`}
            key={id}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => {
              const index = TABS.findIndex((tab) => tab.id === id);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? TABS.length - 1
                    : event.key === 'ArrowRight'
                      ? (index + 1) % TABS.length
                      : event.key === 'ArrowLeft'
                        ? (index + TABS.length - 1) % TABS.length
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              selectTab(TABS[next].id);
              event.currentTarget.parentElement
                .querySelectorAll('[role="tab"]')
                [next].focus();
            }}
            role="tab"
            tabIndex={activeTab === id ? 0 : -1}
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
      <div
        aria-labelledby={`track-analysis-tab-${activeTab}`}
        className="ta-panel"
        id={`track-analysis-panel-${activeTab}`}
        role="tabpanel"
      >
        <div
          className="ta-analysis-workspace"
          hidden={activeTab === 'waveform'}
        >
          <Analysis
            activeView={activeTab}
            onNavigate={selectTab}
            statusHost={statusHost}
            viewState={analysisView}
          />
        </div>
        {activeTab === 'waveform' && (
          <WaveformAnalysis viewState={waveformView} />
        )}
      </div>
    </div>
  );
};

export default TrackAnalysis;
