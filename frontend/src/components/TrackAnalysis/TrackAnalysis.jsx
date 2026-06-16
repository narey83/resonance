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
            className={`ta-tab${activeTab === id ? ' ta-tab--active' : ''}`}
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
